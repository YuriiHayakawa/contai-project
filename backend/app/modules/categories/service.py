"""Regras de categorias: as prontas do cadastro, dois níveis, paleta de cores e arquivamento."""

import unicodedata
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.modules.categories.defaults import DEFAULT_CATEGORIES
from app.modules.categories.models import SELECTABLE_COLORS, Category, CategoryColor, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categories.schemas import (
    CategoryCreate,
    CategoryRead,
    CategoryTree,
    CategoryUpdate,
)

COLOR_NOT_IN_PALETTE = (
    "Escolha uma das oito cores: azul, laranja, verde-água, mostarda, rosa, verde, roxo "
    "ou vermelho."
)
FALLBACK_COLOR_FIXED = 'A categoria "Outros" usa sempre a cor neutra.'
PARENT_NOT_FOUND = "Escolha uma das suas categorias como categoria principal."
PARENT_IS_CHILD = "Uma subcategoria não pode ter subcategorias. Escolha uma categoria principal."
PARENT_ARCHIVED = "Esta categoria principal está arquivada. Escolha outra ou desarquive esta."
PARENT_OTHER_KIND = (
    "A subcategoria precisa ser do mesmo tipo (despesa ou receita) da categoria principal."
)
NAME_TAKEN = "Já existe uma categoria ativa com esse nome aqui. Escolha outro nome."
FALLBACK_NOT_ARCHIVABLE = (
    'A categoria "Outros" não pode ser arquivada: é para ela que vai o que não tem categoria.'
)
PARENT_STILL_ARCHIVED = "Desarquive antes a categoria principal desta subcategoria."


def _sort_key(category: Category) -> tuple[bool, str]:
    """Ordem alfabética sem contar acentos, com a "Outros" por último."""
    decomposed = unicodedata.normalize("NFKD", category.name.lower())
    return category.is_fallback, "".join(c for c in decomposed if not unicodedata.combining(c))


def _palette_color(value: str, field: str = "color") -> CategoryColor:
    """A cor de uma categoria é uma das oito da paleta; a neutra é só da "Outros"."""
    try:
        color = CategoryColor(value)
    except ValueError:
        color = None
    if color is None or color not in SELECTABLE_COLORS:
        raise ValidationFailed(details={"fields": {field: COLOR_NOT_IN_PALETTE}})
    return color


def _invalid_parent(message: str) -> ValidationFailed:
    return ValidationFailed(details={"fields": {"parent_id": message}})


class CategoryService:
    def __init__(self, session: AsyncSession) -> None:
        self._categories = CategoryRepository(session)

    # ---------- consulta

    async def tree(self, user_id: uuid.UUID, *, include_archived: bool = False) -> CategoryTree:
        categories = await self._categories.list_all(user_id, include_archived=include_archived)
        children_of: dict[uuid.UUID, list[Category]] = {}
        for category in categories:
            if category.parent_id is not None:
                children_of.setdefault(category.parent_id, []).append(category)

        def nodes(kind: CategoryKind) -> list[CategoryRead]:
            top_level = [c for c in categories if c.parent_id is None and c.kind == kind]
            return [
                self._node(category, children_of.get(category.id, []))
                for category in sorted(top_level, key=_sort_key)
            ]

        return CategoryTree(expense=nodes(CategoryKind.EXPENSE), income=nodes(CategoryKind.INCOME))

    @staticmethod
    def _node(category: Category, children: list[Category]) -> CategoryRead:
        return CategoryRead.from_category(
            category,
            [CategoryRead.from_category(child, []) for child in sorted(children, key=_sort_key)],
        )

    async def _read(self, category: Category) -> CategoryRead:
        """Uma categoria com todas as subcategorias dela, arquivadas ou não."""
        children = await self._categories.children(category.user_id, category.id)
        return self._node(category, children)

    async def _load(self, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._categories.get(user_id, category_id)
        if category is None:
            raise NotFound()
        return category

    async def _ensure_name_is_free(self, category: Category, name: str) -> None:
        sibling = await self._categories.find_active_sibling_by_name(
            category.user_id,
            kind=CategoryKind(category.kind),
            parent_id=category.parent_id,
            name=name,
        )
        if sibling is not None and sibling.id != category.id:
            raise Conflict(NAME_TAKEN, code="category_name_taken")

    # ---------- criar e editar

    async def create(self, user_id: uuid.UUID, data: CategoryCreate) -> CategoryRead:
        color = _palette_color(data.color)
        if data.parent_id is not None:
            await self._check_parent(user_id, data.parent_id, data.kind)
        sibling = await self._categories.find_active_sibling_by_name(
            user_id, kind=data.kind, parent_id=data.parent_id, name=data.name
        )
        if sibling is not None:
            raise Conflict(NAME_TAKEN, code="category_name_taken")
        category = await self._categories.create(
            user_id,
            name=data.name,
            kind=data.kind,
            parent_id=data.parent_id,
            icon=data.icon,
            color=color,
        )
        return await self._read(category)

    async def _check_parent(
        self, user_id: uuid.UUID, parent_id: uuid.UUID, kind: CategoryKind
    ) -> None:
        """A mãe é do usuário, está ativa, não tem mãe (dois níveis) e é do mesmo tipo."""
        parent = await self._categories.get(user_id, parent_id)
        if parent is None:
            raise _invalid_parent(PARENT_NOT_FOUND)
        if parent.parent_id is not None:
            raise _invalid_parent(PARENT_IS_CHILD)
        if parent.archived_at is not None:
            raise _invalid_parent(PARENT_ARCHIVED)
        if parent.kind != kind:
            raise _invalid_parent(PARENT_OTHER_KIND)

    async def update(
        self, user_id: uuid.UUID, category_id: uuid.UUID, data: CategoryUpdate
    ) -> CategoryRead:
        category = await self._load(user_id, category_id)
        if data.color is not None:
            if category.is_fallback:
                if data.color != CategoryColor.ARDOSIA:
                    raise ValidationFailed(details={"fields": {"color": FALLBACK_COLOR_FIXED}})
            else:
                category.color = _palette_color(data.color)
        if data.name is not None and data.name != category.name:
            if category.archived_at is None:
                await self._ensure_name_is_free(category, data.name)
            category.name = data.name
        if data.icon is not None:
            category.icon = data.icon
        return await self._read(await self._categories.save(user_id, category))

    # ---------- arquivar

    async def archive(self, user_id: uuid.UUID, category_id: uuid.UUID) -> CategoryRead:
        """Arquivar a mãe arquiva as filhas. A "Outros" nunca é arquivada."""
        category = await self._load(user_id, category_id)
        if category.is_fallback:
            raise Conflict(FALLBACK_NOT_ARCHIVABLE, code="category_is_fallback")
        if category.archived_at is None:
            now = clock.utcnow()
            category.archived_at = now
            await self._categories.save(user_id, category)
            await self._categories.archive_active_children(user_id, category.id, now)
        return await self._read(category)

    async def unarchive(self, user_id: uuid.UUID, category_id: uuid.UUID) -> CategoryRead:
        """Desarquiva a categoria e as subcategorias que foram arquivadas junto com ela."""
        category = await self._load(user_id, category_id)
        if category.archived_at is None:
            return await self._read(category)
        if category.parent_id is not None:
            parent = await self._categories.get(user_id, category.parent_id)
            if parent is not None and parent.archived_at is not None:
                raise Conflict(PARENT_STILL_ARCHIVED, code="category_parent_archived")
        await self._ensure_name_is_free(category, category.name)

        archived_at = category.archived_at
        category.archived_at = None
        await self._categories.save(user_id, category)
        await self._categories.unarchive_children_archived_at(user_id, category.id, archived_at)
        return await self._read(category)

    # ---------- categorias prontas

    async def create_defaults(self, user_id: uuid.UUID) -> None:
        """Cria as categorias e subcategorias prontas de um usuário novo (FR-024).

        Chamado quando o e-mail é confirmado, na mesma transação. Quem já tem categorias não
        recebe as prontas de novo.
        """
        if await self._categories.has_any(user_id):
            return
        for kind, defaults in DEFAULT_CATEGORIES.items():
            for default in defaults:
                parent = await self._categories.create(
                    user_id,
                    name=default.name,
                    kind=kind,
                    parent_id=None,
                    icon=default.icon,
                    color=default.color,
                    is_fallback=default.is_fallback,
                )
                for child_name, child_icon in default.children:
                    await self._categories.create(
                        user_id,
                        name=child_name,
                        kind=kind,
                        parent_id=parent.id,
                        icon=child_icon,
                        color=default.color,
                    )

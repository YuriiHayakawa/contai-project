"""Acesso ao banco para categorias. Todo método exige `user_id`."""

import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categories.models import Category, CategoryColor, CategoryKind


class CategoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        user_id: uuid.UUID,
        *,
        name: str,
        kind: CategoryKind,
        parent_id: uuid.UUID | None,
        icon: str,
        color: CategoryColor,
        is_fallback: bool = False,
    ) -> Category:
        category = Category(
            user_id=user_id,
            name=name,
            kind=kind,
            parent_id=parent_id,
            icon=icon,
            color=color,
            is_fallback=is_fallback,
        )
        self._session.add(category)
        await self._session.flush()
        await self._session.refresh(category)
        return category

    async def get(self, user_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
        result = await self._session.execute(
            select(Category).where(Category.id == category_id, Category.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_all(
        self, user_id: uuid.UUID, *, include_archived: bool = False
    ) -> list[Category]:
        statement = select(Category).where(Category.user_id == user_id)
        if not include_archived:
            statement = statement.where(Category.archived_at.is_(None))
        return list((await self._session.execute(statement)).scalars())

    async def children(self, user_id: uuid.UUID, parent_id: uuid.UUID) -> list[Category]:
        result = await self._session.execute(
            select(Category).where(Category.user_id == user_id, Category.parent_id == parent_id)
        )
        return list(result.scalars())

    async def family_ids(self, user_id: uuid.UUID, category_id: uuid.UUID) -> list[uuid.UUID]:
        """A categoria e as subcategorias dela; lista vazia se ela não é deste usuário."""
        result = await self._session.execute(
            select(Category.id).where(
                Category.user_id == user_id,
                (Category.id == category_id) | (Category.parent_id == category_id),
            )
        )
        return list(result.scalars())

    async def find_active_sibling_by_name(
        self, user_id: uuid.UUID, *, kind: CategoryKind, parent_id: uuid.UUID | None, name: str
    ) -> Category | None:
        """Irmã ativa com este nome, sem diferenciar maiúsculas de minúsculas."""
        same_parent = (
            Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id
        )
        result = await self._session.execute(
            select(Category).where(
                Category.user_id == user_id,
                Category.kind == kind,
                same_parent,
                Category.archived_at.is_(None),
                func.lower(Category.name) == name.lower(),
            )
        )
        return result.scalars().first()

    async def save(self, user_id: uuid.UUID, category: Category) -> Category:
        """Grava as alterações feitas em uma categoria já carregada deste usuário."""
        if category.user_id != user_id:
            raise ValueError("a categoria não é deste usuário")
        await self._session.flush()
        await self._session.refresh(category)
        return category

    async def archive_active_children(
        self, user_id: uuid.UUID, parent_id: uuid.UUID, now: datetime
    ) -> None:
        await self._session.execute(
            update(Category)
            .where(
                Category.user_id == user_id,
                Category.parent_id == parent_id,
                Category.archived_at.is_(None),
            )
            .values(archived_at=now)
        )

    async def unarchive_children_archived_at(
        self, user_id: uuid.UUID, parent_id: uuid.UUID, archived_at: datetime
    ) -> None:
        """Desarquiva as subcategorias que foram arquivadas junto com a mãe."""
        await self._session.execute(
            update(Category)
            .where(
                Category.user_id == user_id,
                Category.parent_id == parent_id,
                Category.archived_at == archived_at,
            )
            .values(archived_at=None)
        )

    async def has_any(self, user_id: uuid.UUID) -> bool:
        result = await self._session.execute(
            select(Category.id).where(Category.user_id == user_id).limit(1)
        )
        return result.first() is not None

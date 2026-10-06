"""Entradas e saídas das rotas de Categorias (contracts/rest-api.md)."""

import uuid
from typing import Annotated, Self

from pydantic import BaseModel, StringConstraints

from app.modules.categories.models import Category, CategoryKind

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Nome de um ícone do conjunto adotado, como `shopping-cart`. O frontend desenha um ícone
# neutro para um nome que não conhece.
Icon = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]
# A cor é conferida no serviço, contra a paleta, para a mensagem dizer o que escolher.
Color = Annotated[str, StringConstraints(max_length=40)]


class CategoryCreate(BaseModel):
    name: Name
    kind: CategoryKind
    # Com `parent_id`, cria uma subcategoria.
    parent_id: uuid.UUID | None = None
    icon: Icon
    color: Color


class CategoryUpdate(BaseModel):
    """Só os campos enviados mudam."""

    name: Name | None = None
    icon: Icon | None = None
    color: Color | None = None


class CategoryRead(BaseModel):
    id: uuid.UUID
    name: str
    kind: CategoryKind
    parent_id: uuid.UUID | None
    icon: str
    color: str
    # A "Outros" de cada tipo: não pode ser arquivada.
    is_fallback: bool
    archived: bool
    children: list["CategoryRead"]

    @classmethod
    def from_category(cls, category: Category, children: list["CategoryRead"]) -> Self:
        return cls(
            id=category.id,
            name=category.name,
            kind=CategoryKind(category.kind),
            parent_id=category.parent_id,
            icon=category.icon,
            color=str(category.color),
            is_fallback=category.is_fallback,
            archived=category.archived_at is not None,
            children=children,
        )


class CategoryTree(BaseModel):
    """Árvore de dois níveis por tipo, com a "Outros" por último."""

    expense: list[CategoryRead]
    income: list[CategoryRead]

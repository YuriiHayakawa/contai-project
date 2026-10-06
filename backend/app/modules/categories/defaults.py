"""Categorias e subcategorias com que todo usuário novo começa (FR-024).

As cores seguem a tabela de categorias padrão do design system (seção 2.3) e os ícones são
nomes do conjunto de `frontend/src/components/ui/category-icons.ts`. A "Outros" de cada tipo é
a categoria de reserva: usa a cor neutra e não pode ser arquivada.
"""

from dataclasses import dataclass

from app.modules.categories.models import CategoryColor, CategoryKind

FALLBACK_NAME = "Outros"
FALLBACK_ICON = "shapes"


@dataclass(frozen=True)
class DefaultCategory:
    name: str
    icon: str
    color: CategoryColor
    # Subcategorias, como pares (nome, ícone); usam a cor da categoria mãe.
    children: tuple[tuple[str, str], ...] = ()
    is_fallback: bool = False


_FALLBACK = DefaultCategory(FALLBACK_NAME, FALLBACK_ICON, CategoryColor.ARDOSIA, is_fallback=True)

DEFAULT_CATEGORIES: dict[CategoryKind, tuple[DefaultCategory, ...]] = {
    CategoryKind.EXPENSE: (
        DefaultCategory(
            "Alimentação",
            "utensils",
            CategoryColor.CAQUI,
            (
                ("Mercado", "shopping-cart"),
                ("Delivery", "shopping-bag"),
                ("Restaurante", "utensils"),
            ),
        ),
        DefaultCategory(
            "Transporte",
            "car",
            CategoryColor.TINTA,
            (("Combustível", "fuel"), ("Transporte público", "bus"), ("Aplicativo e táxi", "car")),
        ),
        DefaultCategory(
            "Moradia",
            "house",
            CategoryColor.MATA,
            (
                ("Aluguel", "house"),
                ("Contas da casa", "lightbulb"),
                ("Internet e telefone", "wifi"),
                ("Manutenção", "wrench"),
            ),
        ),
        DefaultCategory("Lazer", "ticket", CategoryColor.GOIABA),
        DefaultCategory(
            "Saúde",
            "heart-pulse",
            CategoryColor.PITANGA,
            (("Farmácia", "pill"), ("Consultas e exames", "stethoscope")),
        ),
        DefaultCategory("Educação", "graduation-cap", CategoryColor.AMEIXA),
        DefaultCategory("Assinaturas", "repeat", CategoryColor.PISCINA),
        _FALLBACK,
    ),
    CategoryKind.INCOME: (
        DefaultCategory("Salário", "banknote", CategoryColor.MOSTARDA),
        DefaultCategory("Renda extra", "hand-coins", CategoryColor.PISCINA),
        DefaultCategory("Rendimentos", "trending-up", CategoryColor.MATA),
        _FALLBACK,
    ),
}

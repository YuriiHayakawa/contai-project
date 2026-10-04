"""Conferência numérica da resposta do assistente: todo valor em reais e todo percentual do
texto precisa estar nos resultados das ferramentas (FR-062)."""

import pytest

from app.modules.assistant import validation
from app.modules.assistant.tools.base import ToolResult, money, percent

SPENDING = ToolResult(
    data={
        "period": {"from": "2026-10-01", "to": "2026-10-31", "label": "outubro de 2026"},
        "total": money(84_230),
        "groups": [
            {"name": "Mercado", "amount": money(60_000), "percent": percent(71.2)},
            {"name": "Restaurante", "amount": money(24_230), "percent": percent(28.8)},
        ],
    },
    highlight=money(84_230)["formatted"],
    summary="Despesas em outubro de 2026: R$ 842,30, em 23 lançamentos.",
)
CARD = ToolResult(
    data={"accounts": [{"name": "Cartão Verde", "balance": money(-1_500)}]},
    summary="Saldo de hoje: Cartão Verde: \N{MINUS SIGN}R$ 15,00.",
)
COMPARISON = ToolResult(
    data={"total": {"difference": money(12_345_67), "change_percent": percent(12)}},
    summary="Despesas em outubro de 2026: R$ 842,30; em setembro de 2026: R$ 600,00.",
)
RESULTS = [SPENDING, CARD, COMPARISON]


@pytest.mark.parametrize(
    "text",
    [
        "Você gastou R$ 842,30 com Alimentação em outubro de 2026.",
        # O espaço pode ser o comum ou o não separável, e pode faltar.
        "Você gastou R$\N{NO-BREAK SPACE}842,30 com Alimentação.",
        "Foram R$842,30 no mês.",
        "Foram 842,30 reais, sendo R$ 600,00 no Mercado (71,2%) e R$ 242,30 em Restaurante.",
        "Mercado ficou com 71,2 % do total e Restaurante com 28,8%.",
        # O sinal não conta: dever R$ 15,00 é o saldo negativo de R$ 15,00.
        "Você deve R$ 15,00 no Cartão Verde.",
        "O saldo do cartão é \N{MINUS SIGN}R$ 15,00.",
        "A diferença foi de R$ 12.345,67, um aumento de 12%.",
        "A diferença foi de 12,0%.",
        "Não há lançamentos nesse período.",
        "Foram 23 lançamentos em 2026, 5 deles no dia 10/09.",
    ],
)
def test_a_text_with_only_values_from_the_tool_results_passes(text: str) -> None:
    assert validation.unsupported_values(text, RESULTS) == []


@pytest.mark.parametrize(
    ("text", "unsupported"),
    [
        ("Você gastou R$ 850,00 com Alimentação.", ["R$ 850,00"]),
        ("Você gastou cerca de R$ 842 no mês.", ["R$ 842"]),
        ("Foram R$ 842,30, ou R$ 27,17 por dia.", ["R$ 27,17"]),
        ("Mercado ficou com 70% do total.", ["70%"]),
        ("O total foi de 900 reais.", ["900 reais"]),
        ("Somando tudo dá R$ 1.442,30.", ["R$ 1.442,30"]),
        ("Você gastou R$ 842.30.", ["R$ 842"]),
    ],
    ids=[
        "valor inventado",
        "valor arredondado",
        "conta feita pelo modelo",
        "percentual inventado",
        "valor por extenso inventado",
        "soma feita pelo modelo",
        "formato de outro país",
    ],
)
def test_a_value_or_percent_missing_from_the_results_is_refused(
    text: str, unsupported: list[str]
) -> None:
    assert validation.unsupported_values(text, RESULTS) == unsupported


def test_without_tool_results_any_value_is_unsupported() -> None:
    assert validation.unsupported_values("Você gastou R$ 842,30.", []) == ["R$ 842,30"]
    assert validation.unsupported_values("De qual mês você quer saber?", []) == []


def test_error_results_do_not_support_values() -> None:
    failed = ToolResult(data={"error": "A categoria não existe.", "cents": 84_230}, is_error=True)

    # O serviço só passa adiante os resultados que deram certo.
    assert validation.fallback_answer([failed]) is None


def test_the_highlight_is_the_main_value_as_written_in_the_text() -> None:
    text = "Em outubro de 2026 você gastou R$\N{NO-BREAK SPACE}842,30, sendo R$ 600,00 no Mercado."

    assert validation.highlight_of(text, [SPENDING]) == "R$\N{NO-BREAK SPACE}842,30"
    # Sem o valor principal de uma ferramenta no texto, vale o primeiro valor citado.
    assert validation.highlight_of("O Mercado levou R$ 600,00.", [SPENDING]) == "R$ 600,00"
    assert validation.highlight_of("Você deve R$ 15,00 no cartão.", [CARD]) == "R$ 15,00"
    assert validation.highlight_of("Não há lançamentos nesse período.", [SPENDING]) is None


def test_the_fallback_answer_is_built_from_the_results_by_fixed_text() -> None:
    assert validation.fallback_answer([SPENDING]) == SPENDING.summary
    several = validation.fallback_answer(RESULTS)
    assert several == (
        "Estes são os números dos seus lançamentos:\n"
        "- Despesas em outubro de 2026: R$ 842,30, em 23 lançamentos.\n"
        "- Saldo de hoje: Cartão Verde: \N{MINUS SIGN}R$ 15,00.\n"
        "- Despesas em outubro de 2026: R$ 842,30; em setembro de 2026: R$ 600,00."
    )
    # A resposta de reserva passa pela própria conferência.
    assert validation.unsupported_values(several, RESULTS) == []
    assert validation.fallback_answer([]) is None

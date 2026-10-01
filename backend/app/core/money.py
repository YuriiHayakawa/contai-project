"""Dinheiro: sempre inteiros em centavos. `float` não é usado em nenhum cálculo."""

import re
from decimal import Decimal, InvalidOperation

NBSP = "\N{NO-BREAK SPACE}"
MINUS = "\N{MINUS SIGN}"

_GROUP_OF_THREE = re.compile(r"^\d{1,3}(\.\d{3})+$")


def split_installments(total_cents: int, count: int) -> list[int]:
    """Divide um total em parcelas iguais; os centavos que sobram vão para a primeira."""
    if total_cents <= 0:
        raise ValueError("o total precisa ser maior que zero")
    if count < 1:
        raise ValueError("o número de parcelas precisa ser pelo menos 1")
    base, remainder = divmod(total_cents, count)
    return [base + remainder, *([base] * (count - 1))]


def format_brl(cents: int) -> str:
    """Formata centavos no padrão brasileiro, por exemplo `R$ 1.234,56`."""
    reais, centavos = divmod(abs(cents), 100)
    grouped = f"{reais:,}".replace(",", ".")
    sign = MINUS if cents < 0 else ""
    return f"{sign}R${NBSP}{grouped},{centavos:02d}"


def parse_brl(text: str) -> int:
    """Converte um valor digitado em centavos.

    Aceita `45`, `45,9`, `45,90`, `1.234,56`, `1234.56` e `R$ 45,90`. Um ponto seguido de
    exatamente três algarismos (`1.234`) é separador de milhar, como no padrão brasileiro.
    """
    cleaned = text.strip().replace("R$", "").replace(NBSP, "").replace(" ", "")
    if not cleaned or not re.fullmatch(r"[\d.,]+", cleaned):
        raise ValueError("valor inválido")

    if "," in cleaned:
        integer_part, _, decimal_part = cleaned.rpartition(",")
        normalized = f"{integer_part.replace('.', '')}.{decimal_part}"
    elif _GROUP_OF_THREE.match(cleaned):
        normalized = cleaned.replace(".", "")
    else:
        normalized = cleaned

    try:
        value = Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError("valor inválido") from exc

    cents = value * 100
    if cents != cents.to_integral_value():
        raise ValueError("o valor tem mais de duas casas decimais")
    return int(cents)

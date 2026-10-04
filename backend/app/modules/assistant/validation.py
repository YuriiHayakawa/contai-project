"""Conferência numérica da resposta do assistente (FR-062).

Todo valor em reais e todo percentual do texto final precisa existir nos resultados das
ferramentas daquela pergunta. É isto que torna "a IA não inventa números" algo verificável: um
valor que o modelo estimou, somou por conta própria ou trouxe de outra conversa não está nos
resultados, e a resposta é recusada.

Quando a resposta é recusada duas vezes, o texto sai dos próprios resultados, por frases fixas.
"""

import re
from collections.abc import Iterable, Sequence
from decimal import Decimal
from typing import Any

from app.modules.assistant.tools.base import ToolResult

# `R$ 1.234,56`, `R$ 45` e `R$1234,5`; o `\s` aceita também o espaço não separável.
_REAIS = re.compile(r"R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?")
# `45,90 reais` e `1.234 reais`.
_IN_WORDS = re.compile(r"(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s+reais\b")
_PERCENT = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")

NOTHING_TO_SHOW = (
    "Não consegui calcular isso com segurança agora. Tente perguntar de outro jeito, dizendo o "
    "período e o que você quer saber."
)
_FALLBACK_INTRO = "Estes são os números dos seus lançamentos:"


def _cents(match: re.Match[str]) -> int:
    reais = int(match[1].replace(".", ""))
    return reais * 100 + int((match[2] or "").ljust(2, "0"))


def _decimal(text: str) -> Decimal:
    return Decimal(text.replace(",", ".")).normalize()


def money_in(text: str) -> list[tuple[str, int]]:
    """Os valores em reais do texto, na ordem, como foram escritos e em centavos."""
    found = [(match.start(), match[0], _cents(match)) for match in _REAIS.finditer(text)]
    found += [(match.start(), match[0], _cents(match)) for match in _IN_WORDS.finditer(text)]
    return [(written, cents) for _, written, cents in sorted(found)]


def percents_in(text: str) -> list[tuple[str, Decimal]]:
    return [(match[0], _decimal(match[1])) for match in _PERCENT.finditer(text)]


def _walk(value: Any) -> Iterable[tuple[str, Any]]:
    """Todos os pares de chave e valor de um resultado, em qualquer profundidade."""
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key, inner
            yield from _walk(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _walk(inner)


def supported_values(results: Sequence[ToolResult]) -> tuple[set[int], set[Decimal]]:
    """Os valores, em centavos, e os percentuais que as ferramentas devolveram."""
    cents: set[int] = set()
    percents: set[Decimal] = set()
    for result in results:
        for key, value in _walk(result.data):
            if key == "cents" and isinstance(value, int):
                # O sinal não conta: quem diz "deve R$ 15,00" não inventou o valor.
                cents.add(abs(value))
            elif key.endswith("percent") and isinstance(value, str):
                percents.update(number for _, number in percents_in(value))
    return cents, percents


def unsupported_values(text: str, results: Sequence[ToolResult]) -> list[str]:
    """Os valores e percentuais do texto que não estão em nenhum resultado, como escritos."""
    cents, percents = supported_values(results)
    missing = [written for written, value in money_in(text) if value not in cents]
    missing += [written for written, value in percents_in(text) if value not in percents]
    return missing


def highlight_of(text: str, results: Sequence[ToolResult]) -> str | None:
    """O valor principal da resposta, como está escrito nela.

    É o valor principal de uma das ferramentas, se o texto o cita; senão, o primeiro valor em
    reais do texto, que a conferência já garantiu que veio dos resultados.
    """
    written = money_in(text)
    by_cents = {cents: shown for shown, cents in reversed(written)}
    for result in reversed(results):
        if result.highlight is None:
            continue
        for _, cents in money_in(result.highlight):
            if cents in by_cents:
                return by_cents[cents]
    return written[0][0] if written else None


def fallback_answer(results: Sequence[ToolResult]) -> str | None:
    """A resposta montada dos próprios resultados, por frases fixas; `None` sem resultados."""
    lines = [result.summary for result in results if result.summary and not result.is_error]
    if not lines:
        return None
    if len(lines) == 1:
        return lines[0]
    return "\n".join([_FALLBACK_INTRO, *(f"- {line}" for line in lines)])

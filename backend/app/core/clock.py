"""Relógio da aplicação: "agora", "hoje" e meses no fuso de Brasília.

Toda regra que depende do tempo usa este módulo, e não `datetime.now()` direto. Isso mantém o
fuso em um só lugar e permite que os testes fixem o instante.
"""

import calendar
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

SAO_PAULO = ZoneInfo("America/Sao_Paulo")

MONTH_NAMES = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)

_fixed_now: datetime | None = None


def set_fixed_time(moment: datetime | None) -> None:
    """Fixa o instante devolvido por `utcnow` (uso em testes); `None` volta ao relógio real."""
    global _fixed_now
    if moment is not None and moment.tzinfo is None:
        raise ValueError("o instante fixo precisa ter fuso")
    _fixed_now = moment


def utcnow() -> datetime:
    """Instante atual, com fuso UTC."""
    if _fixed_now is not None:
        return _fixed_now.astimezone(UTC)
    return datetime.now(UTC)


def now() -> datetime:
    """Instante atual no fuso de Brasília."""
    return utcnow().astimezone(SAO_PAULO)


def today() -> date:
    """Data de hoje no fuso de Brasília."""
    return now().date()


def month_bounds(day: date) -> tuple[date, date]:
    """Primeiro e último dia do mês de `day`."""
    last_day = calendar.monthrange(day.year, day.month)[1]
    return day.replace(day=1), day.replace(day=last_day)


def month_name(day: date) -> str:
    """O mês de `day` por extenso, com o ano: "outubro de 2026"."""
    return f"{MONTH_NAMES[day.month - 1]} de {day.year}"


def add_months(day: date, months: int) -> date:
    """Soma meses a uma data; em mês mais curto, usa o último dia dele."""
    month_index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(month_index, 12)
    month += 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))

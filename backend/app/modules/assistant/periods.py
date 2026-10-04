"""O parâmetro `period` das ferramentas do assistente (contracts/assistant-tools.md).

O modelo nunca calcula datas: ele escolhe um período simbólico, e o backend o resolve no fuso
de Brasília, com um rótulo em português para a resposta.

Todo período que inclui o mês atual o inclui inteiro, como o painel: assim o número do
assistente é o mesmo do painel para o mesmo mês (FR-062), mesmo com lançamentos de data futura.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core import clock
from app.modules.dashboard.service import Period

Preset = Literal[
    "this_month", "last_month", "month", "last_n_months", "this_year", "last_year", "custom"
]

_REQUIRED: dict[str, tuple[str, ...]] = {
    "month": ("year", "month"),
    "last_n_months": ("n",),
    "custom": ("from_", "to"),
}
_NAMES = {"from_": "from"}


class PeriodParam(BaseModel):
    """Período simbólico escolhido pelo modelo."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    preset: Preset = Field(
        description=(
            "this_month: o mês atual; last_month: o mês anterior; month: um mês específico "
            "(year e month); last_n_months: os últimos n meses, com o atual; this_year: o ano "
            "atual até o mês atual; last_year: o ano anterior; custom: datas ditas pelo "
            "usuário (from e to)."
        )
    )
    year: int | None = Field(default=None, ge=2000, le=2100, description="Só com preset=month.")
    month: int | None = Field(default=None, ge=1, le=12, description="Só com preset=month.")
    n: int | None = Field(default=None, ge=1, le=24, description="Só com preset=last_n_months.")
    from_: dt.date | None = Field(
        default=None, alias="from", description="Só com preset=custom: primeiro dia, AAAA-MM-DD."
    )
    to: dt.date | None = Field(
        default=None, description="Só com preset=custom: último dia, AAAA-MM-DD."
    )

    @model_validator(mode="after")
    def _has_what_the_preset_needs(self) -> Self:
        missing = [
            _NAMES.get(name, name)
            for name in _REQUIRED.get(self.preset, ())
            if getattr(self, name) is None
        ]
        if missing:
            raise ValueError(f"o preset {self.preset} precisa de: {', '.join(missing)}")
        if self.from_ is not None and self.to is not None and self.from_ > self.to:
            raise ValueError("no preset custom, from não pode ser depois de to")
        return self


@dataclass(frozen=True)
class ResolvedPeriod:
    """O período em datas, com o primeiro e o último dia incluídos, e como chamá-lo."""

    start: dt.date
    end: dt.date
    label: str

    @property
    def period(self) -> Period:
        return Period(self.start, self.end)

    def echo(self) -> dict[str, str]:
        """Como o período volta nos resultados das ferramentas."""
        return {"from": self.start.isoformat(), "to": self.end.isoformat(), "label": self.label}


def _span_label(first_month: dt.date, last_month: dt.date) -> str:
    """Um intervalo de meses inteiros: "outubro de 2026", "agosto a outubro de 2026"."""
    if (first_month.year, first_month.month) == (last_month.year, last_month.month):
        return clock.month_name(last_month)
    first = clock.MONTH_NAMES[first_month.month - 1]
    if first_month.year != last_month.year:
        first = clock.month_name(first_month)
    return f"{first} a {clock.month_name(last_month)}"


def _whole_months(start: dt.date, end: dt.date) -> bool:
    return start.day == 1 and end == clock.month_bounds(end)[1]


def _months(first_month: dt.date, last_month: dt.date) -> ResolvedPeriod:
    return ResolvedPeriod(
        start=first_month.replace(day=1),
        end=clock.month_bounds(last_month)[1],
        label=_span_label(first_month, last_month),
    )


def resolve(period: PeriodParam, today: dt.date | None = None) -> ResolvedPeriod:
    """As datas e o rótulo de um período simbólico; "hoje" é o dia em Brasília."""
    today = today or clock.today()
    this_month = today.replace(day=1)

    if period.preset == "this_month":
        return _months(this_month, this_month)
    if period.preset == "last_month":
        last_month = clock.add_months(this_month, -1)
        return _months(last_month, last_month)
    if period.preset == "month" and period.year is not None and period.month is not None:
        month = dt.date(period.year, period.month, 1)
        return _months(month, month)
    if period.preset == "last_n_months" and period.n is not None:
        return _months(clock.add_months(this_month, 1 - period.n), this_month)
    if period.preset == "this_year":
        return _months(this_month.replace(month=1), this_month)
    if period.preset == "last_year":
        year = today.year - 1
        return ResolvedPeriod(dt.date(year, 1, 1), dt.date(year, 12, 31), label=str(year))
    if period.from_ is None or period.to is None:  # pragma: no cover - garantido pelo validador
        raise ValueError("período sem datas")
    if _whole_months(period.from_, period.to):
        return _months(period.from_, period.to)
    return ResolvedPeriod(
        period.from_, period.to, label=f"{period.from_:%d/%m/%Y} a {period.to:%d/%m/%Y}"
    )

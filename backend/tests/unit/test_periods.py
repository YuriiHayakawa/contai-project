"""O parâmetro `period` das ferramentas do assistente: cada preset resolvido em datas, no fuso
de Brasília, com o rótulo em português."""

import datetime as dt
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from app.core import clock
from app.modules.assistant.periods import PeriodParam, resolve
from app.modules.dashboard.service import Period

TODAY = dt.date(2026, 10, 3)


def _resolve(today: dt.date = TODAY, **period: Any) -> tuple[str, str, str]:
    resolved = resolve(PeriodParam.model_validate(period), today)
    return resolved.start.isoformat(), resolved.end.isoformat(), resolved.label


@pytest.mark.parametrize(
    ("period", "expected"),
    [
        ({"preset": "this_month"}, ("2026-10-01", "2026-10-31", "outubro de 2026")),
        ({"preset": "last_month"}, ("2026-09-01", "2026-09-30", "setembro de 2026")),
        (
            {"preset": "month", "year": 2026, "month": 2},
            ("2026-02-01", "2026-02-28", "fevereiro de 2026"),
        ),
        (
            {"preset": "last_n_months", "n": 3},
            ("2026-08-01", "2026-10-31", "agosto a outubro de 2026"),
        ),
        ({"preset": "last_n_months", "n": 1}, ("2026-10-01", "2026-10-31", "outubro de 2026")),
        (
            {"preset": "last_n_months", "n": 12},
            ("2025-11-01", "2026-10-31", "novembro de 2025 a outubro de 2026"),
        ),
        ({"preset": "this_year"}, ("2026-01-01", "2026-10-31", "janeiro a outubro de 2026")),
        ({"preset": "last_year"}, ("2025-01-01", "2025-12-31", "2025")),
        (
            {"preset": "custom", "from": "2026-09-10", "to": "2026-09-20"},
            ("2026-09-10", "2026-09-20", "10/09/2026 a 20/09/2026"),
        ),
        (
            {"preset": "custom", "from": "2026-08-01", "to": "2026-09-30"},
            ("2026-08-01", "2026-09-30", "agosto a setembro de 2026"),
        ),
    ],
    ids=[
        "este mês",
        "mês passado",
        "um mês específico",
        "últimos 3 meses",
        "último mês é o atual",
        "últimos 12 meses atravessam o ano",
        "este ano",
        "ano passado",
        "datas ditas pelo usuário",
        "datas que são meses inteiros",
    ],
)
def test_each_preset_becomes_dates_and_a_label_in_portuguese(
    period: dict[str, Any], expected: tuple[str, str, str]
) -> None:
    assert _resolve(**period) == expected


def test_the_current_month_is_the_whole_month_like_the_dashboard() -> None:
    # O painel mostra o mês inteiro, com os lançamentos de data futura: o assistente também.
    resolved = resolve(PeriodParam(preset="this_month"), TODAY)

    assert resolved.period == Period.of_month(TODAY)
    assert resolved.echo() == {"from": "2026-10-01", "to": "2026-10-31", "label": "outubro de 2026"}


def test_january_edges() -> None:
    january = dt.date(2027, 1, 15)

    assert _resolve(january, preset="last_month") == (
        "2026-12-01",
        "2026-12-31",
        "dezembro de 2026",
    )
    assert _resolve(january, preset="this_year") == ("2027-01-01", "2027-01-31", "janeiro de 2027")
    assert _resolve(january, preset="last_n_months", n=2) == (
        "2026-12-01",
        "2027-01-31",
        "dezembro de 2026 a janeiro de 2027",
    )


def test_today_is_the_day_in_sao_paulo() -> None:
    # 02:30 UTC de 1º de novembro ainda é 31 de outubro em São Paulo.
    clock.set_fixed_time(datetime(2026, 11, 1, 2, 30, tzinfo=UTC))
    try:
        assert resolve(PeriodParam(preset="this_month")).label == "outubro de 2026"
    finally:
        clock.set_fixed_time(None)


@pytest.mark.parametrize(
    ("period", "message"),
    [
        ({"preset": "month", "year": 2026}, "month"),
        ({"preset": "month"}, "year, month"),
        ({"preset": "last_n_months"}, "n"),
        ({"preset": "custom", "from": "2026-09-01"}, "to"),
        ({"preset": "custom", "from": "2026-09-20", "to": "2026-09-10"}, "from não pode"),
        ({"preset": "month", "year": 2026, "month": 13}, "less than or equal to 12"),
        ({"preset": "last_n_months", "n": 25}, "less than or equal to 24"),
        ({"preset": "next_month"}, "preset"),
        ({"preset": "this_month", "user_id": "x"}, "user_id"),
    ],
    ids=[
        "mês sem o número do mês",
        "mês sem ano nem mês",
        "últimos meses sem n",
        "datas sem o fim",
        "datas invertidas",
        "mês 13",
        "mais de 24 meses",
        "preset que não existe",
        "campo que não existe",
    ],
)
def test_an_incomplete_or_wrong_period_is_refused_saying_what_is_missing(
    period: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValidationError) as raised:
        PeriodParam.model_validate(period)

    assert message in str(raised.value)

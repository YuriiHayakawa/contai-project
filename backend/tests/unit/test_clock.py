from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest

from app.core import clock


@pytest.fixture(autouse=True)
def _reset_clock() -> Iterator[None]:
    yield
    clock.set_fixed_time(None)


def test_today_follows_sao_paulo_not_utc() -> None:
    # 02:30 UTC do dia 1º ainda é 23:30 do dia 30 em Brasília.
    clock.set_fixed_time(datetime(2026, 10, 1, 2, 30, tzinfo=UTC))

    assert clock.today() == date(2026, 9, 30)
    assert clock.now().hour == 23


def test_utcnow_returns_fixed_moment_in_utc() -> None:
    moment = datetime(2026, 3, 15, 12, 0, tzinfo=clock.SAO_PAULO)
    clock.set_fixed_time(moment)

    assert clock.utcnow() == moment
    assert clock.utcnow().tzinfo == UTC


def test_fixed_time_requires_timezone() -> None:
    with pytest.raises(ValueError, match="fuso"):
        clock.set_fixed_time(datetime(2026, 1, 1))


def test_real_clock_is_timezone_aware() -> None:
    assert clock.utcnow().tzinfo is not None


@pytest.mark.parametrize(
    ("day", "first", "last"),
    [
        (date(2026, 9, 15), date(2026, 9, 1), date(2026, 9, 30)),
        (date(2026, 2, 28), date(2026, 2, 1), date(2026, 2, 28)),
        (date(2028, 2, 10), date(2028, 2, 1), date(2028, 2, 29)),
        (date(2026, 12, 31), date(2026, 12, 1), date(2026, 12, 31)),
    ],
)
def test_month_bounds(day: date, first: date, last: date) -> None:
    assert clock.month_bounds(day) == (first, last)


@pytest.mark.parametrize(
    ("day", "months", "expected"),
    [
        (date(2026, 1, 15), 1, date(2026, 2, 15)),
        (date(2026, 1, 31), 1, date(2026, 2, 28)),
        (date(2028, 1, 31), 1, date(2028, 2, 29)),
        (date(2026, 10, 31), 1, date(2026, 11, 30)),
        (date(2026, 11, 30), 2, date(2027, 1, 30)),
        (date(2026, 12, 10), 1, date(2027, 1, 10)),
        (date(2026, 3, 31), -1, date(2026, 2, 28)),
        (date(2026, 5, 20), 0, date(2026, 5, 20)),
        (date(2026, 1, 31), 47, date(2029, 12, 31)),
    ],
)
def test_add_months(day: date, months: int, expected: date) -> None:
    assert clock.add_months(day, months) == expected

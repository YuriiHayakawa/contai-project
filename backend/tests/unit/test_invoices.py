"""Faturas de cartão (FR-031, research.md seção 17): derivadas das datas, nunca armazenadas.

Com fechamento no dia F (limitado ao último dia do mês), uma compra na data d entra na fatura
que fecha na primeira data de fechamento posterior a d: a compra feita no próprio dia de
fechamento já é da fatura seguinte.
"""

from datetime import date

import pytest

from app.modules.transactions.invoices import (
    Invoice,
    closing_date,
    current_invoice,
    due_date_after,
    invoice_closing_in,
    invoice_for,
    is_after_invoice,
    next_invoice,
    previous_invoice,
)


def test_purchase_before_closing_day_enters_the_invoice_that_closes_on_it() -> None:
    invoice = invoice_for(date(2026, 10, 9), closing_day=10, due_day=17)

    assert invoice == Invoice(
        period_start=date(2026, 9, 10),
        period_end=date(2026, 10, 9),
        closing_date=date(2026, 10, 10),
        due_date=date(2026, 10, 17),
    )


def test_purchase_on_the_closing_day_enters_the_next_invoice() -> None:
    invoice = invoice_for(date(2026, 10, 10), closing_day=10, due_day=17)

    assert invoice.closing_date == date(2026, 11, 10)
    assert (invoice.period_start, invoice.period_end) == (date(2026, 10, 10), date(2026, 11, 9))


def test_purchase_after_the_closing_day_enters_the_next_invoice() -> None:
    assert invoice_for(date(2026, 10, 25), closing_day=10, due_day=17).closing_date == date(
        2026, 11, 10
    )


def test_consecutive_invoices_cover_every_day_once() -> None:
    day = date(2026, 1, 1)
    seen: list[Invoice] = []
    while day <= date(2026, 12, 31):
        invoice = invoice_for(day, closing_day=31, due_day=8)
        assert invoice.period_start <= day <= invoice.period_end
        if not seen or seen[-1] != invoice:
            if seen:
                # A fatura seguinte começa no dia de fechamento da anterior: sem buraco.
                assert invoice.period_start == seen[-1].closing_date
            seen.append(invoice)
        day = date.fromordinal(day.toordinal() + 1)


@pytest.mark.parametrize(
    ("closing_day", "february_closing"),
    [
        (28, date(2026, 2, 28)),
        (29, date(2026, 2, 28)),
        (30, date(2026, 2, 28)),
        (31, date(2026, 2, 28)),
    ],
)
def test_closing_day_past_the_end_of_a_short_month_uses_its_last_day(
    closing_day: int, february_closing: date
) -> None:
    assert closing_date(2026, 2, closing_day) == february_closing


def test_closing_day_31_in_a_leap_february_and_in_a_30_day_month() -> None:
    assert closing_date(2028, 2, 31) == date(2028, 2, 29)
    assert closing_date(2026, 4, 31) == date(2026, 4, 30)
    assert closing_date(2026, 5, 31) == date(2026, 5, 31)


def test_closing_day_31_puts_the_last_day_of_february_in_the_march_invoice() -> None:
    february = invoice_for(date(2026, 2, 27), closing_day=31, due_day=10)
    on_closing = invoice_for(date(2026, 2, 28), closing_day=31, due_day=10)

    assert february.closing_date == date(2026, 2, 28)
    assert february.period_start == date(2026, 1, 31)
    assert on_closing.closing_date == date(2026, 3, 31)
    assert on_closing.period_start == date(2026, 2, 28)


@pytest.mark.parametrize(
    ("closing", "due_day", "expected"),
    [
        # Vencimento depois do fechamento no mesmo mês.
        (date(2026, 10, 3), 10, date(2026, 10, 10)),
        # Vencimento com dia menor que o do fechamento: é no mês seguinte.
        (date(2026, 10, 25), 5, date(2026, 11, 5)),
        # Vencimento no mesmo dia do fechamento não existe: vai para o mês seguinte.
        (date(2026, 10, 10), 10, date(2026, 11, 10)),
        # Dia 31 de vencimento em mês curto usa o último dia.
        (date(2026, 2, 20), 31, date(2026, 2, 28)),
        (date(2026, 1, 31), 31, date(2026, 2, 28)),
        (date(2028, 1, 31), 30, date(2028, 2, 29)),
        (date(2026, 3, 31), 31, date(2026, 4, 30)),
    ],
)
def test_due_date_is_the_first_due_day_after_the_closing(
    closing: date, due_day: int, expected: date
) -> None:
    assert due_date_after(closing, due_day) == expected


def test_the_current_invoice_is_the_one_that_contains_today() -> None:
    today = date(2026, 10, 2)

    invoice = current_invoice(today, closing_day=3, due_day=10)

    assert invoice.period_start <= today <= invoice.period_end
    assert (invoice.closing_date, invoice.due_date) == (date(2026, 10, 3), date(2026, 10, 10))
    # No dia do fechamento, a fatura atual já é a seguinte.
    assert current_invoice(date(2026, 10, 3), closing_day=3, due_day=10).closing_date == date(
        2026, 11, 3
    )


def test_future_installments_are_the_ones_in_invoices_after_the_current_one() -> None:
    current = current_invoice(date(2026, 10, 2), closing_day=3, due_day=10)

    assert not is_after_invoice(date(2026, 10, 2), current)
    assert not is_after_invoice(date(2026, 9, 3), current)
    # A partir do fechamento, a compra já é da fatura seguinte.
    assert is_after_invoice(date(2026, 10, 3), current)
    assert is_after_invoice(date(2027, 2, 15), current)


@pytest.mark.parametrize("day", [0, 32, -1])
def test_days_outside_1_to_31_are_refused(day: int) -> None:
    with pytest.raises(ValueError):
        closing_date(2026, 10, day)
    with pytest.raises(ValueError):
        due_date_after(date(2026, 10, 3), day)


@pytest.mark.parametrize(("closing_day", "due_day"), [(3, 10), (28, 5), (31, 8), (1, 8), (30, 31)])
def test_each_month_has_one_invoice_that_closes_in_it(closing_day: int, due_day: int) -> None:
    for month in range(1, 13):
        invoice = invoice_closing_in(2026, month, closing_day=closing_day, due_day=due_day)

        assert invoice.closing_date == closing_date(2026, month, closing_day)
        assert invoice == invoice_for(invoice.period_end, closing_day=closing_day, due_day=due_day)


def test_the_invoice_that_closes_on_the_first_day_holds_the_whole_previous_month() -> None:
    invoice = invoice_closing_in(2026, 3, closing_day=1, due_day=8)

    assert invoice == Invoice(
        period_start=date(2026, 2, 1),
        period_end=date(2026, 2, 28),
        closing_date=date(2026, 3, 1),
        due_date=date(2026, 3, 8),
    )


def test_the_invoice_can_be_due_in_the_month_after_it_closes() -> None:
    # Fecha no dia 28 e vence no dia 5: a que fecha em setembro vence em outubro.
    invoice = invoice_closing_in(2026, 9, closing_day=28, due_day=5)

    assert (invoice.closing_date, invoice.due_date) == (date(2026, 9, 28), date(2026, 10, 5))


def test_next_and_previous_invoices_are_neighbours_without_a_gap() -> None:
    days = {"closing_day": 31, "due_day": 8}
    january = invoice_closing_in(2026, 1, **days)

    february = next_invoice(january, **days)

    assert february.period_start == january.closing_date
    # Fevereiro não tem dia 31: a fatura fecha no dia 28.
    assert february.closing_date == date(2026, 2, 28)
    assert previous_invoice(february, **days) == january

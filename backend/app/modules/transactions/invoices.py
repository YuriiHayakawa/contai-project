"""Faturas de cartão: funções puras sobre datas, sem banco (research.md, seção 17).

A fatura não é guardada: ela é derivada do dia de fechamento e do dia de vencimento do cartão.
Com fechamento no dia F, limitado ao último dia de cada mês, uma compra na data d entra na
fatura que fecha na primeira data de fechamento posterior a d. Por isso a compra feita no
próprio dia de fechamento já é da fatura seguinte.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from app.core import clock


@dataclass(frozen=True)
class Invoice:
    """Uma fatura: as compras de `period_start` a `period_end`, os dois dias incluídos."""

    period_start: date
    period_end: date
    closing_date: date
    due_date: date


def _day_in_month(year: int, month: int, day: int) -> date:
    """O dia pedido no mês; em mês mais curto, o último dia dele (31 em fevereiro vira 28)."""
    if not 1 <= day <= 31:
        raise ValueError("o dia precisa estar entre 1 e 31")
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def closing_date(year: int, month: int, closing_day: int) -> date:
    """Data em que a fatura do mês fecha."""
    return _day_in_month(year, month, closing_day)


def due_date_after(closing: date, due_day: int) -> date:
    """Primeiro dia de vencimento depois do fechamento: no mesmo mês ou no seguinte."""
    same_month = _day_in_month(closing.year, closing.month, due_day)
    if same_month > closing:
        return same_month
    following = clock.add_months(closing.replace(day=1), 1)
    return _day_in_month(following.year, following.month, due_day)


def invoice_for(day: date, *, closing_day: int, due_day: int) -> Invoice:
    """A fatura de uma compra feita em `day`."""
    closing = closing_date(day.year, day.month, closing_day)
    if day >= closing:
        following = clock.add_months(day.replace(day=1), 1)
        closing = closing_date(following.year, following.month, closing_day)
    previous = clock.add_months(closing.replace(day=1), -1)
    return Invoice(
        # A compra do dia de fechamento anterior já é desta fatura.
        period_start=closing_date(previous.year, previous.month, closing_day),
        period_end=closing - timedelta(days=1),
        closing_date=closing,
        due_date=due_date_after(closing, due_day),
    )


def current_invoice(today: date, *, closing_day: int, due_day: int) -> Invoice:
    """A fatura atual é a que contém hoje."""
    return invoice_for(today, closing_day=closing_day, due_day=due_day)


def is_after_invoice(day: date, invoice: Invoice) -> bool:
    """Uma compra nessa data cai em uma fatura posterior a esta."""
    return day >= invoice.closing_date

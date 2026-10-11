"""Relatórios: resumo do período, gastos por categoria, evolução por mês e maiores gastos.

O `ReportingService` é a única fonte dos números do painel e do assistente: os dois chamam os
mesmos métodos, e por isso mostram sempre os mesmos valores (FR-062).
"""

import datetime as dt
import re
import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Self

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import NotFound, ValidationFailed
from app.modules.accounts.models import AccountType
from app.modules.accounts.schemas import AccountRead
from app.modules.accounts.service import AccountService
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.dashboard.repository import NO_FILTERS, ReportFilters, ReportRepository
from app.modules.dashboard.schemas import (
    AccountBalance,
    CardInvoice,
    CardInvoices,
    CardSummary,
    CategoryBreakdown,
    CategorySpending,
    ClosedInvoiceDue,
    CreditLimitUsage,
    FutureInstallments,
    InvoicePayment,
    InvoiceStatus,
    InvoiceSummary,
    MonthAmount,
    MonthTotals,
    PeriodTotals,
    SubcategorySpending,
)
from app.modules.transactions.invoices import (
    Invoice,
    current_invoice,
    invoice_closing_in,
    invoice_for,
    next_invoice,
    previous_invoice,
)
from app.modules.transactions.models import TransactionType
from app.modules.transactions.schemas import TransactionRead

INVALID_MONTH = "Escreva o mês como AAAA-MM, por exemplo 2026-10."

_MONTH_PATTERN = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")
# Anos fora desta faixa só aparecem por engano de digitação.
_MIN_YEAR, _MAX_YEAR = 1900, 2200
_ONE_DECIMAL = Decimal("0.1")
# Até onde a tela de um cartão volta e avança a partir da fatura atual. Para a frente, cabem
# todas as parcelas de uma compra, que são no máximo 48.
MAX_PAST_INVOICES = 36
MAX_FUTURE_INVOICES = 48


@dataclass(frozen=True)
class Period:
    """Intervalo de datas de calendário, com o primeiro e o último dia incluídos."""

    start: dt.date
    end: dt.date

    @classmethod
    def of_month(cls, day: dt.date) -> Self:
        """O mês inteiro de `day`, inclusive os dias que ainda não chegaram."""
        return cls(*clock.month_bounds(day))


GroupBy = Literal["none", "category", "subcategory", "account", "month"]


@dataclass(frozen=True)
class AmountGroup:
    """Uma fatia de um total: uma categoria, uma conta ou um mês."""

    name: str
    amount_cents: int
    # Parte do total, de 0 a 100, com uma casa; `None` quando a fatia não é parte de um todo
    # (os meses de um período).
    percent: float | None


@dataclass(frozen=True)
class AmountBreakdown:
    total_cents: int
    groups: list[AmountGroup]


def resolve_month(value: str | None, *, field: str = "month") -> dt.date:
    """Primeiro dia do mês pedido (`AAAA-MM`); sem valor, o do mês atual em Brasília (FR-059)."""
    if value is None:
        return clock.today().replace(day=1)
    match = _MONTH_PATTERN.fullmatch(value)
    if match is None or not _MIN_YEAR <= int(match[1]) <= _MAX_YEAR:
        raise ValidationFailed(details={"fields": {field: INVALID_MONTH}})
    return dt.date(int(match[1]), int(match[2]), 1)


def month_label(day: dt.date) -> str:
    """O mês de `day` como aparece nas respostas: `AAAA-MM`."""
    return f"{day.year:04d}-{day.month:02d}"


def card_reference_date(first_day: dt.date) -> dt.date:
    """Dia em que se olha a fatura de um mês: hoje, no mês atual; o último dia, num mês que já
    passou; o primeiro dia, num mês que ainda vem."""
    today = clock.today()
    if (first_day.year, first_day.month) == (today.year, today.month):
        return today
    return clock.month_bounds(first_day)[1] if first_day < today else first_day


def _card_days(card: AccountRead) -> dict[str, int]:
    if card.closing_day is None or card.due_day is None:  # pragma: no cover - CHECK
        raise ValueError("só cartão de crédito tem fatura")
    return {"closing_day": card.closing_day, "due_day": card.due_day}


def _totals(income_cents: int, expense_cents: int) -> dict[str, int]:
    return {
        "income_cents": income_cents,
        "expense_cents": expense_cents,
        "net_cents": income_cents - expense_cents,
    }


def _percent(amount_cents: int, total_cents: int) -> float:
    """Parte do total, de 0 a 100, com uma casa. A conta é decimal; só o resultado vira float.

    Uma categoria que ficou negativa por um estorno não tem parte do total: vale zero.
    """
    if amount_cents <= 0 or total_cents <= 0:
        return 0.0
    share = (Decimal(amount_cents) * 100 / Decimal(total_cents)).quantize(
        _ONE_DECIMAL, rounding=ROUND_HALF_UP
    )
    return float(share)


def _largest_first(amount_cents: int, name: str) -> tuple[int, str]:
    return -amount_cents, name.casefold()


def _groups(amounts: dict[str, int]) -> list[AmountGroup]:
    """As fatias de um total, da maior para a menor, com a parte de cada uma. Como no painel,
    a base do percentual é a soma das fatias positivas."""
    base = sum(amount for amount in amounts.values() if amount > 0)
    return [
        AmountGroup(name=name, amount_cents=amount, percent=_percent(amount, base))
        for name, amount in sorted(
            amounts.items(), key=lambda pair: _largest_first(pair[1], pair[0])
        )
        if amount != 0
    ]


class ReportingService:
    def __init__(self, session: AsyncSession) -> None:
        self._reports = ReportRepository(session)
        self._categories = CategoryRepository(session)
        self._accounts = AccountService(session)

    async def totals(self, user_id: uuid.UUID, period: Period) -> PeriodTotals:
        """Entradas, saídas e saldo do período; transferências não contam (FR-033), e um
        estorno abate as saídas em vez de somar nas entradas."""
        by_type = await self._reports.totals_by_type(user_id, start=period.start, end=period.end)
        return PeriodTotals(
            **_totals(
                by_type.get(TransactionType.INCOME, 0), by_type.get(TransactionType.EXPENSE, 0)
            )
        )

    async def account_balances(self, user_id: uuid.UUID) -> list[AccountBalance]:
        """Saldo de hoje de cada conta ativa, em ordem alfabética (FR-055)."""
        return [
            AccountBalance(
                id=account.id,
                name=account.name,
                type=account.type,
                balance_cents=account.balance_cents,
            )
            for account in await self._accounts.list(user_id)
        ]

    async def spending_by_category(
        self, user_id: uuid.UUID, period: Period, *, filters: ReportFilters = NO_FILTERS
    ) -> CategoryBreakdown:
        """Gasto por categoria principal, com o das subcategorias somado nela (FR-056).

        Um estorno abate o gasto da categoria dele. Quando ele cai em um mês diferente do da
        compra, a categoria fica negativa naquele mês: ela aparece com o valor negativo, no fim
        da lista e sem percentual, e a soma das categorias continua igual ao total de saídas.
        Uma categoria arquivada continua aparecendo enquanto tiver gasto no período (FR-026).
        """
        amounts = await self._reports.expenses_by_category(
            user_id, start=period.start, end=period.end, filters=filters
        )
        if not amounts:
            return CategoryBreakdown(total_cents=0, items=[])
        total = sum(amounts.values())

        categories = {
            category.id: category
            for category in await self._categories.list_all(user_id, include_archived=True)
        }
        by_parent: dict[uuid.UUID, int] = {}
        children: dict[uuid.UUID, list[tuple[Category, int]]] = {}
        for category_id, amount in amounts.items():
            category = categories[category_id]
            parent_id = category.parent_id or category.id
            by_parent[parent_id] = by_parent.get(parent_id, 0) + amount
            if category.parent_id is not None:
                children.setdefault(parent_id, []).append((category, amount))
        # O percentual é a parte de cada categoria no que foi gasto de fato: as negativas ficam
        # de fora da base, e as outras somam 100.
        spent = sum(amount for amount in by_parent.values() if amount > 0)

        items = [
            CategorySpending(
                category_id=parent_id,
                name=categories[parent_id].name,
                icon=categories[parent_id].icon,
                color=str(categories[parent_id].color),
                amount_cents=amount,
                percent=_percent(amount, spent),
                subcategories=[
                    SubcategorySpending(
                        category_id=child.id,
                        name=child.name,
                        icon=child.icon,
                        color=str(child.color),
                        amount_cents=child_amount,
                        percent=_percent(child_amount, spent),
                    )
                    for child, child_amount in sorted(
                        children.get(parent_id, []),
                        key=lambda pair: _largest_first(pair[1], pair[0].name),
                    )
                ],
            )
            for parent_id, amount in sorted(
                by_parent.items(),
                key=lambda pair: _largest_first(pair[1], categories[pair[0]].name),
            )
        ]
        return CategoryBreakdown(total_cents=total, items=items)

    async def monthly_trend(
        self, user_id: uuid.UUID, *, until: dt.date, months: int
    ) -> list[MonthTotals]:
        """Entradas e saídas de cada um dos `months` meses que terminam no mês de `until`.

        Do mais antigo para o mais novo; um mês sem lançamentos vem com zeros (FR-057).
        """
        first_days = [
            clock.add_months(until.replace(day=1), -offset) for offset in reversed(range(months))
        ]
        by_month = await self._reports.totals_by_month(
            user_id, start=first_days[0], end=clock.month_bounds(first_days[-1])[1]
        )
        return [
            MonthTotals(
                month=label,
                **_totals(
                    by_month.get((label, TransactionType.INCOME), 0),
                    by_month.get((label, TransactionType.EXPENSE), 0),
                ),
            )
            for label in map(month_label, first_days)
        ]

    async def top_expenses(
        self,
        user_id: uuid.UUID,
        period: Period,
        *,
        limit: int,
        filters: ReportFilters = NO_FILTERS,
    ) -> list[TransactionRead]:
        """As maiores despesas do período, da maior para a menor (FR-057)."""
        transactions = await self._reports.top_expenses(
            user_id, start=period.start, end=period.end, limit=limit, filters=filters
        )
        return [TransactionRead.from_transaction(transaction) for transaction in transactions]

    async def amounts(
        self,
        user_id: uuid.UUID,
        period: Period,
        *,
        kind: CategoryKind,
        filters: ReportFilters = NO_FILTERS,
        group_by: GroupBy = "none",
    ) -> AmountBreakdown:
        """Saídas (`expense`) ou entradas (`income`) de um período, com um recorte e uma
        quebra à escolha. É o relatório das perguntas do assistente.

        Sem recorte, o total é o do resumo do painel, e a quebra por categoria é a do gráfico
        de categorias: as somas saem das mesmas regras (FR-062).
        """
        total = (
            await self._reports.amounts(
                user_id, kind=kind, filters=filters, start=period.start, end=period.end
            )
        )[None]
        if group_by == "none":
            return AmountBreakdown(total_cents=total, groups=[])
        if group_by == "month":
            by_month = await self._reports.amounts(
                user_id,
                kind=kind,
                filters=filters,
                group="month",
                start=period.start,
                end=period.end,
            )
            months: list[dt.date] = []
            day = period.start.replace(day=1)
            while day <= period.end:
                months.append(day)
                day = clock.add_months(day, 1)
            # Do mês mais antigo para o mais novo; mês sem lançamentos vem com zero.
            return AmountBreakdown(
                total_cents=total,
                groups=[
                    AmountGroup(
                        name=clock.month_name(month),
                        amount_cents=by_month.get(month_label(month), 0),
                        percent=None,
                    )
                    for month in months
                ],
            )
        if group_by == "account":
            by_account = await self._reports.amounts(
                user_id,
                kind=kind,
                filters=filters,
                group="account",
                start=period.start,
                end=period.end,
            )
            names = {
                account.id: account.name
                for account in await self._accounts.list(user_id, include_archived=True)
            }
            named = {names[account_id]: amount for account_id, amount in by_account.items()}
            return AmountBreakdown(total_cents=total, groups=_groups(named))

        by_category = await self._reports.amounts(
            user_id,
            kind=kind,
            filters=filters,
            group="category",
            start=period.start,
            end=period.end,
        )
        categories = {
            category.id: category
            for category in await self._categories.list_all(user_id, include_archived=True)
        }
        named = {}
        for category_id, amount in by_category.items():
            category = categories[category_id]
            parent = categories[category.parent_id] if category.parent_id else None
            if group_by == "category":
                # Como no painel: o gasto da subcategoria soma na categoria principal.
                name = (parent or category).name
            else:
                name = f"{parent.name} > {category.name}" if parent else category.name
            named[name] = named.get(name, 0) + amount
        return AmountBreakdown(total_cents=total, groups=_groups(named))

    async def entry_ids(
        self,
        user_id: uuid.UUID,
        period: Period,
        *,
        kind: CategoryKind,
        filters: ReportFilters = NO_FILTERS,
        limit: int,
    ) -> tuple[list[uuid.UUID], int]:
        """Os ids das transações que compõem `amounts`, até `limit`, e quantas são (FR-063)."""
        return await self._reports.entry_ids(
            user_id, start=period.start, end=period.end, kind=kind, filters=filters, limit=limit
        )

    async def card_entry_ids(
        self, user_id: uuid.UUID, card: CardSummary, *, limit: int
    ) -> tuple[list[uuid.UUID], int]:
        """As compras da fatura aberta de um cartão e as parcelas que ainda vêm."""
        return await self._reports.card_entry_ids(
            user_id, card.account_id, start=card.current_invoice.period_start, limit=limit
        )

    async def _open_charges(self, user_id: uuid.UUID, card: AccountRead) -> int:
        """Gastos menos estornos da fatura atual do cartão que já pesam no saldo hoje.

        É o que o pagamento da fatura atual tem de cobrir. Fica à parte porque o que falta
        pagar da fatura fechada e o "pagar adiantado" saem dos mesmos números.
        """
        days = _card_days(card)
        today = clock.today()
        open_invoice = current_invoice(today, **days)
        # O saldo só conta o que vem depois da data do saldo inicial e até hoje.
        by_type = await self._reports.account_totals_by_type(
            user_id,
            card.id,
            start=max(open_invoice.period_start, card.initial_balance_date),
            end=today,
        )
        return by_type.get(TransactionType.EXPENSE, 0) - by_type.get(TransactionType.INCOME, 0)

    @staticmethod
    def _current_invoice_paid(*, balance_cents: int, open_charges_cents: int) -> bool:
        """A fatura atual está paga adiantado (FR-086): já tem compras que pesam hoje e o cartão
        não tem dívida. Como a fatura atual é a mais nova, qualquer dívida é dela primeiro; logo,
        sem dívida (saldo >= 0) o que ela tem de compras já está coberto por pagamentos."""
        return open_charges_cents > 0 and balance_cents >= 0

    async def invoice_payment(self, user_id: uuid.UUID, card: AccountRead) -> InvoicePayment:
        """O que pagar no cartão hoje (FR-033): a última fatura fechada, se ainda falta pagar
        algo dela, e o total devido.

        Os pagamentos quitam primeiro as faturas mais antigas. Por isso o que falta das
        fechadas é o total devido menos as compras da fatura aberta que já pesam no saldo.
        """
        days = _card_days(card)
        open_charges = await self._open_charges(user_id, card)
        debt = -card.balance_cents
        # Um estorno na fatura aberta não faz a fechada passar do que se deve.
        closed_due = min(debt - open_charges, debt)
        # A última fatura fechada: a que fecha na véspera do início da fatura atual.
        open_invoice = current_invoice(clock.today(), **days)
        closed = invoice_for(open_invoice.period_start - dt.timedelta(days=1), **days)
        return InvoicePayment(
            closed_invoice=ClosedInvoiceDue(
                closing_date=closed.closing_date,
                due_date=closed.due_date,
                amount_cents=closed_due,
            )
            if closed_due > 0
            else None,
            total_due_cents=max(debt, 0),
        )

    async def credit_limit(self, user_id: uuid.UUID, card: AccountRead) -> CreditLimitUsage | None:
        """Quanto do limite do cartão está ocupado hoje (FR-088); `None` sem limite informado.

        O usado é o que se deve hoje mais o que já está lançado no cartão para depois de hoje.
        Assim uma compra parcelada ocupa o limite pelo valor inteiro desde o lançamento, e a
        parcela da fatura atual que ainda não chegou também conta, embora ainda não pese no
        saldo. Um saldo a favor abate o que está por vir, e o usado nunca fica negativo.
        """
        if card.credit_limit_cents is None:
            return None
        tomorrow = clock.today() + dt.timedelta(days=1)
        by_type = await self._reports.account_totals_by_type(
            user_id,
            card.id,
            # O que vem antes da data do saldo inicial nunca vai pesar no saldo.
            start=max(tomorrow, card.initial_balance_date),
            end=dt.date.max,
        )
        upcoming = by_type.get(TransactionType.EXPENSE, 0) - by_type.get(TransactionType.INCOME, 0)
        used = max(upcoming - card.balance_cents, 0)
        return CreditLimitUsage(
            limit_cents=card.credit_limit_cents,
            used_cents=used,
            available_cents=card.credit_limit_cents - used,
        )

    async def cards(self, user_id: uuid.UUID, *, reference: dt.date) -> list[CardSummary]:
        """Por cartão ativo: a fatura que contém `reference` e as parcelas das faturas
        seguintes, por mês de vencimento e no total (FR-058), o que pagar nele hoje e quanto
        do limite está ocupado."""
        today = clock.today()
        summaries: list[CardSummary] = []
        for card in await self._accounts.list(user_id):
            if card.type != AccountType.CREDIT_CARD:
                continue
            if card.closing_day is None or card.due_day is None:  # pragma: no cover - CHECK
                continue
            days = {"closing_day": card.closing_day, "due_day": card.due_day}
            invoice = current_invoice(reference, **days)
            by_type = await self._reports.account_totals_by_type(
                user_id, card.id, start=invoice.period_start, end=invoice.period_end
            )
            by_month: dict[str, int] = {}
            for day, amount in await self._reports.installments_from(
                user_id, card.id, start=invoice.closing_date
            ):
                label = month_label(invoice_for(day, **days).due_date)
                by_month[label] = by_month.get(label, 0) + amount
            summaries.append(
                CardSummary(
                    account_id=card.id,
                    name=card.name,
                    closing_day=card.closing_day,
                    due_day=card.due_day,
                    current_invoice=InvoiceSummary(
                        period_start=invoice.period_start,
                        period_end=invoice.period_end,
                        closing_date=invoice.closing_date,
                        due_date=invoice.due_date,
                        # Compras menos estornos; o pagamento é transferência e não entra.
                        amount_cents=by_type.get(TransactionType.EXPENSE, 0)
                        - by_type.get(TransactionType.INCOME, 0),
                    ),
                    future_installments=FutureInstallments(
                        total_cents=sum(by_month.values()),
                        months=[
                            MonthAmount(month=month, amount_cents=amount)
                            for month, amount in sorted(by_month.items())
                        ],
                    ),
                    payment=await self.invoice_payment(user_id, card),
                    credit_limit=await self.credit_limit(user_id, card),
                    # Só a fatura atual de verdade (a que contém hoje) pode estar paga adiantado;
                    # num mês que passou, a fatura mostrada é outra.
                    current_invoice_paid=self._current_invoice_paid(
                        balance_cents=card.balance_cents,
                        open_charges_cents=(
                            await self._open_charges(user_id, card)
                            if invoice.closing_date == current_invoice(today, **days).closing_date
                            else 0
                        ),
                    ),
                )
            )
        return summaries

    async def _card(self, user_id: uuid.UUID, account_id: uuid.UUID) -> AccountRead:
        """O cartão pedido. Uma conta de outro tipo responde como a que não existe."""
        card = await self._accounts.get(user_id, account_id)
        if card.type != AccountType.CREDIT_CARD:
            raise NotFound()
        return card

    async def card_invoices(self, user_id: uuid.UUID, account_id: uuid.UUID) -> CardInvoices:
        """As faturas de um cartão, da mais antiga para a mais nova, com o estado de cada uma.

        Os pagamentos quitam primeiro as faturas mais antigas. Por isso o que se deve das
        fechadas é repartido da mais nova para a mais antiga, cada uma até o valor das próprias
        compras. A última fechada fica a pagar enquanto houver dívida das fechadas, mesmo a que
        veio do saldo inicial do cartão e não está em compra nenhuma.
        """
        card = await self._card(user_id, account_id)
        days = _card_days(card)
        today = clock.today()
        current = current_invoice(today, **days)
        last_closed = previous_invoice(current, **days)
        closing_month = current.closing_date.replace(day=1)
        oldest, newest = (
            clock.add_months(closing_month, months)
            for months in (-MAX_PAST_INVOICES, MAX_FUTURE_INVOICES)
        )

        amounts: dict[dt.date, int] = {}
        for day, kind, amount in await self._reports.account_entries_by_day(
            user_id,
            card.id,
            start=invoice_closing_in(oldest.year, oldest.month, **days).period_start,
            end=invoice_closing_in(newest.year, newest.month, **days).period_end,
        ):
            closing = invoice_for(day, **days).closing_date
            # Compras menos estornos; o pagamento é transferência e não entra.
            signed = amount if kind == TransactionType.EXPENSE else -amount
            amounts[closing] = amounts.get(closing, 0) + signed

        first = min([last_closed.closing_date, *amounts])
        last = max([current.closing_date, *amounts])
        invoices = [invoice_for(first - dt.timedelta(days=1), **days)]
        while invoices[-1].closing_date < last:
            invoices.append(next_invoice(invoices[-1], **days))

        payment = await self.invoice_payment(user_id, card)
        open_charges = await self._open_charges(user_id, card)
        owed = payment.closed_invoice.amount_cents if payment.closed_invoice else 0
        remaining: dict[dt.date, int] = {}
        left = owed
        for invoice in reversed(invoices):
            if invoice.closing_date > last_closed.closing_date:
                continue
            share = min(max(amounts.get(invoice.closing_date, 0), 0), left)
            remaining[invoice.closing_date] = share
            left -= share

        def status(invoice: Invoice) -> InvoiceStatus:
            if invoice.closing_date > current.closing_date:
                return InvoiceStatus.FUTURE
            if invoice.closing_date == current.closing_date:
                if self._current_invoice_paid(
                    balance_cents=card.balance_cents, open_charges_cents=open_charges
                ):
                    return InvoiceStatus.PAID_AHEAD
                return InvoiceStatus.OPEN
            unpaid = owed if invoice == last_closed else remaining[invoice.closing_date]
            if unpaid <= 0:
                return InvoiceStatus.PAID
            return InvoiceStatus.OVERDUE if today > invoice.due_date else InvoiceStatus.DUE

        return CardInvoices(
            account_id=card.id,
            name=card.name,
            closing_day=days["closing_day"],
            due_day=days["due_day"],
            items=[
                CardInvoice(
                    period_start=invoice.period_start,
                    period_end=invoice.period_end,
                    closing_date=invoice.closing_date,
                    due_date=invoice.due_date,
                    amount_cents=amounts.get(invoice.closing_date, 0),
                    status=status(invoice),
                    remaining_cents=remaining.get(invoice.closing_date, 0),
                )
                for invoice in invoices
            ],
            payment=payment,
            credit_limit=await self.credit_limit(user_id, card),
        )

    async def invoice_categories(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, closing_month: dt.date
    ) -> CategoryBreakdown:
        """Para onde foi o gasto da fatura que fecha no mês de `closing_month`: as compras do
        cartão no período dela, por categoria principal, como no painel."""
        card = await self._card(user_id, account_id)
        invoice = invoice_closing_in(closing_month.year, closing_month.month, **_card_days(card))
        return await self.spending_by_category(
            user_id,
            Period(invoice.period_start, invoice.period_end),
            filters=ReportFilters(account_ids=[card.id]),
        )

"""Saídas dos relatórios e das rotas do Painel (contracts/rest-api.md).

Todo valor é um inteiro em centavos. Um mês é escrito como `AAAA-MM`.
"""

import datetime as dt
import uuid
from enum import StrEnum

from pydantic import BaseModel

from app.modules.accounts.models import AccountType
from app.modules.transactions.schemas import TransactionRead


class PeriodTotals(BaseModel):
    """Entradas, saídas e saldo de um período. Transferências não entram em nenhum dos três."""

    # Receitas, sem os estornos.
    income_cents: int
    # Despesas menos os estornos (receitas lançadas em categoria de despesa).
    expense_cents: int
    # Entradas menos saídas; negativo quando o período fechou no vermelho.
    net_cents: int


class AccountBalance(BaseModel):
    id: uuid.UUID
    name: str
    type: AccountType
    # Saldo inicial mais as transações entre a data de referência e hoje (FR-023).
    balance_cents: int


class SubcategorySpending(BaseModel):
    category_id: uuid.UUID
    name: str
    icon: str
    color: str
    amount_cents: int
    # Parte do total de despesas do período, como a da categoria principal.
    percent: float


class CategorySpending(BaseModel):
    """Gastos de uma categoria principal, já com os das subcategorias somados."""

    category_id: uuid.UUID
    name: str
    icon: str
    color: str
    # Despesas menos estornos; negativo quando o estorno cai em um mês e a compra, em outro.
    amount_cents: int
    # Parte do que foi gasto no período, de 0 a 100, com uma casa decimal; zero se o valor é
    # negativo.
    percent: float
    # Só as subcategorias com gasto no período. O que foi lançado direto na categoria
    # principal está em `amount_cents` e não aparece aqui.
    subcategories: list[SubcategorySpending]


class CategoryBreakdown(BaseModel):
    # Total de saídas do período, igual a `expense_cents` do resumo: a soma de `amount_cents`
    # das categorias.
    total_cents: int
    # Da categoria com mais gasto para a com menos, com as negativas no fim; categorias sem
    # gasto, ou em que compra e estorno se anulam, não aparecem.
    items: list[CategorySpending]


class MonthTotals(PeriodTotals):
    month: str


# ---------- respostas das rotas


class DashboardSummary(PeriodTotals):
    month: str
    # Contas ativas, em ordem alfabética, com o saldo de hoje.
    accounts: list[AccountBalance]


class DashboardCategories(CategoryBreakdown):
    month: str


class DashboardTrend(BaseModel):
    # Do mês mais antigo para o mais novo; mês sem lançamentos vem com zeros.
    items: list[MonthTotals]


class DashboardTopExpenses(BaseModel):
    month: str
    # Da maior despesa para a menor.
    items: list[TransactionRead]


class InvoiceSummary(BaseModel):
    """Fatura de um cartão: as compras de `period_start` a `period_end`, inclusive."""

    period_start: dt.date
    period_end: dt.date
    closing_date: dt.date
    due_date: dt.date
    # Compras menos estornos do período. O pagamento da fatura é transferência e não entra.
    amount_cents: int


class MonthAmount(BaseModel):
    month: str
    amount_cents: int


class FutureInstallments(BaseModel):
    """Parcelas que caem em faturas depois da atual."""

    total_cents: int
    # Por mês de vencimento da fatura em que cada parcela cai, do mais próximo ao mais distante.
    months: list[MonthAmount]


class ClosedInvoiceDue(BaseModel):
    """A última fatura fechada, com o que ainda falta pagar dela."""

    closing_date: dt.date
    due_date: dt.date
    # O que se deve das faturas fechadas: as compras delas menos os pagamentos já feitos.
    amount_cents: int


class InvoicePayment(BaseModel):
    """O que pagar no cartão hoje, seja qual for o mês pedido."""

    # Null quando as faturas fechadas já estão pagas e só a atual, ainda aberta, tem valor.
    closed_invoice: ClosedInvoiceDue | None
    # Tudo o que se deve no cartão hoje, inclusive as compras da fatura que ainda não fechou.
    total_due_cents: int


class CardSummary(BaseModel):
    account_id: uuid.UUID
    name: str
    closing_day: int
    due_day: int
    current_invoice: InvoiceSummary
    future_installments: FutureInstallments
    payment: InvoicePayment


class DashboardCards(BaseModel):
    # Cartões ativos, em ordem alfabética.
    items: list[CardSummary]


class InvoiceStatus(StrEnum):
    """Em que ponto a fatura está hoje."""

    # Fechada e sem nada a pagar.
    PAID = "paid"
    # Fechada, com valor a pagar e dentro do prazo.
    DUE = "due"
    # Fechada, com valor a pagar e vencida.
    OVERDUE = "overdue"
    # A atual: ainda recebe compras.
    OPEN = "open"
    # Ainda não começou: só tem as parcelas e as compras já lançadas com data futura.
    FUTURE = "future"


class CardInvoice(InvoiceSummary):
    status: InvoiceStatus
    # O que falta pagar desta fatura, com os pagamentos quitando primeiro as mais antigas.
    # Zero fora de `due` e `overdue`; na última fatura fechada, o total a pagar hoje está em
    # `payment.closed_invoice`, que soma o que ficou das anteriores.
    remaining_cents: int


class CardInvoices(BaseModel):
    """As faturas de um cartão, para a tela dele."""

    account_id: uuid.UUID
    name: str
    closing_day: int
    due_day: int
    # Da mais antiga para a mais nova: da primeira com lançamento até a última com parcela,
    # sempre com a última fechada e a atual.
    items: list[CardInvoice]
    payment: InvoicePayment

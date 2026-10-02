"""Saídas dos relatórios e das rotas do Painel (contracts/rest-api.md).

Todo valor é um inteiro em centavos. Um mês é escrito como `AAAA-MM`.
"""

import uuid

from pydantic import BaseModel

from app.modules.accounts.models import AccountType
from app.modules.transactions.schemas import TransactionRead


class PeriodTotals(BaseModel):
    """Entradas, saídas e saldo de um período. Transferências não entram em nenhum dos três."""

    income_cents: int
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
    amount_cents: int
    # Parte do total de despesas do período, de 0 a 100, com uma casa decimal.
    percent: float
    # Só as subcategorias com gasto no período. O que foi lançado direto na categoria
    # principal está em `amount_cents` e não aparece aqui.
    subcategories: list[SubcategorySpending]


class CategoryBreakdown(BaseModel):
    # Total de despesas do período: a soma de `amount_cents` das categorias.
    total_cents: int
    # Da categoria com mais gasto para a com menos; categorias sem gasto não aparecem.
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

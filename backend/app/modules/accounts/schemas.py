"""Entradas e saídas das rotas de Contas (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Annotated, Self

from pydantic import BaseModel, Field, StringConstraints

from app.modules.accounts.models import Account, AccountType

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Institution = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
DayOfMonth = Annotated[int, Field(ge=1, le=31)]


class AccountCreate(BaseModel):
    name: Name
    type: AccountType
    institution: Institution | None = None
    # Com sinal: a dívida inicial de um cartão é negativa.
    initial_balance_cents: int = 0
    # Data de referência do saldo inicial; sem ela, vale o dia do cadastro.
    initial_balance_date: dt.date | None = None
    # Só para cartão de crédito, em que os dois são obrigatórios.
    closing_day: DayOfMonth | None = None
    due_day: DayOfMonth | None = None


class AccountUpdate(BaseModel):
    """Só os campos enviados mudam. `institution: null` apaga a instituição."""

    name: Name | None = None
    # Só pode mudar enquanto a conta não tem transações.
    type: AccountType | None = None
    institution: Institution | None = None
    initial_balance_cents: int | None = None
    initial_balance_date: dt.date | None = None
    closing_day: DayOfMonth | None = None
    due_day: DayOfMonth | None = None


class AccountRead(BaseModel):
    id: uuid.UUID
    type: AccountType
    name: str
    institution: str | None
    initial_balance_cents: int
    initial_balance_date: dt.date
    closing_day: int | None
    due_day: int | None
    archived: bool
    # Saldo inicial mais as transações entre a data de referência e hoje (FR-023).
    balance_cents: int

    @classmethod
    def from_account(cls, account: Account, *, movement_cents: int) -> Self:
        return cls(
            id=account.id,
            type=AccountType(account.type),
            name=account.name,
            institution=account.institution,
            initial_balance_cents=account.initial_balance_cents,
            initial_balance_date=account.initial_balance_date,
            closing_day=account.closing_day,
            due_day=account.due_day,
            archived=account.archived_at is not None,
            balance_cents=account.initial_balance_cents + movement_cents,
        )


class AccountList(BaseModel):
    items: list[AccountRead]

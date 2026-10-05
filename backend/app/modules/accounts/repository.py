"""Acesso ao banco para contas. Todo método exige `user_id`.

A consulta de saldo lê a tabela de transações: o saldo é sempre calculado, nunca armazenado
(research.md, seção 17).
"""

import datetime as dt
import uuid

from sqlalchemy import BigInteger, case, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account, AccountType
from app.modules.transactions.models import Transaction, TransactionType, TransferDirection

# Receita e transferência recebida somam; despesa e transferência enviada subtraem.
_SIGNED_AMOUNT = case(
    (Transaction.type == TransactionType.INCOME, Transaction.amount_cents),
    (Transaction.type == TransactionType.EXPENSE, -Transaction.amount_cents),
    (Transaction.transfer_direction == TransferDirection.IN, Transaction.amount_cents),
    else_=-Transaction.amount_cents,
)


class AccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        user_id: uuid.UUID,
        *,
        name: str,
        account_type: AccountType,
        institution: str | None,
        initial_balance_cents: int,
        initial_balance_date: dt.date,
        closing_day: int | None,
        due_day: int | None,
        credit_limit_cents: int | None = None,
    ) -> Account:
        account = Account(
            user_id=user_id,
            name=name,
            type=account_type,
            institution=institution,
            initial_balance_cents=initial_balance_cents,
            initial_balance_date=initial_balance_date,
            closing_day=closing_day,
            due_day=due_day,
            credit_limit_cents=credit_limit_cents,
        )
        self._session.add(account)
        await self._session.flush()
        await self._session.refresh(account)
        return account

    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account | None:
        result = await self._session.execute(
            select(Account).where(Account.id == account_id, Account.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_all(
        self, user_id: uuid.UUID, *, include_archived: bool = False
    ) -> list[Account]:
        statement = select(Account).where(Account.user_id == user_id)
        if not include_archived:
            statement = statement.where(Account.archived_at.is_(None))
        result = await self._session.execute(
            statement.order_by(func.lower(Account.name), Account.id)
        )
        return list(result.scalars())

    async def find_active_by_name(self, user_id: uuid.UUID, name: str) -> Account | None:
        """Conta ativa com este nome, sem diferenciar maiúsculas de minúsculas."""
        result = await self._session.execute(
            select(Account).where(
                Account.user_id == user_id,
                Account.archived_at.is_(None),
                func.lower(Account.name) == name.lower(),
            )
        )
        return result.scalars().first()

    async def save(self, user_id: uuid.UUID, account: Account) -> Account:
        """Grava as alterações feitas em uma conta já carregada deste usuário."""
        if account.user_id != user_id:
            raise ValueError("a conta não é deste usuário")
        await self._session.flush()
        await self._session.refresh(account)
        return account

    async def delete(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(Account).where(Account.id == account_id, Account.user_id == user_id)
        )

    async def has_transactions(self, user_id: uuid.UUID, account_id: uuid.UUID) -> bool:
        result = await self._session.execute(
            select(Transaction.id)
            .where(Transaction.user_id == user_id, Transaction.account_id == account_id)
            .limit(1)
        )
        return result.first() is not None

    async def movements(self, user_id: uuid.UUID, *, today: dt.date) -> dict[uuid.UUID, int]:
        """Soma, por conta, das transações que entram no saldo (FR-023).

        Só contam as transações com data entre a data de referência do saldo inicial da conta
        (inclusive) e hoje (inclusive). Uma conta sem transações nesse intervalo não aparece.
        """
        total = cast(func.coalesce(func.sum(_SIGNED_AMOUNT), 0), BigInteger)
        result = await self._session.execute(
            select(Transaction.account_id, total)
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Transaction.user_id == user_id,
                Account.user_id == user_id,
                Transaction.date >= Account.initial_balance_date,
                Transaction.date <= today,
            )
            .group_by(Transaction.account_id)
        )
        return {account_id: int(amount) for account_id, amount in result.all()}

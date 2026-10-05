"""Acesso ao banco para transações. Todo método exige `user_id`."""

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import ColumnElement, delete, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account, AccountType
from app.modules.transactions.models import (
    Transaction,
    TransactionSource,
    TransactionType,
    TransferDirection,
)
from app.modules.transactions.normalize import strip_accents

# A busca por texto não diferencia acentos. `translate` tira os acentos no banco sem depender
# de extensão; as letras sem acento são comparadas sem diferenciar maiúsculas (`ILIKE`).
_ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ"
_PLAIN = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN"
_LIKE_ESCAPE = "\\"


@dataclass(frozen=True)
class TransactionFilters:
    """Filtros da busca; todos se combinam (FR-035). `None` significa "sem este filtro"."""

    date_from: dt.date | None = None
    date_to: dt.date | None = None
    account_id: uuid.UUID | None = None
    # Várias contas de uma vez, como o assistente pede.
    account_ids: list[uuid.UUID] | None = None
    # Já resolvido pelo serviço: a categoria pedida e as subcategorias dela.
    category_ids: list[uuid.UUID] | None = None
    transaction_type: TransactionType | None = None
    # Só despesas e receitas: o que compõe uma fatura de cartão, sem os pagamentos dela.
    without_transfers: bool = False
    text: str | None = None
    installment_group_id: uuid.UUID | None = None
    transfer_group_id: uuid.UUID | None = None
    ids: list[uuid.UUID] | None = field(default=None)


@dataclass(frozen=True)
class TransferTotals:
    """As transferências de uma busca, cada uma contada uma vez."""

    # Quantas transferências; as duas linhas de uma (saída e entrada) são um movimento só.
    count: int
    # Quantas linhas elas ocupam entre as encontradas.
    lines: int
    amount_cents: int


@dataclass(frozen=True)
class PageCursor:
    """Posição da última linha de uma página, na ordem da lista."""

    date: dt.date
    created_at: dt.datetime
    id: uuid.UUID


def _like_pattern(text: str) -> str:
    escaped = (
        strip_accents(text)
        .replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", f"{_LIKE_ESCAPE}%")
        .replace("_", f"{_LIKE_ESCAPE}_")
    )
    return f"%{escaped}%"


def matches_text(text: str) -> ColumnElement[bool]:
    """A descrição ou a observação contém o texto, sem diferenciar acentos nem maiúsculas."""
    pattern = _like_pattern(text)
    description = func.translate(Transaction.description, _ACCENTED, _PLAIN)
    notes = func.translate(func.coalesce(Transaction.notes, ""), _ACCENTED, _PLAIN)
    return or_(
        description.ilike(pattern, escape=_LIKE_ESCAPE),
        notes.ilike(pattern, escape=_LIKE_ESCAPE),
    )


def _conditions(user_id: uuid.UUID, filters: TransactionFilters) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [Transaction.user_id == user_id]
    if filters.date_from is not None:
        conditions.append(Transaction.date >= filters.date_from)
    if filters.date_to is not None:
        conditions.append(Transaction.date <= filters.date_to)
    if filters.account_id is not None:
        conditions.append(Transaction.account_id == filters.account_id)
    if filters.account_ids is not None:
        conditions.append(Transaction.account_id.in_(filters.account_ids))
    if filters.category_ids is not None:
        conditions.append(Transaction.category_id.in_(filters.category_ids))
    if filters.transaction_type is not None:
        conditions.append(Transaction.type == filters.transaction_type)
    if filters.without_transfers:
        conditions.append(Transaction.type != TransactionType.TRANSFER)
    if filters.installment_group_id is not None:
        conditions.append(Transaction.installment_group_id == filters.installment_group_id)
    if filters.transfer_group_id is not None:
        conditions.append(Transaction.transfer_group_id == filters.transfer_group_id)
    if filters.ids is not None:
        conditions.append(Transaction.id.in_(filters.ids))
    if filters.text:
        conditions.append(matches_text(filters.text))
    return conditions


class TransactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        user_id: uuid.UUID,
        *,
        account_id: uuid.UUID,
        transaction_type: TransactionType,
        amount_cents: int,
        date: dt.date,
        description: str,
        description_normalized: str,
        fingerprint: str,
        created_at: dt.datetime,
        category_id: uuid.UUID | None = None,
        notes: str | None = None,
        transfer_direction: TransferDirection | None = None,
        transfer_group_id: uuid.UUID | None = None,
        installment_group_id: uuid.UUID | None = None,
        installment_number: int | None = None,
        installment_count: int | None = None,
        source: TransactionSource = TransactionSource.MANUAL,
        import_id: uuid.UUID | None = None,
        external_id: str | None = None,
    ) -> Transaction:
        transaction = Transaction(
            user_id=user_id,
            account_id=account_id,
            type=transaction_type,
            amount_cents=amount_cents,
            date=date,
            description=description,
            description_normalized=description_normalized,
            fingerprint=fingerprint,
            category_id=category_id,
            notes=notes,
            transfer_direction=transfer_direction,
            transfer_group_id=transfer_group_id,
            installment_group_id=installment_group_id,
            installment_number=installment_number,
            installment_count=installment_count,
            source=source,
            import_id=import_id,
            external_id=external_id,
            # O instante vem do relógio da aplicação: é ele que ordena os lançamentos do dia.
            created_at=created_at,
            updated_at=created_at,
        )
        self._session.add(transaction)
        await self._session.flush()
        await self._session.refresh(transaction)
        return transaction

    async def get(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction | None:
        result = await self._session.execute(
            select(Transaction).where(
                Transaction.id == transaction_id, Transaction.user_id == user_id
            )
        )
        return result.scalar_one_or_none()

    async def last_used_account_id(
        self, user_id: uuid.UUID, *, include_cards: bool = True
    ) -> uuid.UUID | None:
        """A conta ativa do lançamento criado por último, sem contar transferências.

        Com `include_cards=False`, os cartões de crédito ficam de fora: é a última conta em que
        faz sentido entrar dinheiro.
        """
        conditions = [
            Transaction.user_id == user_id,
            Transaction.type != TransactionType.TRANSFER,
            Account.archived_at.is_(None),
        ]
        if not include_cards:
            conditions.append(Account.type != AccountType.CREDIT_CARD)
        result = await self._session.execute(
            select(Transaction.account_id)
            .join(Account, Account.id == Transaction.account_id)
            .where(*conditions)
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def save(self, user_id: uuid.UUID, transaction: Transaction) -> Transaction:
        """Grava as alterações feitas em uma transação já carregada deste usuário."""
        if transaction.user_id != user_id:
            raise ValueError("a transação não é deste usuário")
        await self._session.flush()
        await self._session.refresh(transaction)
        return transaction

    async def delete(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(Transaction).where(
                Transaction.id == transaction_id, Transaction.user_id == user_id
            )
        )

    async def delete_many(self, user_id: uuid.UUID, transaction_ids: list[uuid.UUID]) -> None:
        await self._session.execute(
            delete(Transaction).where(
                Transaction.id.in_(transaction_ids), Transaction.user_id == user_id
            )
        )

    async def installments_from(
        self, user_id: uuid.UUID, group_id: uuid.UUID, first_number: int
    ) -> list[Transaction]:
        """Parcelas da compra a partir do número informado, em ordem."""
        result = await self._session.execute(
            select(Transaction)
            .where(
                Transaction.user_id == user_id,
                Transaction.installment_group_id == group_id,
                Transaction.installment_number >= first_number,
            )
            .order_by(Transaction.installment_number)
        )
        return list(result.scalars())

    async def transfer_lines(self, user_id: uuid.UUID, group_id: uuid.UUID) -> list[Transaction]:
        """As duas linhas de uma transferência: a de saída e a de entrada."""
        result = await self._session.execute(
            select(Transaction)
            .where(Transaction.user_id == user_id, Transaction.transfer_group_id == group_id)
            .order_by(Transaction.transfer_direction.desc())
        )
        return list(result.scalars())

    async def transfer_accounts(
        self, user_id: uuid.UUID, group_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[uuid.UUID | None, uuid.UUID | None]]:
        """De cada transferência, a conta de onde o dinheiro saiu e a conta em que entrou."""
        if not group_ids:
            return {}
        result = await self._session.execute(
            select(
                Transaction.transfer_group_id,
                Transaction.transfer_direction,
                Transaction.account_id,
            ).where(Transaction.user_id == user_id, Transaction.transfer_group_id.in_(group_ids))
        )
        sides: dict[uuid.UUID, dict[str, uuid.UUID]] = {}
        for group_id, direction, account_id in result.all():
            if group_id is not None:
                sides.setdefault(group_id, {})[str(direction)] = account_id
        return {
            group_id: (found.get(TransferDirection.OUT), found.get(TransferDirection.IN))
            for group_id, found in sides.items()
        }

    async def transfer_totals(
        self, user_id: uuid.UUID, filters: TransactionFilters
    ) -> TransferTotals:
        """Quantas transferências atendem aos filtros e quanto somam, cada uma uma vez."""
        one_per_transfer = (
            select(
                func.max(Transaction.amount_cents).label("amount_cents"),
                func.count().label("lines"),
            )
            .where(*_conditions(user_id, filters), Transaction.type == TransactionType.TRANSFER)
            .group_by(Transaction.transfer_group_id)
            .subquery()
        )
        result = await self._session.execute(
            select(
                func.count(),
                func.coalesce(func.sum(one_per_transfer.c.lines), 0),
                func.coalesce(func.sum(one_per_transfer.c.amount_cents), 0),
            ).select_from(one_per_transfer)
        )
        count, lines, amount = result.one()
        return TransferTotals(count=int(count), lines=int(lines), amount_cents=int(amount))

    async def delete_by_import(self, user_id: uuid.UUID, import_id: uuid.UUID) -> int:
        """Apaga, de uma vez, todas as transações criadas por uma importação (FR-052)."""
        result = await self._session.execute(
            delete(Transaction)
            .where(Transaction.user_id == user_id, Transaction.import_id == import_id)
            .returning(Transaction.id)
        )
        return len(result.scalars().all())

    async def taken_external_ids(
        self, user_id: uuid.UUID, account_id: uuid.UUID, external_ids: list[str]
    ) -> set[str]:
        """Dos identificadores externos informados, os que a conta já tem."""
        if not external_ids:
            return set()
        result = await self._session.execute(
            select(Transaction.external_id).where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                Transaction.external_id.in_(external_ids),
            )
        )
        return {external_id for external_id in result.scalars() if external_id is not None}

    async def possible_duplicates(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        *,
        date_from: dt.date,
        date_to: dt.date,
        external_ids: list[str],
    ) -> list[Transaction]:
        """Transações da conta que podem ser as mesmas de um arquivo importado.

        São as do intervalo de datas e, em qualquer data, as que têm um dos identificadores
        externos do arquivo. Da mais antiga para a mais nova.
        """
        in_period = Transaction.date.between(date_from, date_to)
        result = await self._session.execute(
            select(Transaction)
            .where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                or_(in_period, Transaction.external_id.in_(external_ids))
                if external_ids
                else in_period,
            )
            .order_by(Transaction.date, Transaction.created_at, Transaction.id)
        )
        return list(result.scalars())

    async def count(self, user_id: uuid.UUID, filters: TransactionFilters) -> int:
        result = await self._session.execute(
            select(func.count()).select_from(Transaction).where(*_conditions(user_id, filters))
        )
        return result.scalar_one()

    async def totals_by_type(
        self, user_id: uuid.UUID, filters: TransactionFilters
    ) -> dict[TransactionType, int]:
        """A soma dos valores de cada tipo entre as transações que atendem aos filtros."""
        result = await self._session.execute(
            select(Transaction.type, func.coalesce(func.sum(Transaction.amount_cents), 0))
            .where(*_conditions(user_id, filters))
            .group_by(Transaction.type)
        )
        return {TransactionType(kind): int(amount) for kind, amount in result.all()}

    async def search(
        self,
        user_id: uuid.UUID,
        filters: TransactionFilters,
        *,
        limit: int,
        after: PageCursor | None = None,
    ) -> list[Transaction]:
        """Transações que atendem aos filtros, da mais nova para a mais antiga.

        A ordem é data, instante do lançamento e id, todos decrescentes. `after` continua de
        onde a página anterior parou, sem repetir nem pular linhas.
        """
        order = (Transaction.date, Transaction.created_at, Transaction.id)
        statement = select(Transaction).where(*_conditions(user_id, filters))
        if after is not None:
            statement = statement.where(
                tuple_(*order) < tuple_(after.date, after.created_at, after.id)
            )
        statement = statement.order_by(*(column.desc() for column in order)).limit(limit)
        return list((await self._session.execute(statement)).scalars())

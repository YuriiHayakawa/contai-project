"""Regras de transações: criar, buscar, editar e excluir despesas e receitas."""

import base64
import binascii
import datetime as dt
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import NotFound, ValidationFailed
from app.modules.accounts.models import Account
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import Category
from app.modules.categories.repository import CategoryRepository
from app.modules.transactions.models import Transaction, TransactionType
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import (
    PageCursor,
    TransactionFilters,
    TransactionRepository,
)
from app.modules.transactions.schemas import (
    TransactionCreate,
    TransactionPage,
    TransactionRead,
    TransactionUpdate,
)

ACCOUNT_NOT_FOUND = "Escolha uma das suas contas."
ACCOUNT_ARCHIVED = "Esta conta está arquivada. Escolha outra conta ou desarquive esta."
CATEGORY_NOT_FOUND = "Escolha uma das suas categorias."
CATEGORY_ARCHIVED = "Esta categoria está arquivada. Escolha outra categoria ou desarquive esta."
CATEGORY_KIND_MISMATCH = {
    TransactionType.EXPENSE: (
        "Esta é uma categoria de receita. Para uma despesa, escolha uma categoria de despesa."
    ),
    TransactionType.INCOME: (
        "Esta é uma categoria de despesa. Para uma receita, escolha uma categoria de receita."
    ),
}
INVALID_CURSOR = "Não foi possível continuar a lista deste ponto. Recarregue a página."

_CURSOR_SEPARATOR = "|"


def _invalid(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(details={"fields": {field: message}})


def encode_cursor(transaction: Transaction) -> str:
    raw = _CURSOR_SEPARATOR.join(
        [transaction.date.isoformat(), transaction.created_at.isoformat(), str(transaction.id)]
    )
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> PageCursor:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        day, created_at, transaction_id = raw.split(_CURSOR_SEPARATOR)
        return PageCursor(
            date=dt.date.fromisoformat(day),
            created_at=dt.datetime.fromisoformat(created_at),
            id=uuid.UUID(transaction_id),
        )
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise _invalid("cursor", INVALID_CURSOR) from exc


class TransactionService:
    def __init__(self, session: AsyncSession) -> None:
        self._transactions = TransactionRepository(session)
        self._accounts = AccountRepository(session)
        self._categories = CategoryRepository(session)

    # ---------- consulta

    async def get(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> TransactionRead:
        return TransactionRead.from_transaction(await self._load(user_id, transaction_id))

    async def _load(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction:
        transaction = await self._transactions.get(user_id, transaction_id)
        if transaction is None:
            raise NotFound()
        return transaction

    async def search(
        self,
        user_id: uuid.UUID,
        *,
        date_from: dt.date | None = None,
        date_to: dt.date | None = None,
        account_id: uuid.UUID | None = None,
        category_id: uuid.UUID | None = None,
        transaction_type: TransactionType | None = None,
        text: str | None = None,
        installment_group_id: uuid.UUID | None = None,
        ids: list[uuid.UUID] | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> TransactionPage:
        filters = TransactionFilters(
            date_from=date_from,
            date_to=date_to,
            account_id=account_id,
            # O filtro por categoria inclui as subcategorias dela.
            category_ids=(
                await self._categories.family_ids(user_id, category_id)
                if category_id is not None
                else None
            ),
            transaction_type=transaction_type,
            text=text.strip() if text else None,
            installment_group_id=installment_group_id,
            ids=ids,
        )
        after = decode_cursor(cursor) if cursor else None
        # Uma linha a mais só para saber se existe próxima página.
        rows = await self._transactions.search(user_id, filters, limit=limit + 1, after=after)
        page, has_more = rows[:limit], len(rows) > limit
        return TransactionPage(
            items=[TransactionRead.from_transaction(row) for row in page],
            next_cursor=encode_cursor(page[-1]) if has_more else None,
            total_count=await self._transactions.count(user_id, filters),
        )

    # ---------- conferências

    async def _usable_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        """A conta de um lançamento novo é do usuário e está ativa."""
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise _invalid("account_id", ACCOUNT_NOT_FOUND)
        if account.archived_at is not None:
            raise _invalid("account_id", ACCOUNT_ARCHIVED)
        return account

    async def _category(self, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._categories.get(user_id, category_id)
        if category is None:
            raise _invalid("category_id", CATEGORY_NOT_FOUND)
        return category

    @staticmethod
    def _check_kind(category: Category, transaction_type: TransactionType) -> None:
        # Os dois enums têm os mesmos valores para despesa e receita.
        if str(category.kind) != str(transaction_type):
            raise _invalid("category_id", CATEGORY_KIND_MISMATCH[transaction_type])

    # ---------- criar, editar e excluir

    async def create(self, user_id: uuid.UUID, data: TransactionCreate) -> TransactionRead:
        account = await self._usable_account(user_id, data.account_id)
        category = await self._category(user_id, data.category_id)
        if category.archived_at is not None:
            raise _invalid("category_id", CATEGORY_ARCHIVED)
        self._check_kind(category, data.type)

        normalized = normalize_description(data.description)
        transaction = await self._transactions.create(
            user_id,
            account_id=account.id,
            transaction_type=data.type,
            amount_cents=data.amount_cents,
            date=data.date,
            description=data.description,
            description_normalized=normalized,
            fingerprint=fingerprint(
                account_id=account.id,
                date=data.date,
                transaction_type=data.type,
                amount_cents=data.amount_cents,
                description_normalized=normalized,
            ),
            created_at=clock.utcnow(),
            category_id=category.id,
            notes=data.notes or None,
        )
        return TransactionRead.from_transaction(transaction)

    async def update(
        self, user_id: uuid.UUID, transaction_id: uuid.UUID, data: TransactionUpdate
    ) -> TransactionRead:
        transaction = await self._load(user_id, transaction_id)
        sent = data.model_fields_set

        # Conta e categoria só são conferidas de novo se mudarem: um lançamento antigo continua
        # editável mesmo com a conta ou a categoria dele arquivada (FR-026).
        if data.account_id is not None and data.account_id != transaction.account_id:
            transaction.account_id = (await self._usable_account(user_id, data.account_id)).id

        new_type = data.type if data.type is not None else TransactionType(transaction.type)
        category_changed = (
            data.category_id is not None and data.category_id != transaction.category_id
        )
        if category_changed or new_type != transaction.type:
            category_id = data.category_id if category_changed else transaction.category_id
            if category_id is None:
                raise _invalid("category_id", CATEGORY_NOT_FOUND)
            category = await self._category(user_id, category_id)
            if category_changed and category.archived_at is not None:
                raise _invalid("category_id", CATEGORY_ARCHIVED)
            self._check_kind(category, new_type)
            transaction.category_id = category.id
        transaction.type = new_type

        if data.amount_cents is not None:
            transaction.amount_cents = data.amount_cents
        if data.date is not None:
            transaction.date = data.date
        if data.description is not None:
            transaction.description = data.description
        if "notes" in sent:
            transaction.notes = data.notes or None

        transaction.description_normalized = normalize_description(transaction.description)
        transaction.fingerprint = fingerprint(
            account_id=transaction.account_id,
            date=transaction.date,
            transaction_type=transaction.type,
            amount_cents=transaction.amount_cents,
            description_normalized=transaction.description_normalized,
        )
        return TransactionRead.from_transaction(await self._transactions.save(user_id, transaction))

    async def delete(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
        transaction = await self._load(user_id, transaction_id)
        await self._transactions.delete(user_id, transaction.id)

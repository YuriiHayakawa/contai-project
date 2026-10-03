"""Regras de transações: despesas, receitas, compras parceladas e transferências."""

import base64
import binascii
import datetime as dt
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import NotFound, ValidationFailed
from app.core.money import split_installments
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import Category
from app.modules.categories.repository import CategoryRepository
from app.modules.transactions.models import Transaction, TransactionType, TransferDirection
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import (
    PageCursor,
    TransactionFilters,
    TransactionRepository,
)
from app.modules.transactions.schemas import (
    EditScope,
    InstallmentPurchaseCreate,
    TransactionCreate,
    TransactionPage,
    TransactionRead,
    TransactionUpdate,
    TransferCreate,
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
INSTALLMENTS_ONLY_ON_CARDS = "Compra parcelada é só no cartão de crédito. Escolha um cartão."
INSTALLMENTS_STAY_ON_CARDS = "As parcelas ficam sempre em um cartão de crédito. Escolha um cartão."
INSTALLMENT_TOO_SMALL = "O valor total precisa dar pelo menos R$ 0,01 em cada parcela."
INSTALLMENT_IS_EXPENSE = "Uma parcela é sempre uma despesa no cartão."
TRANSFER_SAME_ACCOUNT = "Escolha duas contas diferentes: a de origem e a de destino."
TRANSFER_TYPE_FIXED = (
    "Uma transferência não vira despesa nem receita. Exclua-a e faça o lançamento de novo."
)
TRANSFER_WITHOUT_CATEGORY = "Transferência não tem categoria: ela não é despesa nem receita."

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
        transfer_group_id: uuid.UUID | None = None,
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
            transfer_group_id=transfer_group_id,
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

    async def _usable_account(
        self, user_id: uuid.UUID, account_id: uuid.UUID, field: str = "account_id"
    ) -> Account:
        """A conta de um lançamento novo é do usuário e está ativa."""
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise _invalid(field, ACCOUNT_NOT_FOUND)
        if account.archived_at is not None:
            raise _invalid(field, ACCOUNT_ARCHIVED)
        return account

    async def _category(self, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
        category = await self._categories.get(user_id, category_id)
        if category is None:
            raise _invalid("category_id", CATEGORY_NOT_FOUND)
        return category

    async def _usable_category(
        self, user_id: uuid.UUID, category_id: uuid.UUID, transaction_type: TransactionType
    ) -> Category:
        """A categoria de um lançamento novo é do usuário, está ativa e é do mesmo tipo."""
        category = await self._category(user_id, category_id)
        if category.archived_at is not None:
            raise _invalid("category_id", CATEGORY_ARCHIVED)
        self._check_kind(category, transaction_type)
        return category

    @staticmethod
    def _check_kind(category: Category, transaction_type: TransactionType) -> None:
        # Os dois enums têm os mesmos valores para despesa e receita.
        if str(category.kind) != str(transaction_type):
            raise _invalid("category_id", CATEGORY_KIND_MISMATCH[transaction_type])

    @staticmethod
    def _refresh_fingerprint(transaction: Transaction) -> None:
        transaction.description_normalized = normalize_description(transaction.description)
        transaction.fingerprint = fingerprint(
            account_id=transaction.account_id,
            date=transaction.date,
            transaction_type=TransactionType(transaction.type),
            amount_cents=transaction.amount_cents,
            description_normalized=transaction.description_normalized,
        )

    async def _create_line(
        self,
        user_id: uuid.UUID,
        *,
        account_id: uuid.UUID,
        transaction_type: TransactionType,
        amount_cents: int,
        date: dt.date,
        description: str,
        notes: str | None,
        category_id: uuid.UUID | None = None,
        transfer_direction: TransferDirection | None = None,
        transfer_group_id: uuid.UUID | None = None,
        installment_group_id: uuid.UUID | None = None,
        installment_number: int | None = None,
        installment_count: int | None = None,
    ) -> Transaction:
        normalized = normalize_description(description)
        return await self._transactions.create(
            user_id,
            account_id=account_id,
            transaction_type=transaction_type,
            amount_cents=amount_cents,
            date=date,
            description=description,
            description_normalized=normalized,
            fingerprint=fingerprint(
                account_id=account_id,
                date=date,
                transaction_type=transaction_type,
                amount_cents=amount_cents,
                description_normalized=normalized,
            ),
            created_at=clock.utcnow(),
            category_id=category_id,
            notes=notes or None,
            transfer_direction=transfer_direction,
            transfer_group_id=transfer_group_id,
            installment_group_id=installment_group_id,
            installment_number=installment_number,
            installment_count=installment_count,
        )

    # ---------- criar

    async def create(self, user_id: uuid.UUID, data: TransactionCreate) -> TransactionRead:
        account = await self._usable_account(user_id, data.account_id)
        category = await self._usable_category(user_id, data.category_id, data.type)
        transaction = await self._create_line(
            user_id,
            account_id=account.id,
            transaction_type=data.type,
            amount_cents=data.amount_cents,
            date=data.date,
            description=data.description,
            notes=data.notes,
            category_id=category.id,
        )
        return TransactionRead.from_transaction(transaction)

    async def create_installments(
        self, user_id: uuid.UUID, data: InstallmentPurchaseCreate
    ) -> list[TransactionRead]:
        """Compra parcelada no cartão (FR-030).

        O total é dividido com o resto de centavos na primeira parcela, e a soma é sempre o
        total. A parcela k tem a data da compra mais (k - 1) meses; em mês sem aquele dia, cai no
        último dia do mês.
        """
        account = await self._usable_account(user_id, data.account_id)
        if account.type != AccountType.CREDIT_CARD:
            raise _invalid("account_id", INSTALLMENTS_ONLY_ON_CARDS)
        category = await self._usable_category(user_id, data.category_id, TransactionType.EXPENSE)
        if data.total_cents < data.installments:
            raise _invalid("total_cents", INSTALLMENT_TOO_SMALL)

        group_id = uuid.uuid4()
        amounts = split_installments(data.total_cents, data.installments)
        parcels = [
            await self._create_line(
                user_id,
                account_id=account.id,
                transaction_type=TransactionType.EXPENSE,
                amount_cents=amount,
                # Sempre a partir da data da compra: depois de um mês curto, o dia volta.
                date=clock.add_months(data.date, index),
                description=data.description,
                notes=data.notes,
                category_id=category.id,
                installment_group_id=group_id,
                installment_number=index + 1,
                installment_count=data.installments,
            )
            for index, amount in enumerate(amounts)
        ]
        return [TransactionRead.from_transaction(parcel) for parcel in parcels]

    async def create_transfer(
        self, user_id: uuid.UUID, data: TransferCreate
    ) -> list[TransactionRead]:
        """Transferência entre contas próprias: duas linhas ligadas, uma de saída e uma de
        entrada (FR-033). O pagamento da fatura é uma transferência da conta para o cartão."""
        if data.from_account_id == data.to_account_id:
            raise _invalid("to_account_id", TRANSFER_SAME_ACCOUNT)
        source = await self._usable_account(user_id, data.from_account_id, "from_account_id")
        target = await self._usable_account(user_id, data.to_account_id, "to_account_id")

        group_id = uuid.uuid4()
        lines = [
            await self._create_line(
                user_id,
                account_id=account.id,
                transaction_type=TransactionType.TRANSFER,
                amount_cents=data.amount_cents,
                date=data.date,
                description=data.description,
                notes=data.notes,
                transfer_direction=direction,
                transfer_group_id=group_id,
            )
            for account, direction in (
                (source, TransferDirection.OUT),
                (target, TransferDirection.IN),
            )
        ]
        return [TransactionRead.from_transaction(line) for line in lines]

    # ---------- editar

    async def update(
        self,
        user_id: uuid.UUID,
        transaction_id: uuid.UUID,
        data: TransactionUpdate,
        scope: EditScope = EditScope.SINGLE,
    ) -> TransactionRead | list[TransactionRead]:
        """Edita um lançamento.

        Transferência muda nos dois lados (FR-034). Parcela muda sozinha ou junto com as
        seguintes, conforme o `scope` (FR-032); fora de uma compra parcelada, o `scope` não
        faz diferença.
        """
        transaction = await self._load(user_id, transaction_id)
        if transaction.type == TransactionType.TRANSFER:
            return await self._update_transfer(user_id, transaction, data)
        if transaction.installment_group_id is not None and scope == EditScope.FOLLOWING:
            return await self._update_following(user_id, transaction, data)
        await self._apply(user_id, transaction, data, date=data.date)
        return TransactionRead.from_transaction(await self._transactions.save(user_id, transaction))

    async def _apply(
        self,
        user_id: uuid.UUID,
        transaction: Transaction,
        data: TransactionUpdate,
        *,
        date: dt.date | None,
    ) -> None:
        """Aplica a edição a uma despesa ou receita, sem gravar."""
        sent = data.model_fields_set
        is_installment = transaction.installment_group_id is not None

        # Conta e categoria só são conferidas de novo se mudarem: um lançamento antigo continua
        # editável mesmo com a conta ou a categoria dele arquivada (FR-026).
        if data.account_id is not None and data.account_id != transaction.account_id:
            account = await self._usable_account(user_id, data.account_id)
            if is_installment and account.type != AccountType.CREDIT_CARD:
                raise _invalid("account_id", INSTALLMENTS_STAY_ON_CARDS)
            transaction.account_id = account.id

        new_type = data.type if data.type is not None else TransactionType(transaction.type)
        if is_installment and new_type != TransactionType.EXPENSE:
            raise _invalid("type", INSTALLMENT_IS_EXPENSE)
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
        if date is not None:
            transaction.date = date
        if data.description is not None:
            transaction.description = data.description
        if "notes" in sent:
            transaction.notes = data.notes or None
        self._refresh_fingerprint(transaction)

    async def _update_following(
        self, user_id: uuid.UUID, transaction: Transaction, data: TransactionUpdate
    ) -> list[TransactionRead]:
        """A parcela escolhida e as seguintes recebem a mesma mudança; as anteriores ficam.

        Uma data nova vale para a escolhida, e cada seguinte fica um mês depois da outra, a
        partir dela.
        """
        group_id = transaction.installment_group_id
        number = transaction.installment_number
        if group_id is None or number is None:  # pragma: no cover - garantido por `update`
            raise ValueError("a transação não é uma parcela")
        parcels = await self._transactions.installments_from(user_id, group_id, number)
        for offset, parcel in enumerate(parcels):
            new_date = clock.add_months(data.date, offset) if data.date is not None else None
            await self._apply(user_id, parcel, data, date=new_date)
        saved = [await self._transactions.save(user_id, parcel) for parcel in parcels]
        return [TransactionRead.from_transaction(parcel) for parcel in saved]

    async def _update_transfer(
        self, user_id: uuid.UUID, transaction: Transaction, data: TransactionUpdate
    ) -> TransactionRead:
        """Valor, data, descrição e observação mudam nos dois lados; a conta muda só no lado
        editado, e nunca para a conta do outro lado."""
        sent = data.model_fields_set
        if data.type is not None:
            raise _invalid("type", TRANSFER_TYPE_FIXED)
        if data.category_id is not None:
            raise _invalid("category_id", TRANSFER_WITHOUT_CATEGORY)
        group_id = transaction.transfer_group_id
        if group_id is None:  # pragma: no cover - toda transferência tem grupo (CHECK no banco)
            raise ValueError("transferência sem grupo")
        lines = await self._transactions.transfer_lines(user_id, group_id)

        if data.account_id is not None and data.account_id != transaction.account_id:
            if any(line.account_id == data.account_id for line in lines):
                raise _invalid("account_id", TRANSFER_SAME_ACCOUNT)
            transaction.account_id = (await self._usable_account(user_id, data.account_id)).id

        for line in lines:
            if data.amount_cents is not None:
                line.amount_cents = data.amount_cents
            if data.date is not None:
                line.date = data.date
            if data.description is not None:
                line.description = data.description
            if "notes" in sent:
                line.notes = data.notes or None
            self._refresh_fingerprint(line)
            await self._transactions.save(user_id, line)
        return TransactionRead.from_transaction(transaction)

    # ---------- excluir

    async def delete(
        self, user_id: uuid.UUID, transaction_id: uuid.UUID, scope: EditScope = EditScope.SINGLE
    ) -> None:
        """Exclui um lançamento. A transferência sai dos dois lados; a parcela sai sozinha ou
        com as seguintes, conforme o `scope`."""
        transaction = await self._load(user_id, transaction_id)
        if transaction.transfer_group_id is not None:
            lines = await self._transactions.transfer_lines(user_id, transaction.transfer_group_id)
            await self._transactions.delete_many(user_id, [line.id for line in lines])
            return
        group_id = transaction.installment_group_id
        number = transaction.installment_number
        if group_id is not None and number is not None and scope == EditScope.FOLLOWING:
            parcels = await self._transactions.installments_from(user_id, group_id, number)
            await self._transactions.delete_many(user_id, [parcel.id for parcel in parcels])
            return
        await self._transactions.delete(user_id, transaction.id)

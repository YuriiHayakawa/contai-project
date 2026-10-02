"""Regras de contas: cadastro, edição, arquivamento, exclusão e saldo."""

import builtins
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.accounts.schemas import AccountCreate, AccountRead, AccountUpdate

CARD_DAY_REQUIRED = "Informe este dia: ele é obrigatório para cartão de crédito."
CARD_DAY_NOT_ALLOWED = "Este dia só existe em cartão de crédito. Deixe em branco."
NAME_TAKEN = "Você já tem uma conta ativa com esse nome. Escolha outro nome."
TYPE_LOCKED = (
    "O tipo não pode mudar depois que a conta tem lançamentos. Crie outra conta com o tipo certo."
)
HAS_TRANSACTIONS = (
    "Esta conta tem lançamentos e não pode ser excluída. Você pode arquivá-la: ela some das "
    "opções e o histórico fica guardado."
)


def _check_card_days(
    account_type: AccountType, closing_day: int | None, due_day: int | None
) -> None:
    """Fechamento e vencimento: obrigatórios para cartão, inexistentes nos demais tipos."""
    days = {"closing_day": closing_day, "due_day": due_day}
    if account_type == AccountType.CREDIT_CARD:
        fields = {name: CARD_DAY_REQUIRED for name, day in days.items() if day is None}
    else:
        fields = {name: CARD_DAY_NOT_ALLOWED for name, day in days.items() if day is not None}
    if fields:
        raise ValidationFailed(details={"fields": fields})


class AccountService:
    def __init__(self, session: AsyncSession) -> None:
        self._accounts = AccountRepository(session)

    # ---------- consulta

    async def list(
        self, user_id: uuid.UUID, *, include_archived: bool = False
    ) -> builtins.list[AccountRead]:
        accounts = await self._accounts.list_all(user_id, include_archived=include_archived)
        movements = await self._accounts.movements(user_id, today=clock.today())
        return [
            AccountRead.from_account(account, movement_cents=movements.get(account.id, 0))
            for account in accounts
        ]

    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> AccountRead:
        return await self._read(await self._load(user_id, account_id))

    async def _load(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise NotFound()
        return account

    async def _read(self, account: Account) -> AccountRead:
        movements = await self._accounts.movements(account.user_id, today=clock.today())
        return AccountRead.from_account(account, movement_cents=movements.get(account.id, 0))

    async def _ensure_name_is_free(
        self, user_id: uuid.UUID, name: str, *, except_id: uuid.UUID | None = None
    ) -> None:
        existing = await self._accounts.find_active_by_name(user_id, name)
        if existing is not None and existing.id != except_id:
            raise Conflict(NAME_TAKEN, code="account_name_taken")

    # ---------- cadastro e edição

    async def create(self, user_id: uuid.UUID, data: AccountCreate) -> AccountRead:
        _check_card_days(data.type, data.closing_day, data.due_day)
        await self._ensure_name_is_free(user_id, data.name)
        account = await self._accounts.create(
            user_id,
            name=data.name,
            account_type=data.type,
            institution=data.institution or None,
            initial_balance_cents=data.initial_balance_cents,
            # Sem data informada, a referência do saldo inicial é o dia do cadastro (FR-019).
            initial_balance_date=data.initial_balance_date or clock.today(),
            closing_day=data.closing_day,
            due_day=data.due_day,
        )
        return await self._read(account)

    async def update(
        self, user_id: uuid.UUID, account_id: uuid.UUID, data: AccountUpdate
    ) -> AccountRead:
        account = await self._load(user_id, account_id)
        sent = data.model_fields_set

        new_type = data.type if data.type is not None else AccountType(account.type)
        if new_type != account.type and await self._accounts.has_transactions(user_id, account.id):
            raise Conflict(TYPE_LOCKED, code="account_type_locked")

        closing_day = data.closing_day if "closing_day" in sent else account.closing_day
        due_day = data.due_day if "due_day" in sent else account.due_day
        if new_type != AccountType.CREDIT_CARD and new_type != account.type:
            # Ao deixar de ser cartão, os dias de fechamento e vencimento saem junto.
            closing_day = data.closing_day if "closing_day" in sent else None
            due_day = data.due_day if "due_day" in sent else None
        _check_card_days(new_type, closing_day, due_day)

        if data.name is not None and data.name != account.name:
            # Uma conta arquivada pode ter o nome de uma ativa; a conferência vem ao desarquivar.
            if account.archived_at is None:
                await self._ensure_name_is_free(user_id, data.name, except_id=account.id)
            account.name = data.name
        account.type = new_type
        account.closing_day = closing_day
        account.due_day = due_day
        if "institution" in sent:
            account.institution = data.institution or None
        if data.initial_balance_cents is not None:
            account.initial_balance_cents = data.initial_balance_cents
        if data.initial_balance_date is not None:
            account.initial_balance_date = data.initial_balance_date

        return await self._read(await self._accounts.save(user_id, account))

    # ---------- arquivar e excluir

    async def archive(self, user_id: uuid.UUID, account_id: uuid.UUID) -> AccountRead:
        account = await self._load(user_id, account_id)
        if account.archived_at is None:
            account.archived_at = clock.utcnow()
            await self._accounts.save(user_id, account)
        return await self._read(account)

    async def unarchive(self, user_id: uuid.UUID, account_id: uuid.UUID) -> AccountRead:
        account = await self._load(user_id, account_id)
        if account.archived_at is not None:
            await self._ensure_name_is_free(user_id, account.name, except_id=account.id)
            account.archived_at = None
            await self._accounts.save(user_id, account)
        return await self._read(account)

    async def delete(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        """Só uma conta sem transações pode ser excluída; as demais são arquivadas (FR-022)."""
        account = await self._load(user_id, account_id)
        if await self._accounts.has_transactions(user_id, account.id):
            raise Conflict(HAS_TRANSACTIONS, code="account_has_transactions")
        await self._accounts.delete(user_id, account.id)

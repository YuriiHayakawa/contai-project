"""Regras da importação: envio, processamento em segundo plano, revisão e histórico.

O que é comum a todos os formatos fica aqui: escolher o importador, normalizar as descrições,
calcular a impressão digital, marcar as duplicatas, sugerir categorias, detectar pagamento de
fatura e gravar as transações propostas. Nada vira transação antes da confirmação do usuário
(FR-046), e a confirmação e o desfazer valem para tudo de uma vez, ou para nada.
"""

import base64
import binascii
import datetime as dt
import logging
import uuid
from pathlib import PurePath

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import usage as ai_usage
from app.ai.provider import LLMQuotaExhausted, LLMRateLimited, LLMUnavailable
from app.core import clock
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.service import CategorizationService, Line
from app.modules.dashboard.service import ReportingService
from app.modules.imports import storage
from app.modules.imports.detection import CardInvoice, is_invoice_payment, suggest_card
from app.modules.imports.duplicates import (
    PROBABLE_WINDOW,
    Candidate,
    ExistingTransaction,
    classify,
)
from app.modules.imports.importers import AI_FORMATS, find_importer, is_supported
from app.modules.imports.importers.base import (
    DOCUMENT_UNREADABLE,
    MAPPING_MISMATCH,
    MAX_DESCRIPTION_LENGTH,
    MULTIPLE_ACCOUNTS,
    NO_TRANSACTIONS,
    TOO_MANY_ROWS,
    UNREADABLE,
    AiCall,
    ImportContext,
    ImportFailed,
    MappingMismatch,
    MappingRequired,
    ProposedTransaction,
)
from app.modules.imports.mapping import ColumnMapping, MappingPreview
from app.modules.imports.models import (
    CategorySource,
    Import,
    ImportFormat,
    ImportItem,
    ImportKind,
    ImportStatus,
)
from app.modules.imports.repository import ImportRepository, NewItem
from app.modules.imports.schemas import (
    BalanceCheck,
    ConfirmItem,
    ImportConfirm,
    ImportItemRead,
    ImportItemUpdate,
    ImportPage,
    ImportRead,
    MappingPreviewRead,
    TotalCheck,
)
from app.modules.transactions.models import TransactionSource, TransactionType, TransferDirection
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import TransactionRepository
from app.modules.transactions.service import (
    ACCOUNT_ARCHIVED,
    ACCOUNT_NOT_FOUND,
    CATEGORY_ARCHIVED,
    CATEGORY_KIND_MISMATCH,
    CATEGORY_NOT_FOUND,
    INVALID_CURSOR,
    TRANSFER_SAME_ACCOUNT,
    category_fits,
)
from app.modules.users.repository import UserRepository
from app.worker import queue
from app.worker.models import JobType

logger = logging.getLogger("contai.imports")

FILE_MISSING = "file_missing"
PROCESSING_ERROR = "processing_error"
MAPPING_EXPIRED = "mapping_expired"
REVIEW_EXPIRED = "review_expired"
# O serviço de IA não respondeu agora: a importação volta para a fila e é tentada de novo, sem
# reenvio do arquivo (FR-072). Não é uma falha: o código só explica a espera a quem acompanha.
AI_BUSY = "ai_busy"
# As tentativas acabaram sem resposta do serviço de IA.
AI_UNAVAILABLE = "ai_unavailable"
# A cota do dia do serviço de IA acabou, no modelo principal e no reserva: só volta amanhã.
AI_QUOTA_EXHAUSTED = "ai_quota_exhausted"
AI_CONSENT_REQUIRED = "ai_consent_required"

MAX_TRANSACTIONS = 5_000
MAX_FILENAME_LENGTH = 255
MAX_EXTERNAL_ID_LENGTH = 255
MAX_AMOUNT_CENTS = 9_999_999_999_99
MAX_NOTES_LENGTH = 1_000
PROCESS_MAX_ATTEMPTS = 3
# Quanto tempo uma importação espera o usuário antes de expirar (FR-083).
WAIT_LIMITS = {
    ImportStatus.AWAITING_MAPPING: dt.timedelta(hours=24),
    ImportStatus.AWAITING_REVIEW: dt.timedelta(days=7),
}
EXPIRED_CODES = {
    ImportStatus.AWAITING_MAPPING: MAPPING_EXPIRED,
    ImportStatus.AWAITING_REVIEW: REVIEW_EXPIRED,
}
# Só nestes estados o arquivo ainda faz falta: na fila, sendo lido ou à espera das colunas.
_FILE_STILL_NEEDED = (
    ImportStatus.QUEUED,
    ImportStatus.PROCESSING,
    ImportStatus.AWAITING_MAPPING,
)
_CONFIRMED = (ImportStatus.COMPLETED, ImportStatus.UNDONE)
_CURSOR_SEPARATOR = "|"

RECEIPT_NEEDS_PICTURE = (
    "Comprovante é uma foto ou um PDF. Para enviar um extrato em OFX, CSV ou planilha, "
    'escolha "Extrato ou fatura".'
)
STATEMENT_NEEDS_DOCUMENT = (
    "Uma foto é lida como comprovante, com um lançamento só. Para enviar um extrato ou uma "
    'fatura, use o PDF, o OFX, o CSV ou a planilha do banco; para um recibo, escolha "Comprovante".'
)
AI_CONSENT_MESSAGE = (
    "PDFs e imagens são lidos por um serviço de IA externo, que pode usar os dados para "
    "melhorar seus modelos. Aceite o aviso para enviar este arquivo; OFX, CSV e planilhas são "
    "lidos sem IA."
)
NOT_AWAITING_MAPPING = (
    "Esta importação não está esperando o mapeamento de colunas. Atualize a página para ver "
    "como ela está."
)
NOT_AWAITING_REVIEW = (
    "Esta importação não está esperando a revisão. Atualize a página para ver como ela está."
)
NOT_COMPLETED = (
    "Só dá para desfazer uma importação confirmada. Atualize a página para ver como ela está."
)
ALREADY_CONFIRMED = (
    "Esta importação já foi confirmada e fica no histórico. Para tirar os lançamentos que ela "
    "criou, use desfazer."
)
REVIEW_OUT_OF_DATE = (
    "A revisão não corresponde às linhas desta importação. Atualize a página e confira de novo."
)
DESTINATION_ARCHIVED = (
    "A conta desta importação foi arquivada. Desarquive a conta para confirmar a importação."
)
COLUMN_OUT_OF_RANGE = "Escolha uma das colunas do arquivo."
COLUMN_USED_TWICE = "Cada coluna só pode ser usada uma vez. Escolha outra coluna."
AMOUNT_REQUIRED = "Escolha a coluna do valor, ou as duas colunas: a de entrada e a de saída."
AMOUNT_BOTH_WAYS = (
    "Escolha a coluna do valor ou as colunas de entrada e de saída, e não as duas formas."
)
TYPE_REQUIRED = "Escolha se a linha é despesa, receita ou transferência."
TYPE_AGAINST_STATEMENT = (
    "Uma saída do extrato pode ser despesa ou transferência, e uma entrada, receita ou "
    "transferência. Escolha um desses tipos."
)
AMOUNT_INVALID = "Informe um valor maior que zero."
DATE_REQUIRED = "Informe a data."
DESCRIPTION_INVALID = "Informe uma descrição de até 200 caracteres."
NOTES_INVALID = "Use uma observação com até 1.000 caracteres."
CATEGORY_REQUIRED = "Escolha uma categoria."
COUNTER_ACCOUNT_REQUIRED = "Escolha a outra conta da transferência."

ERROR_MESSAGES = {
    UNREADABLE: (
        "Não conseguimos ler este arquivo. Exporte o extrato de novo no site ou no aplicativo "
        "do banco e envie outra vez."
    ),
    NO_TRANSACTIONS: (
        "Não encontramos lançamentos neste arquivo. Confira se é o extrato do período certo e "
        "envie de novo."
    ),
    MULTIPLE_ACCOUNTS: (
        "Este arquivo traz o extrato de mais de uma conta. Exporte uma conta por vez e envie "
        "cada arquivo na conta dele."
    ),
    TOO_MANY_ROWS: (
        "Este arquivo tem lançamentos demais para uma importação só. Exporte um período menor, "
        "de até um ano, e envie por partes."
    ),
    MAPPING_MISMATCH: (
        "Não conseguimos ler as datas ou os valores com as colunas escolhidas. Confira a "
        "coluna de cada um, o formato da data e o separador decimal."
    ),
    FILE_MISSING: "O arquivo enviado não está mais disponível. Envie o arquivo de novo.",
    PROCESSING_ERROR: (
        "Algo deu errado do nosso lado ao ler o arquivo. Nada foi salvo. Envie o arquivo de novo."
    ),
    MAPPING_EXPIRED: (
        "O prazo de 24 horas para indicar as colunas terminou, e o arquivo foi apagado. Nada "
        "foi salvo. Envie o arquivo de novo."
    ),
    REVIEW_EXPIRED: (
        "O prazo de 7 dias para revisar esta importação terminou. Nada foi salvo. Envie o "
        "arquivo de novo."
    ),
    DOCUMENT_UNREADABLE: (
        "Não conseguimos reconhecer lançamentos neste documento. Nada foi salvo. Confira se é "
        "o extrato, a fatura ou o comprovante certo; em uma foto, o documento precisa aparecer "
        "inteiro e nítido. Se o banco oferecer, o extrato em OFX ou CSV é lido sem IA."
    ),
    AI_BUSY: (
        "O serviço de IA está ocupado agora. Vamos tentar de novo em instantes, sem você "
        "precisar reenviar o arquivo."
    ),
    AI_UNAVAILABLE: (
        "O serviço de IA não respondeu depois de algumas tentativas. Nada foi salvo. Envie o "
        "arquivo de novo daqui a alguns minutos."
    ),
    AI_QUOTA_EXHAUSTED: (
        "O limite de hoje do serviço de IA foi atingido, e ele volta a funcionar amanhã. Nada "
        "foi salvo. Envie o arquivo de novo amanhã; OFX, CSV e planilhas continuam funcionando."
    ),
}


def _invalid(fields: dict[str, str]) -> ValidationFailed:
    return ValidationFailed(details={"fields": fields})


def _safe_filename(filename: str | None) -> str:
    """Só o nome, sem pasta e sem caracteres de controle: ele aparece no histórico."""
    name = PurePath((filename or "").replace("\\", "/")).name
    printable = "".join(char for char in name if char.isprintable()).strip()
    return printable[:MAX_FILENAME_LENGTH] or "arquivo"


def _leaves_account(transaction_type: str, transfer_direction: str | None) -> bool:
    """Despesa e transferência enviada tiram dinheiro da conta; o resto põe."""
    if transaction_type == TransactionType.TRANSFER:
        return transfer_direction == TransferDirection.OUT
    return transaction_type == TransactionType.EXPENSE


def _keeps_direction(item: ImportItem, line_type: TransactionType) -> bool:
    """O sentido do dinheiro é o do extrato: uma saída é despesa ou transferência, e uma
    entrada, receita ou transferência. Uma saída não vira receita, nem uma entrada, despesa.

    Vale para a correção de uma linha e para a confirmação.
    """
    leaves = _leaves_account(item.type, item.transfer_direction)
    plain = TransactionType.EXPENSE if leaves else TransactionType.INCOME
    return line_type in (plain, TransactionType.TRANSFER)


def extracted_total_cents(proposed: list[ProposedTransaction]) -> int:
    """A soma das linhas lidas, para comparar com o total impresso no documento (FR-043).

    As saídas somam e as entradas abatem, como no total de uma fatura, em que o estorno
    diminui o que se deve. O total impresso vem sem sinal, e a soma também.
    """
    return abs(
        sum(
            line.amount_cents if line.type == TransactionType.EXPENSE else -line.amount_cents
            for line in proposed
        )
    )


def encode_cursor(record: Import) -> str:
    raw = _CURSOR_SEPARATOR.join([record.created_at.isoformat(), str(record.id)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[dt.datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_at, import_id = raw.split(_CURSOR_SEPARATOR)
        return dt.datetime.fromisoformat(created_at), uuid.UUID(import_id)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise _invalid({"cursor": INVALID_CURSOR}) from exc


def check_mapping(mapping: ColumnMapping, column_count: int) -> None:
    """Confere um modelo de colunas contra o arquivo; a recusa diz qual campo corrigir."""
    chosen = {
        "date_column": mapping.date_column,
        "description_column": mapping.description_column,
        "amount_column": mapping.amount_column,
        "income_column": mapping.income_column,
        "expense_column": mapping.expense_column,
    }
    fields: dict[str, str] = {}
    seen: set[int] = set()
    for name, column in chosen.items():
        if column is None:
            continue
        if column >= column_count:
            fields[name] = COLUMN_OUT_OF_RANGE
        elif column in seen:
            fields[name] = COLUMN_USED_TWICE
        seen.add(column)

    split = (mapping.income_column, mapping.expense_column)
    if mapping.amount_column is None and None in split:
        fields.setdefault("amount_column", AMOUNT_REQUIRED)
    if mapping.amount_column is not None and split != (None, None):
        fields.setdefault("amount_column", AMOUNT_BOTH_WAYS)
    if fields:
        raise _invalid(fields)


class ImportService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._imports = ImportRepository(session)
        self._accounts = AccountRepository(session)
        self._categories = CategoryRepository(session)
        self._transactions = TransactionRepository(session)
        self._categorization = CategorizationService(session)
        self._reports = ReportingService(session)
        self._users = UserRepository(session)

    # ---------- consulta

    async def get(self, user_id: uuid.UUID, import_id: uuid.UUID) -> ImportRead:
        return await self._read(await self._load(user_id, import_id))

    async def history(
        self, user_id: uuid.UUID, *, limit: int = 50, cursor: str | None = None
    ) -> ImportPage:
        """As importações do usuário, da mais nova para a mais antiga (FR-051)."""
        after = decode_cursor(cursor) if cursor else None
        # Uma linha a mais só para saber se existe próxima página.
        rows = await self._imports.list_page(user_id, limit=limit + 1, after=after)
        page, has_more = rows[:limit], len(rows) > limit
        return ImportPage(
            items=[self._summary(record) for record in page],
            next_cursor=encode_cursor(page[-1]) if has_more else None,
        )

    async def _load(
        self, user_id: uuid.UUID, import_id: uuid.UUID, *, for_update: bool = False
    ) -> Import:
        record = await self._imports.get(user_id, import_id, for_update=for_update)
        if record is None:
            raise NotFound()
        return record

    @staticmethod
    def _summary(record: Import) -> ImportRead:
        """A importação como aparece no histórico: sem as linhas e sem as conferências."""
        status = ImportStatus(record.status)
        wait_limit = WAIT_LIMITS.get(status)
        return ImportRead(
            id=record.id,
            account_id=record.account_id,
            kind=ImportKind(record.kind),
            format=ImportFormat(record.format),
            original_filename=record.original_filename,
            status=status,
            error_code=record.error_code,
            error_message=ERROR_MESSAGES.get(record.error_code) if record.error_code else None,
            item_count=record.item_count,
            imported_count=record.imported_count,
            created_at=record.created_at,
            completed_at=record.completed_at,
            undone_at=record.undone_at,
            expires_at=(
                record.waiting_since + wait_limit
                if wait_limit is not None and record.waiting_since is not None
                else None
            ),
            already_imported_at=None,
        )

    async def _read(self, record: Import) -> ImportRead:
        status = ImportStatus(record.status)
        items: list[ImportItem] = []
        if status == ImportStatus.AWAITING_REVIEW:
            items = await self._imports.list_items(record.user_id, record.id)
        preview: MappingPreviewRead | None = None
        if status == ImportStatus.AWAITING_MAPPING and record.mapping_preview is not None:
            preview = MappingPreviewRead.model_validate(record.mapping_preview)
        return self._summary(record).model_copy(
            update={
                "already_imported_at": await self._imports.completed_at_with_hash(
                    record.user_id,
                    account_id=record.account_id,
                    file_hash=record.file_hash,
                    except_id=record.id,
                ),
                "mapping_preview": preview,
                "items": (
                    [ImportItemRead.from_item(item) for item in items]
                    if status == ImportStatus.AWAITING_REVIEW
                    else None
                ),
                "total_check": self._total_check(record),
                "balance_check": await self._balance_check(record, items),
            }
        )

    @staticmethod
    def _total_check(record: Import) -> TotalCheck | None:
        """Só há o que comparar quando o documento traz um total (FR-043)."""
        document, extracted = record.document_total_cents, record.extracted_total_cents
        if document is None or extracted is None:
            return None
        return TotalCheck(
            document_total_cents=document,
            extracted_total_cents=extracted,
            matches=document == extracted,
        )

    async def _balance_check(self, record: Import, items: list[ImportItem]) -> BalanceCheck | None:
        """O saldo do banco contra o saldo da conta na data dele (FR-082).

        Na revisão entram as linhas marcadas, como o usuário as deixou. Só contam as linhas com
        data entre a data de referência do saldo inicial e a data do saldo do banco, como no
        saldo da conta (FR-023). Depois da confirmação, vale o saldo da conta nessa data.
        """
        status = ImportStatus(record.status)
        bank_balance, balance_date = record.bank_balance_cents, record.bank_balance_date
        if status not in (ImportStatus.AWAITING_REVIEW, ImportStatus.COMPLETED):
            return None
        if bank_balance is None or balance_date is None:
            return None
        account = await self._accounts.get(record.user_id, record.account_id)
        # O saldo de antes da data de referência não é calculado: não há com o que comparar.
        if account is None or balance_date < account.initial_balance_date:
            return None

        movements = await self._accounts.movements(record.user_id, today=balance_date)
        account_balance = account.initial_balance_cents + movements.get(account.id, 0)
        selected = sum(
            -item.amount_cents
            if _leaves_account(item.type, item.transfer_direction)
            else item.amount_cents
            for item in items
            if item.selected and account.initial_balance_date <= item.date <= balance_date
        )
        computed = account_balance + selected
        return BalanceCheck(
            bank_balance_cents=bank_balance,
            bank_balance_date=balance_date,
            account_balance_cents=account_balance,
            counted_from=account.initial_balance_date,
            computed_balance_cents=computed,
            matches=computed == bank_balance,
        )

    # ---------- envio

    async def _usable_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        """A conta de destino é do usuário e está ativa (FR-036)."""
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise _invalid({"account_id": ACCOUNT_NOT_FOUND})
        if account.archived_at is not None:
            raise _invalid({"account_id": ACCOUNT_ARCHIVED})
        return account

    async def upload(
        self,
        user_id: uuid.UUID,
        *,
        file: storage.Readable,
        filename: str | None,
        account_id: uuid.UUID,
        kind: ImportKind,
    ) -> ImportRead:
        """Confere e guarda o arquivo, e põe o processamento na fila (FR-045)."""
        account = await self._usable_account(user_id, account_id)
        received = await storage.receive(file)
        if not is_supported(received.format, kind):
            raise _invalid(
                {
                    "kind": RECEIPT_NEEDS_PICTURE
                    if kind == ImportKind.RECEIPT
                    else STATEMENT_NEEDS_DOCUMENT
                }
            )
        if received.format in AI_FORMATS:
            await self._check_ai_allowed(user_id)

        now = clock.utcnow()
        record = await self._imports.create(
            user_id,
            account_id=account.id,
            kind=kind,
            file_format=received.format,
            original_filename=_safe_filename(filename),
            file_hash=received.file_hash,
            created_at=now,
        )
        await self._imports.save_file(user_id, record.id, received.content, created_at=now)
        await self._enqueue(record)
        return await self._read(record)

    async def _check_ai_allowed(self, user_id: uuid.UUID) -> None:
        """PDF e imagem vão a um serviço de IA externo: só com o aceite do aviso (FR-044) e
        dentro do limite diário de extrações (FR-071). Nada é guardado antes disso."""
        user = await self._users.get_by_id(user_id)
        if user is None or user.ai_documents_consent_at is None:
            raise Forbidden(AI_CONSENT_MESSAGE, code=AI_CONSENT_REQUIRED)
        # O uso só é gravado quando o documento é lido: os que estão na fila já contam aqui.
        await ai_usage.check_limit(
            self._session,
            user_id,
            ai_usage.LimitKind.EXTRACTION,
            pending=await self._imports.count_unread(user_id, sorted(AI_FORMATS)),
        )

    async def _enqueue(self, record: Import) -> None:
        # O payload leva só o identificador: nada do arquivo vai para a fila.
        await queue.enqueue(
            self._session,
            JobType.PROCESS_IMPORT,
            {"import_id": str(record.id)},
            user_id=record.user_id,
            max_attempts=PROCESS_MAX_ATTEMPTS,
        )

    # ---------- mapeamento de colunas

    async def submit_mapping(
        self, user_id: uuid.UUID, import_id: uuid.UUID, mapping: ColumnMapping
    ) -> ImportRead:
        """Guarda o modelo de colunas e devolve a importação à fila (FR-039)."""
        record = await self._load(user_id, import_id, for_update=True)
        if record.status != ImportStatus.AWAITING_MAPPING or record.mapping_preview is None:
            raise Conflict(NOT_AWAITING_MAPPING, code="import_not_awaiting_mapping")
        preview = MappingPreview.model_validate(record.mapping_preview)
        check_mapping(mapping, len(preview.columns))

        await self._imports.save_template(
            user_id,
            header_signature=preview.header_signature,
            mapping=mapping.model_dump(mode="json"),
        )
        record.status = ImportStatus.QUEUED
        record.error_code = None
        record.waiting_since = None
        await self._imports.save(user_id, record)
        await self._enqueue(record)
        return await self._read(record)

    # ---------- correções da revisão

    async def _load_in_review(self, user_id: uuid.UUID, import_id: uuid.UUID) -> Import:
        """A importação, travada, à espera da revisão: só nesse estado as linhas mudam."""
        record = await self._load(user_id, import_id, for_update=True)
        if record.status != ImportStatus.AWAITING_REVIEW:
            raise Conflict(NOT_AWAITING_REVIEW, code="import_not_awaiting_review")
        return record

    async def update_item(
        self,
        user_id: uuid.UUID,
        import_id: uuid.UUID,
        item_id: uuid.UUID,
        changes: ImportItemUpdate,
    ) -> ImportItemRead:
        """Guarda a correção de uma linha da revisão, para ela poder ser retomada depois.

        Só os campos enviados mudam, e nada vira transação antes da confirmação (FR-046). Se
        um campo for recusado, nenhum é gravado.
        """
        record = await self._load_in_review(user_id, import_id)
        item = await self._imports.get_item(user_id, record.id, item_id)
        if item is None:
            raise NotFound()

        sent = changes.model_fields_set
        fields: dict[str, str] = {}
        leaves = _leaves_account(item.type, item.transfer_direction)
        line_type = TransactionType(item.type)
        if changes.type is not None:
            if not _keeps_direction(item, changes.type):
                fields["type"] = TYPE_AGAINST_STATEMENT
            line_type = changes.type
        if changes.amount_cents is not None and not 0 < changes.amount_cents <= MAX_AMOUNT_CENTS:
            fields["amount_cents"] = AMOUNT_INVALID
        description = None if changes.description is None else changes.description.strip()
        if description is not None and not 1 <= len(description) <= MAX_DESCRIPTION_LENGTH:
            fields["description"] = DESCRIPTION_INVALID
        notes = (changes.notes or "").strip()
        if len(notes) > MAX_NOTES_LENGTH:
            fields["notes"] = NOTES_INVALID

        if "category_id" in sent and changes.category_id is not None:
            category = await self._categories.get(user_id, changes.category_id)
            if category is None:
                fields["category_id"] = CATEGORY_NOT_FOUND
            elif category.archived_at is not None:
                fields["category_id"] = CATEGORY_ARCHIVED
            elif line_type != TransactionType.TRANSFER and not category_fits(
                str(category.kind), line_type
            ):
                fields["category_id"] = CATEGORY_KIND_MISMATCH
        if "counter_account_id" in sent and changes.counter_account_id is not None:
            counter = await self._accounts.get(user_id, changes.counter_account_id)
            if counter is None:
                fields["counter_account_id"] = ACCOUNT_NOT_FOUND
            elif counter.archived_at is not None:
                fields["counter_account_id"] = ACCOUNT_ARCHIVED
            elif counter.id == record.account_id:
                fields["counter_account_id"] = TRANSFER_SAME_ACCOUNT
        if fields:
            raise _invalid(fields)

        if changes.selected is not None:
            item.selected = changes.selected
        if changes.type is not None:
            item.type = changes.type
            item.transfer_direction = None
            if changes.type == TransactionType.TRANSFER:
                item.transfer_direction = TransferDirection.OUT if leaves else TransferDirection.IN
        if changes.amount_cents is not None:
            item.amount_cents = changes.amount_cents
        if changes.date is not None:
            item.date = changes.date
        if description is not None:
            # A descrição normalizada continua a do banco: é ela que volta no próximo extrato,
            # e é para ela que a correção de categoria vira regra (FR-048).
            item.description = description
        if "notes" in sent:
            item.notes = notes or None
        if "category_id" in sent:
            item.category_id = changes.category_id
        if "counter_account_id" in sent:
            item.counter_account_id = changes.counter_account_id
        return ImportItemRead.from_item(await self._imports.save_item(user_id, item))

    async def select_all_items(
        self, user_id: uuid.UUID, import_id: uuid.UUID, *, selected: bool
    ) -> None:
        """Marca ou desmarca todas as linhas da revisão de uma vez, inclusive as duplicatas."""
        record = await self._load_in_review(user_id, import_id)
        await self._imports.select_all_items(user_id, record.id, selected=selected)

    # ---------- confirmação, desfazer e descarte

    async def confirm(
        self, user_id: uuid.UUID, import_id: uuid.UUID, data: ImportConfirm
    ) -> ImportRead:
        """Grava as linhas marcadas, com as correções da revisão, tudo de uma vez (FR-046).

        A requisição inteira é uma transação de banco: se uma linha for recusada, nenhuma é
        salva. As linhas propostas são apagadas ao fim.
        """
        record = await self._load(user_id, import_id, for_update=True)
        if record.status != ImportStatus.AWAITING_REVIEW:
            raise Conflict(NOT_AWAITING_REVIEW, code="import_not_awaiting_review")
        items = {item.id: item for item in await self._imports.list_items(user_id, record.id)}
        sent = [decision.id for decision in data.items]
        if len(sent) != len(set(sent)) or set(sent) != set(items):
            raise _invalid({"items": REVIEW_OUT_OF_DATE})

        accounts = {
            account.id: account
            for account in await self._accounts.list_all(user_id, include_archived=True)
        }
        account = accounts[record.account_id]
        if account.archived_at is not None:
            raise Conflict(DESTINATION_ARCHIVED, code="account_archived")
        categories = {
            category.id: category
            for category in await self._categories.list_all(user_id, include_archived=True)
        }

        selected = [
            (position, decision, items[decision.id])
            for position, decision in enumerate(data.items)
            if decision.selected
        ]
        fields: dict[str, str] = {}
        # O sentido do dinheiro é conferido em toda linha que traz o tipo, marcada ou não, como
        # na correção de uma linha: nenhuma inverte o que o extrato diz.
        for position, decision in enumerate(data.items):
            if decision.type is not None and not _keeps_direction(
                items[decision.id], decision.type
            ):
                fields[f"items.{position}.type"] = TYPE_AGAINST_STATEMENT
        for position, decision, _ in selected:
            for field, message in self._check_decision(decision, account, accounts, categories):
                fields.setdefault(f"items.{position}.{field}", message)
        if fields:
            raise _invalid(fields)

        taken = await self._transactions.taken_external_ids(
            user_id,
            account.id,
            [item.external_id for _, _, item in selected if item.external_id is not None],
        )
        now = clock.utcnow()
        for _, decision, item in selected:
            await self._save_line(record, decision, item, taken=taken, now=now)

        await self._imports.delete_items(user_id, record.id)
        record.status = ImportStatus.COMPLETED
        record.imported_count = len(selected)
        record.completed_at = now
        record.waiting_since = None
        return await self._read(await self._imports.save(user_id, record))

    @staticmethod
    def _check_decision(
        decision: ConfirmItem,
        account: Account,
        accounts: dict[uuid.UUID, Account],
        categories: dict[uuid.UUID, Category],
    ) -> list[tuple[str, str]]:
        """Os campos de uma linha marcada que precisam ser corrigidos, com o que fazer."""
        errors: list[tuple[str, str]] = []
        if decision.amount_cents is None or not 0 < decision.amount_cents <= MAX_AMOUNT_CENTS:
            errors.append(("amount_cents", AMOUNT_INVALID))
        if decision.date is None:
            errors.append(("date", DATE_REQUIRED))
        description = (decision.description or "").strip()
        if not 1 <= len(description) <= MAX_DESCRIPTION_LENGTH:
            errors.append(("description", DESCRIPTION_INVALID))
        if len((decision.notes or "").strip()) > MAX_NOTES_LENGTH:
            errors.append(("notes", NOTES_INVALID))

        if decision.type is None:
            errors.append(("type", TYPE_REQUIRED))
        elif decision.type == TransactionType.TRANSFER:
            counter = (
                accounts.get(decision.counter_account_id) if decision.counter_account_id else None
            )
            if decision.counter_account_id is None:
                errors.append(("counter_account_id", COUNTER_ACCOUNT_REQUIRED))
            elif counter is None:
                errors.append(("counter_account_id", ACCOUNT_NOT_FOUND))
            elif counter.archived_at is not None:
                errors.append(("counter_account_id", ACCOUNT_ARCHIVED))
            elif counter.id == account.id:
                errors.append(("counter_account_id", TRANSFER_SAME_ACCOUNT))
        else:
            category = categories.get(decision.category_id) if decision.category_id else None
            if decision.category_id is None:
                errors.append(("category_id", CATEGORY_REQUIRED))
            elif category is None:
                errors.append(("category_id", CATEGORY_NOT_FOUND))
            elif category.archived_at is not None:
                errors.append(("category_id", CATEGORY_ARCHIVED))
            elif not category_fits(str(category.kind), decision.type):
                errors.append(("category_id", CATEGORY_KIND_MISMATCH))
        return errors

    async def _save_line(
        self,
        record: Import,
        decision: ConfirmItem,
        item: ImportItem,
        *,
        taken: set[str],
        now: dt.datetime,
    ) -> None:
        """Grava uma linha já conferida: uma despesa, uma receita ou os dois lados de uma
        transferência."""
        if (  # pragma: no cover - conferido por `_check_decision`
            decision.type is None
            or decision.amount_cents is None
            or decision.date is None
            or decision.description is None
        ):
            raise ValueError("linha confirmada sem os campos obrigatórios")
        line_type, amount_cents, date = decision.type, decision.amount_cents, decision.date
        description = decision.description.strip()
        normalized = normalize_description(description)
        notes = (decision.notes or "").strip() or None
        # O identificador do banco fica com uma transação só por conta. Uma linha que o usuário
        # quis importar mesmo com o aviso de "já importada" entra sem ele.
        external_id = item.external_id if item.external_id not in taken else None
        if external_id is not None:
            taken.add(external_id)

        async def create(
            account_id: uuid.UUID,
            *,
            category_id: uuid.UUID | None = None,
            direction: TransferDirection | None = None,
            group_id: uuid.UUID | None = None,
            line_external_id: str | None = None,
        ) -> None:
            await self._transactions.create(
                record.user_id,
                account_id=account_id,
                transaction_type=line_type,
                amount_cents=amount_cents,
                date=date,
                description=description,
                description_normalized=normalized,
                fingerprint=fingerprint(
                    account_id=account_id,
                    date=date,
                    transaction_type=line_type,
                    amount_cents=amount_cents,
                    description_normalized=normalized,
                ),
                # As linhas do mesmo dia ficam na ordem em que vieram no arquivo.
                created_at=now + dt.timedelta(microseconds=item.row_index),
                category_id=category_id,
                notes=notes,
                transfer_direction=direction,
                transfer_group_id=group_id,
                source=TransactionSource.IMPORT,
                import_id=record.id,
                external_id=line_external_id,
            )

        if line_type == TransactionType.TRANSFER:
            if decision.counter_account_id is None:  # pragma: no cover - já conferido
                raise ValueError("transferência sem a outra conta")
            # O sentido é o da linha no extrato: o que saiu da conta entra na outra.
            leaves = _leaves_account(item.type, item.transfer_direction)
            here, there = (
                (TransferDirection.OUT, TransferDirection.IN)
                if leaves
                else (TransferDirection.IN, TransferDirection.OUT)
            )
            group_id = uuid.uuid4()
            await create(
                record.account_id, direction=here, group_id=group_id, line_external_id=external_id
            )
            await create(decision.counter_account_id, direction=there, group_id=group_id)
            return

        await create(
            record.account_id, category_id=decision.category_id, line_external_id=external_id
        )
        # Só uma correção ensina: aceitar o palpite da IA ou o "Outros" não vira regra do
        # usuário. A regra vale para a descrição como veio do banco, que é a que volta no
        # próximo extrato (FR-048).
        if decision.category_id is not None and decision.category_id != item.suggested_category_id:
            await self._categorization.learn(
                record.user_id,
                description_normalized=item.description_normalized,
                category_id=decision.category_id,
            )

    async def undo(self, user_id: uuid.UUID, import_id: uuid.UUID) -> ImportRead:
        """Remove, de uma vez, todas as transações que a importação criou (FR-052)."""
        record = await self._load(user_id, import_id, for_update=True)
        if record.status != ImportStatus.COMPLETED:
            raise Conflict(NOT_COMPLETED, code="import_not_completed")
        await self._transactions.delete_by_import(user_id, record.id)
        record.status = ImportStatus.UNDONE
        record.undone_at = clock.utcnow()
        return await self._read(await self._imports.save(user_id, record))

    async def discard(self, user_id: uuid.UUID, import_id: uuid.UUID) -> None:
        """Descarta uma importação que ainda não foi confirmada; nada dela fica guardado."""
        record = await self._load(user_id, import_id, for_update=True)
        if record.status in _CONFIRMED:
            raise Conflict(ALREADY_CONFIRMED, code="import_already_confirmed")
        await self._discard_file(record)
        await self._imports.delete(user_id, record.id)

    # ---------- processamento, no worker

    async def process(self, user_id: uuid.UUID, import_id: uuid.UUID) -> None:
        """Lê o arquivo e prepara a revisão. Se falhar, nada fica salvo pela metade (FR-054)."""
        record = await self._imports.get(user_id, import_id, for_update=True)
        # Uma importação em `processing` aqui é a de um worker que caiu no meio: recomeça.
        if record is None or record.status not in (ImportStatus.QUEUED, ImportStatus.PROCESSING):
            return
        record.status = ImportStatus.PROCESSING
        # Grava já, para o andamento aparecer a quem está esperando (FR-045).
        await self._session.commit()

        # As chamadas à IA que leram o documento: ficam gravadas mesmo se a importação falhar
        # depois, porque a extração foi feita e conta no limite do dia.
        ai_calls: list[AiCall] = []
        try:
            # O ponto de retorno desfaz as linhas propostas se algo falhar depois de gravá-las.
            async with self._session.begin_nested():
                await self._prepare_review(record, ai_calls)
        except ImportFailed as failure:
            await self._fail(record, failure.code)
        except LLMQuotaExhausted:
            # A cota do dia acabou em todos os modelos: repetir hoje não adianta (FR-072).
            await self._fail(record, AI_QUOTA_EXHAUSTED)
        except (LLMRateLimited, LLMUnavailable):
            # Passageiro: o arquivo fica guardado e o job tenta de novo, com espera.
            await self._wait_for_ai(record)
            raise
        except SQLAlchemyError:
            # Falha do banco é passageira: o job volta para a fila.
            raise
        except Exception:
            logger.exception("import processing crashed", extra={"import_id": str(import_id)})
            await self._fail(record, PROCESSING_ERROR)
        for call in ai_calls:
            await ai_usage.record_usage(
                self._session,
                user_id,
                task=call.task,
                model=call.model,
                usage=call.usage,
                counts_toward_limit=True,
            )

    async def fail_abandoned(self, user_id: uuid.UUID, import_id: uuid.UUID) -> None:
        """A fila desistiu do processamento: a importação não fica presa "na fila" para sempre.

        Ela vai para erro, com a orientação de enviar o arquivo de novo.
        """
        record = await self._imports.get(user_id, import_id, for_update=True)
        if record is None or record.status not in (ImportStatus.QUEUED, ImportStatus.PROCESSING):
            return
        await self._imports.delete_items(user_id, record.id)
        waited_for_ai = record.error_code == AI_BUSY
        await self._fail(record, AI_UNAVAILABLE if waited_for_ai else PROCESSING_ERROR)

    async def _wait_for_ai(self, record: Import) -> None:
        """Devolve a importação à fila, dizendo a quem acompanha que a IA está ocupada."""
        # O ponto de retorno desfeito deixa o registro desatualizado na memória.
        await self._session.refresh(record)
        record.status = ImportStatus.QUEUED
        record.error_code = AI_BUSY
        await self._imports.save(record.user_id, record)
        # Grava já: o erro que sobe daqui desfaz o que ainda não foi gravado.
        await self._session.commit()

    async def _fail(self, record: Import, code: str) -> None:
        # O ponto de retorno desfeito deixa o registro desatualizado na memória.
        await self._session.refresh(record)
        record.status = ImportStatus.FAILED
        record.error_code = code
        record.mapping_preview = None
        record.waiting_since = None
        record.item_count = 0
        await self._discard_file(record)
        await self._imports.save(record.user_id, record)

    async def _discard_file(self, record: Import) -> None:
        """O original não fica guardado depois do processamento (FR-053)."""
        await self._imports.delete_file(record.user_id, record.id)

    async def _prepare_review(self, record: Import, ai_calls: list[AiCall]) -> None:
        content = await self._imports.read_file(record.user_id, record.id)
        if content is None:
            raise ImportFailed(FILE_MISSING)
        file = storage.StoredFile(
            content=content,
            format=ImportFormat(record.format),
            original_filename=record.original_filename,
        )
        head = content[: storage.SNIFF_BYTES]
        importer = find_importer(head, file.original_filename, file.format, ImportKind(record.kind))
        if importer is None:
            raise ImportFailed(UNREADABLE)

        account = await self._accounts.get(record.user_id, record.account_id)
        if account is None:  # pragma: no cover - a chave estrangeira garante a conta
            raise ImportFailed(PROCESSING_ERROR)
        account_type = AccountType(account.type)
        templates = {
            template.header_signature: template
            for template in await self._imports.list_templates(record.user_id)
        }
        context = ImportContext(
            account_type=account_type,
            templates={
                signature: ColumnMapping.model_validate(template.mapping)
                for signature, template in templates.items()
            },
            today=clock.today(),
        )

        try:
            raw = await importer.extract(file, context)
        except MappingRequired as required:
            self._await_mapping(record, required.preview)
            return
        if raw.ai_call is not None:
            ai_calls.append(raw.ai_call)
        try:
            proposed = importer.normalize(raw, context)
        except MappingMismatch:
            # O modelo salvo não lê este arquivo: sai, e o usuário mapeia de novo, sem reenviar.
            if raw.header_signature is not None:
                await self._imports.delete_template(record.user_id, raw.header_signature)
            try:
                await importer.extract(file, ImportContext(account_type=account_type))
            except MappingRequired as required:
                self._await_mapping(record, required.preview, error_code=MAPPING_MISMATCH)
                return
            raise
        if len(proposed) > MAX_TRANSACTIONS:
            raise ImportFailed(TOO_MANY_ROWS)

        items = await self._propose(record, proposed)
        await self._imports.add_items(record.user_id, record.id, items)

        now = clock.utcnow()
        template = templates.get(raw.header_signature) if raw.header_signature else None
        if template is not None:
            template.last_used_at = now
            record.template_id = template.id
        record.status = ImportStatus.AWAITING_REVIEW
        record.error_code = None
        record.mapping_preview = None
        record.waiting_since = now
        record.item_count = len(items)
        record.document_total_cents = raw.document_total_cents
        # Só há o que comparar quando o documento traz um total (FR-043).
        record.extracted_total_cents = (
            extracted_total_cents(proposed) if raw.document_total_cents is not None else None
        )
        record.bank_balance_cents = raw.balance_cents
        record.bank_balance_date = raw.balance_date
        await self._discard_file(record)
        await self._imports.save(record.user_id, record)

    def _await_mapping(
        self, record: Import, preview: MappingPreview, *, error_code: str | None = None
    ) -> None:
        """CSV ou planilha sem modelo: o arquivo fica guardado até o usuário mapear (FR-083)."""
        record.status = ImportStatus.AWAITING_MAPPING
        record.error_code = error_code
        record.mapping_preview = preview.model_dump(mode="json")
        record.waiting_since = clock.utcnow()

    async def _card_invoices(self, record: Import) -> list[CardInvoice]:
        """Os outros cartões ativos do usuário, com o que cada um tem em aberto na fatura."""
        cards = await self._reports.cards(record.user_id, reference=clock.today())
        return [
            CardInvoice(
                account_id=card.account_id,
                open_invoice_cents=(
                    card.payment.closed_invoice.amount_cents
                    if card.payment.closed_invoice is not None
                    else card.payment.total_due_cents
                ),
            )
            for card in cards
            if card.account_id != record.account_id
        ]

    async def _propose(self, record: Import, proposed: list[ProposedTransaction]) -> list[NewItem]:
        """Prepara as linhas da revisão: pagamento de fatura, duplicatas e categorias."""
        normalized = [normalize_description(transaction.description) for transaction in proposed]

        # Pagamento de fatura vira sugestão de transferência para o cartão (FR-081). Sem cartão
        # cadastrado, a linha segue como despesa.
        cards: list[CardInvoice] | None = None
        counter_accounts: list[uuid.UUID | None] = []
        for transaction, description in zip(proposed, normalized, strict=True):
            card_id: uuid.UUID | None = None
            if is_invoice_payment(transaction.type, description):
                if cards is None:
                    cards = await self._card_invoices(record)
                card_id = suggest_card(transaction.amount_cents, cards)
            counter_accounts.append(card_id)

        candidates: list[Candidate] = []
        seen_external_ids: set[str] = set()
        for transaction, description, card_id in zip(
            proposed, normalized, counter_accounts, strict=True
        ):
            # O banco só aceita um identificador externo por conta: se o arquivo o repete, só a
            # primeira linha fica com ele, e as outras são comparadas pelo resto.
            external_id = (transaction.external_id or "")[:MAX_EXTERNAL_ID_LENGTH] or None
            if external_id in seen_external_ids:
                external_id = None
            elif external_id is not None:
                seen_external_ids.add(external_id)
            is_transfer = card_id is not None
            final_type = TransactionType.TRANSFER if is_transfer else transaction.type
            candidates.append(
                Candidate(
                    type=final_type,
                    amount_cents=transaction.amount_cents,
                    date=transaction.date,
                    fingerprint=fingerprint(
                        account_id=record.account_id,
                        date=transaction.date,
                        transaction_type=final_type,
                        amount_cents=transaction.amount_cents,
                        description_normalized=description,
                    ),
                    external_id=external_id,
                    transfer_direction=TransferDirection.OUT if is_transfer else None,
                )
            )

        dates = [transaction.date for transaction in proposed]
        existing = await self._transactions.possible_duplicates(
            record.user_id,
            record.account_id,
            date_from=min(dates) - PROBABLE_WINDOW,
            date_to=max(dates) + PROBABLE_WINDOW,
            external_ids=sorted(seen_external_ids),
        )
        matches = classify(
            candidates,
            [
                ExistingTransaction(
                    id=transaction.id,
                    type=TransactionType(transaction.type),
                    amount_cents=transaction.amount_cents,
                    date=transaction.date,
                    fingerprint=transaction.fingerprint,
                    external_id=transaction.external_id,
                    transfer_direction=(
                        TransferDirection(transaction.transfer_direction)
                        if transaction.transfer_direction
                        else None
                    ),
                )
                for transaction in existing
            ],
        )

        # Transferência não tem categoria; as outras linhas vêm com uma sugerida (FR-047).
        to_categorize = [
            index
            for index, candidate in enumerate(candidates)
            if candidate.type != TransactionType.TRANSFER
        ]
        suggestions = dict(
            zip(
                to_categorize,
                await self._categorization.suggest(
                    record.user_id,
                    [
                        Line(
                            description_normalized=normalized[index],
                            kind=CategoryKind(candidates[index].type.value),
                        )
                        for index in to_categorize
                    ],
                ),
                strict=True,
            )
        )

        items: list[NewItem] = []
        for index, (transaction, candidate, match) in enumerate(
            zip(proposed, candidates, matches, strict=True)
        ):
            suggestion = suggestions.get(index)
            items.append(
                NewItem(
                    row_index=index,
                    type=candidate.type,
                    amount_cents=transaction.amount_cents,
                    date=transaction.date,
                    description=transaction.description,
                    description_normalized=normalized[index],
                    fingerprint=candidate.fingerprint,
                    external_id=candidate.external_id,
                    duplicate_status=match.status,
                    duplicate_of_id=match.duplicate_of_id,
                    selected_by_default=match.selected_by_default,
                    transfer_direction=candidate.transfer_direction,
                    suggested_category_id=suggestion.category_id if suggestion else None,
                    category_source=CategorySource(suggestion.source.value) if suggestion else None,
                    suggested_counter_account_id=counter_accounts[index],
                )
            )
        return items

    # ---------- expiração e limpeza, na tarefa periódica do worker

    async def expire_stale(self) -> int:
        """Expira as importações que esperaram demais e apaga os arquivos que sobraram (FR-083).

        Devolve quantas importações expiraram. Nada delas é salvo; o histórico as mostra como
        expiradas, com a orientação de enviar o arquivo de novo.
        """
        now = clock.utcnow()
        expired = 0
        for status, limit in WAIT_LIMITS.items():
            for record in await self._imports.waiting_before(status, now - limit):
                await self._imports.delete_items(record.user_id, record.id)
                await self._fail(record, EXPIRED_CODES[status])
                expired += 1
        await self._remove_leftover_files()
        return expired

    async def _remove_leftover_files(self) -> None:
        """Apaga o arquivo das importações que já não precisam dele.

        Arquivo sem importação não existe: a exclusão da importação apaga o dela em cascata.
        """
        finished = [status for status in ImportStatus if status not in _FILE_STILL_NEEDED]
        for record in await self._imports.with_file_in(finished):
            await self._discard_file(record)

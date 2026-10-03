"""Regras da importação: envio, processamento em segundo plano e mapeamento de colunas.

O que é comum a todos os formatos fica aqui: escolher o importador, normalizar as descrições,
calcular a impressão digital, marcar as duplicatas e gravar as transações propostas. Nada vira
transação antes da confirmação do usuário (FR-046).
"""

import datetime as dt
import logging
import uuid
from pathlib import PurePath

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.imports import storage
from app.modules.imports.duplicates import (
    PROBABLE_WINDOW,
    Candidate,
    ExistingTransaction,
    classify,
)
from app.modules.imports.importers import find_importer, supported_formats
from app.modules.imports.importers.base import (
    MAPPING_MISMATCH,
    MULTIPLE_ACCOUNTS,
    NO_TRANSACTIONS,
    TOO_MANY_ROWS,
    UNREADABLE,
    ImportContext,
    ImportFailed,
    MappingMismatch,
    MappingRequired,
    ProposedTransaction,
)
from app.modules.imports.mapping import ColumnMapping, MappingPreview
from app.modules.imports.models import (
    Import,
    ImportFormat,
    ImportItem,
    ImportKind,
    ImportStatus,
)
from app.modules.imports.repository import ImportRepository, NewItem
from app.modules.imports.schemas import ImportItemRead, ImportRead, MappingPreviewRead
from app.modules.transactions.models import TransactionType, TransferDirection
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import TransactionRepository
from app.modules.transactions.service import ACCOUNT_ARCHIVED, ACCOUNT_NOT_FOUND
from app.worker import queue
from app.worker.models import JobType

logger = logging.getLogger("contai.imports")

FILE_MISSING = "file_missing"
PROCESSING_ERROR = "processing_error"

MAX_TRANSACTIONS = 5_000
MAX_FILENAME_LENGTH = 255
PROCESS_MAX_ATTEMPTS = 3
# Quanto tempo uma importação espera o usuário antes de expirar (FR-083).
WAIT_LIMITS = {
    ImportStatus.AWAITING_MAPPING: dt.timedelta(hours=24),
    ImportStatus.AWAITING_REVIEW: dt.timedelta(days=7),
}

RECEIPT_NEEDS_PICTURE = (
    "Comprovante é uma foto ou um PDF. Para enviar um extrato em OFX, CSV ou planilha, "
    'escolha "Extrato".'
)
NOT_AWAITING_MAPPING = (
    "Esta importação não está esperando o mapeamento de colunas. Atualize a página para ver "
    "como ela está."
)
COLUMN_OUT_OF_RANGE = "Escolha uma das colunas do arquivo."
COLUMN_USED_TWICE = "Cada coluna só pode ser usada uma vez. Escolha outra coluna."
AMOUNT_REQUIRED = "Escolha a coluna do valor, ou as duas colunas: a de entrada e a de saída."
AMOUNT_BOTH_WAYS = (
    "Escolha a coluna do valor ou as colunas de entrada e de saída, e não as duas formas."
)

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
        "Algo deu errado do nosso lado ao ler o arquivo. Nada foi salvo. Envie de novo em "
        "alguns instantes."
    ),
}


def _invalid(fields: dict[str, str]) -> ValidationFailed:
    return ValidationFailed(details={"fields": fields})


def _safe_filename(filename: str | None) -> str:
    """Só o nome, sem pasta e sem caracteres de controle: ele aparece no histórico."""
    name = PurePath((filename or "").replace("\\", "/")).name
    printable = "".join(char for char in name if char.isprintable()).strip()
    return printable[:MAX_FILENAME_LENGTH] or "arquivo"


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
        self._transactions = TransactionRepository(session)

    # ---------- consulta

    async def get(self, user_id: uuid.UUID, import_id: uuid.UUID) -> ImportRead:
        return await self._read(await self._load(user_id, import_id))

    async def _load(
        self, user_id: uuid.UUID, import_id: uuid.UUID, *, for_update: bool = False
    ) -> Import:
        record = await self._imports.get(user_id, import_id, for_update=for_update)
        if record is None:
            raise NotFound()
        return record

    async def _read(self, record: Import) -> ImportRead:
        status = ImportStatus(record.status)
        items: list[ImportItem] | None = None
        if status == ImportStatus.AWAITING_REVIEW:
            items = await self._imports.list_items(record.user_id, record.id)
        preview: MappingPreviewRead | None = None
        if status == ImportStatus.AWAITING_MAPPING and record.mapping_preview is not None:
            preview = MappingPreviewRead.model_validate(record.mapping_preview)
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
            already_imported_at=await self._imports.completed_at_with_hash(
                record.user_id,
                account_id=record.account_id,
                file_hash=record.file_hash,
                except_id=record.id,
            ),
            mapping_preview=preview,
            items=[ImportItemRead.from_item(item) for item in items] if items is not None else None,
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
        if received.format not in supported_formats():
            raise storage.UnsupportedFile()
        if kind == ImportKind.RECEIPT:
            raise _invalid({"kind": RECEIPT_NEEDS_PICTURE})

        stored_filename = await storage.store(received.content)
        record = await self._imports.create(
            user_id,
            account_id=account.id,
            kind=kind,
            file_format=received.format,
            original_filename=_safe_filename(filename),
            file_hash=received.file_hash,
            stored_filename=stored_filename,
            created_at=clock.utcnow(),
        )
        await self._enqueue(record)
        return await self._read(record)

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

        try:
            # O ponto de retorno desfaz as linhas propostas se algo falhar depois de gravá-las.
            async with self._session.begin_nested():
                await self._prepare_review(record)
        except ImportFailed as failure:
            await self._fail(record, failure.code)
        except SQLAlchemyError:
            # Falha do banco é passageira: o job volta para a fila.
            raise
        except Exception:
            logger.exception("import processing crashed", extra={"import_id": str(import_id)})
            await self._fail(record, PROCESSING_ERROR)

    async def _fail(self, record: Import, code: str) -> None:
        # O ponto de retorno desfeito deixa o registro desatualizado na memória.
        await self._session.refresh(record)
        record.status = ImportStatus.FAILED
        record.error_code = code
        record.mapping_preview = None
        record.waiting_since = None
        try:
            await self._discard_file(record)
        except OSError:
            # A falha fica registrada mesmo assim; o arquivo que sobrou sai na limpeza periódica.
            logger.warning("import file not deleted", extra={"import_id": str(record.id)})
        await self._imports.save(record.user_id, record)

    async def _discard_file(self, record: Import) -> None:
        """O original não fica guardado depois do processamento (FR-053)."""
        if record.stored_filename is not None:
            await storage.delete(record.stored_filename)
            record.stored_filename = None

    async def _prepare_review(self, record: Import) -> None:
        if record.stored_filename is None:
            raise ImportFailed(FILE_MISSING)
        file = storage.StoredFile(
            stored_filename=record.stored_filename,
            format=ImportFormat(record.format),
            original_filename=record.original_filename,
        )
        try:
            head = (await file.read())[: storage.SNIFF_BYTES]
        except FileNotFoundError as error:
            raise ImportFailed(FILE_MISSING) from error
        importer = find_importer(head, file.original_filename, file.format)
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
        )

        try:
            raw = await importer.extract(file, context)
        except MappingRequired as required:
            self._await_mapping(record, required.preview)
            return
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

    async def _propose(self, record: Import, proposed: list[ProposedTransaction]) -> list[NewItem]:
        """Normaliza as descrições, calcula as impressões digitais e marca as duplicatas."""
        candidates: list[tuple[ProposedTransaction, str, Candidate]] = []
        seen_external_ids: set[str] = set()
        for transaction in proposed:
            normalized = normalize_description(transaction.description)
            # O banco só aceita um identificador externo por conta: se o arquivo o repete, só a
            # primeira linha fica com ele, e as outras são comparadas pelo resto.
            external_id = (transaction.external_id or "")[:255] or None
            if external_id in seen_external_ids:
                external_id = None
            elif external_id is not None:
                seen_external_ids.add(external_id)
            candidates.append(
                (
                    transaction,
                    normalized,
                    Candidate(
                        type=transaction.type,
                        amount_cents=transaction.amount_cents,
                        date=transaction.date,
                        fingerprint=fingerprint(
                            account_id=record.account_id,
                            date=transaction.date,
                            transaction_type=transaction.type,
                            amount_cents=transaction.amount_cents,
                            description_normalized=normalized,
                        ),
                        external_id=external_id,
                    ),
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
            [candidate for _, _, candidate in candidates],
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
        return [
            NewItem(
                row_index=index,
                type=transaction.type,
                amount_cents=transaction.amount_cents,
                date=transaction.date,
                description=transaction.description,
                description_normalized=normalized,
                fingerprint=candidate.fingerprint,
                external_id=candidate.external_id,
                duplicate_status=match.status,
                duplicate_of_id=match.duplicate_of_id,
                selected_by_default=match.selected_by_default,
            )
            for index, ((transaction, normalized, candidate), match) in enumerate(
                zip(candidates, matches, strict=True)
            )
        ]

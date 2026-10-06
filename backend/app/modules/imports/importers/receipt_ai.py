"""Importador de comprovante, recibo ou nota fiscal, em foto ou PDF, lido por IA (FR-042).

Um comprovante gera uma única transação proposta, em uma única chamada ao modelo.
"""

from app.ai.models import AiTask
from app.modules.imports import storage
from app.modules.imports.importers import ai_document
from app.modules.imports.importers.ai_schemas import ReceiptExtraction
from app.modules.imports.importers.base import (
    DOCUMENT_UNREADABLE,
    ImportContext,
    ImportFailed,
    ProposedTransaction,
    RawDocument,
)
from app.modules.imports.models import ImportFormat, ImportKind
from app.modules.imports.storage import StoredFile

PROMPT = "receipt_v1.md"


class ReceiptAiImporter:
    formats = frozenset({ImportFormat.PDF, ImportFormat.IMAGE})
    kinds = frozenset({ImportKind.RECEIPT})

    def detect(self, head: bytes, filename: str) -> bool:
        return storage.media_type(head) in storage.AI_MEDIA_TYPES

    async def extract(
        self, file: StoredFile, context: ImportContext
    ) -> RawDocument[ReceiptExtraction]:
        extraction, call = await ai_document.read_document(
            await file.read(),
            prompt=PROMPT,
            schema=ReceiptExtraction,
            task=AiTask.RECEIPT_EXTRACTION,
            today=ai_document.reference_day(context),
        )
        return RawDocument(rows=[extraction], ai_call=call)

    def normalize(
        self, raw: RawDocument[ReceiptExtraction], context: ImportContext
    ) -> list[ProposedTransaction]:
        [receipt] = raw.rows
        transaction = ai_document.to_proposed(
            # Recibo sem data: vale o dia do envio, e o usuário confere na revisão.
            date=ai_document.to_date(receipt.date) or ai_document.reference_day(context),
            description=receipt.description,
            amount=receipt.amount,
            direction=receipt.direction,
        )
        if transaction is None:
            raise ImportFailed(DOCUMENT_UNREADABLE)
        return [transaction]

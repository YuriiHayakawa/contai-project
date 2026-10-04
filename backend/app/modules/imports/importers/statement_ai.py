"""Importador de extrato ou fatura em PDF, lido por IA (FR-041).

O PDF vai inteiro ao modelo, em uma chamada, e volta como linhas de texto e, quando o documento
traz, o total impresso. A soma das linhas e a comparação com o total ficam no serviço de
importação (FR-043).
"""

from app.ai.models import AiTask
from app.modules.imports import storage
from app.modules.imports.importers import ai_document
from app.modules.imports.importers.ai_schemas import ExtractedLine, StatementExtraction
from app.modules.imports.importers.base import (
    DOCUMENT_UNREADABLE,
    ImportContext,
    ImportFailed,
    ProposedTransaction,
    RawDocument,
)
from app.modules.imports.models import ImportFormat, ImportKind
from app.modules.imports.storage import StoredFile

PROMPT = "statement_v1.md"


class StatementAiImporter:
    formats = frozenset({ImportFormat.PDF})
    kinds = frozenset({ImportKind.STATEMENT})

    def detect(self, head: bytes, filename: str) -> bool:
        return storage.media_type(head) == storage.PDF_MEDIA_TYPE

    async def extract(self, file: StoredFile, context: ImportContext) -> RawDocument[ExtractedLine]:
        extraction, call = await ai_document.read_document(
            await file.read(),
            prompt=PROMPT,
            schema=StatementExtraction,
            task=AiTask.STATEMENT_EXTRACTION,
            today=ai_document.reference_day(context),
        )
        return RawDocument(
            rows=extraction.lines,
            # Um total que não dá para ler é um documento sem total: não há o que comparar.
            document_total_cents=ai_document.to_cents(extraction.total),
            ai_call=call,
        )

    def normalize(
        self, raw: RawDocument[ExtractedLine], context: ImportContext
    ) -> list[ProposedTransaction]:
        proposed = [
            transaction
            for line in raw.rows
            if (
                transaction := ai_document.to_proposed(
                    date=ai_document.to_date(line.date),
                    description=line.description,
                    amount=line.amount,
                    direction=line.direction,
                )
            )
        ]
        if not proposed:
            raise ImportFailed(DOCUMENT_UNREADABLE)
        return proposed

"""Registro dos importadores.

Adicionar um banco ou formato é criar um arquivo nesta pasta e incluí-lo em `IMPORTERS`; o
serviço de importação não muda.
"""

from typing import Any

from app.modules.imports.importers.base import Importer
from app.modules.imports.importers.ofx import OfxImporter
from app.modules.imports.importers.receipt_ai import ReceiptAiImporter
from app.modules.imports.importers.statement_ai import StatementAiImporter
from app.modules.imports.importers.tabular import TabularImporter
from app.modules.imports.models import ImportFormat, ImportKind

# A ordem é a da consulta: o primeiro que reconhece o arquivo fica com ele.
IMPORTERS: tuple[Importer[Any], ...] = (
    OfxImporter(),
    TabularImporter(),
    StatementAiImporter(),
    ReceiptAiImporter(),
)
# Os formatos lidos pelo serviço de IA externo: pedem o aceite do aviso e contam no limite
# diário de extrações.
AI_FORMATS = frozenset({ImportFormat.PDF, ImportFormat.IMAGE})


def _reads(importer: Importer[Any], file_format: ImportFormat, kind: ImportKind) -> bool:
    return file_format in importer.formats and kind in importer.kinds


def find_importer(
    head: bytes, filename: str, file_format: ImportFormat, kind: ImportKind
) -> Importer[Any] | None:
    """O importador que reconhece o arquivo, entre os que leem o formato e o tipo dele."""
    for importer in IMPORTERS:
        if _reads(importer, file_format, kind) and importer.detect(head, filename):
            return importer
    return None


def is_supported(file_format: ImportFormat, kind: ImportKind) -> bool:
    """Se algum importador lê este formato como este tipo de documento."""
    return any(_reads(importer, file_format, kind) for importer in IMPORTERS)

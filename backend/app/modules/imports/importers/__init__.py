"""Registro dos importadores.

Adicionar um banco ou formato é criar um arquivo nesta pasta e incluí-lo em `IMPORTERS`; o
serviço de importação não muda.
"""

from typing import Any

from app.modules.imports.importers.base import Importer
from app.modules.imports.importers.ofx import OfxImporter
from app.modules.imports.importers.tabular import TabularImporter
from app.modules.imports.models import ImportFormat

# A ordem é a da consulta: o primeiro que reconhece o arquivo fica com ele.
IMPORTERS: tuple[Importer[Any], ...] = (OfxImporter(), TabularImporter())


def find_importer(head: bytes, filename: str, file_format: ImportFormat) -> Importer[Any] | None:
    """O importador que reconhece o arquivo, entre os que leem o formato dele."""
    for importer in IMPORTERS:
        if file_format in importer.formats and importer.detect(head, filename):
            return importer
    return None


def supported_formats() -> frozenset[ImportFormat]:
    """Os formatos que algum importador lê."""
    return frozenset(file_format for importer in IMPORTERS for file_format in importer.formats)

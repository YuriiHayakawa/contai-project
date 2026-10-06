"""Arquivos enviados: limite de tamanho, tipo real, gravação no volume privado e exclusão.

O tipo vem do conteúdo, nunca da extensão nem do `Content-Type` informado: PDF, imagem e
planilha são reconhecidos pelos primeiros bytes; OFX e CSV, que são texto, pela inspeção do
conteúdo (research.md, seção 9). O arquivo fica em um volume privado, com nome gerado aqui, e é
apagado depois do processamento (FR-053).
"""

import asyncio
import datetime as dt
import hashlib
import io
import re
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import filetype

from app.core.config import get_settings
from app.core.errors import DomainError, PayloadTooLarge
from app.modules.imports.models import ImportFormat

CHUNK_SIZE = 64 * 1024
# Quanto do começo do arquivo basta para reconhecer o tipo.
SNIFF_BYTES = 8192

UNSUPPORTED_FILE = (
    "Esse tipo de arquivo não é aceito. Envie o extrato em OFX, CSV, planilha Excel (.xlsx) ou "
    "PDF, ou a foto de um comprovante em JPG ou PNG."
)
EMPTY_FILE = "O arquivo está vazio. Exporte o extrato de novo no site do banco e envie."
OLD_EXCEL = (
    "Planilhas no formato antigo (.xls) não são aceitas. Abra a planilha, salve como .xlsx e "
    "envie de novo."
)
ENCRYPTED_PDF = (
    "Este PDF está protegido por senha. Abra o arquivo, salve uma cópia sem senha (por "
    'exemplo, em "Imprimir" e "Salvar como PDF") e envie a cópia.'
)

PDF_MEDIA_TYPE = "application/pdf"
# O que vai ao serviço de IA: o PDF e as imagens aceitas.
AI_MEDIA_TYPES = frozenset({PDF_MEDIA_TYPE, "image/jpeg", "image/png"})
# Um PDF cifrado traz esta entrada no dicionário final; o modelo não conseguiria abri-lo.
_PDF_ENCRYPTION_MARKER = b"/Encrypt"

_STORED_NAME = re.compile(r"[0-9a-f]{32}")
_ZIP_MAGIC = b"PK\x03\x04"
# Formato dos arquivos antigos do Office, como o .xls.
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_XLSX_WORKBOOK = "xl/workbook.xml"
_IMAGE_TYPES = AI_MEDIA_TYPES - {PDF_MEDIA_TYPE}
_CSV_DELIMITERS = (";", ",", "\t", "|")
# Em texto só aparecem estes caracteres de controle: tabulação, quebras de linha e fim de arquivo.
_TEXT_CONTROLS = frozenset("\t\n\r\f\x1a")


class UnsupportedFile(DomainError):
    status_code = 415
    code = "unsupported_file"
    message = UNSUPPORTED_FILE


class Readable(Protocol):
    """O que se usa do arquivo enviado: a leitura em blocos."""

    async def read(self, size: int = -1) -> bytes: ...


@dataclass(frozen=True)
class ReceivedFile:
    """Um envio já conferido: cabe no limite e é de um tipo aceito."""

    content: bytes
    format: ImportFormat
    # SHA-256 do conteúdo: avisa quando o mesmo arquivo já foi importado.
    file_hash: str


@dataclass(frozen=True)
class StoredFile:
    """Um arquivo guardado no volume privado, como os importadores o recebem."""

    stored_filename: str
    format: ImportFormat
    # Nome dado pelo usuário: só ajuda a reconhecer o formato; nunca vira caminho.
    original_filename: str

    async def read(self) -> bytes:
        return await read(self.stored_filename)


def decode_text(data: bytes) -> str | None:
    """O conteúdo como texto, ou `None` quando ele é binário.

    Bancos brasileiros exportam em UTF-8, em Windows-1252 e, às vezes, em UTF-16.
    """
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings: tuple[str, ...] = ("utf-16",)
    else:
        encodings = ("utf-8-sig", "cp1252", "latin-1")
    for encoding in encodings:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if any(char < " " and char not in _TEXT_CONTROLS for char in text):
            return None
        return text
    return None


def looks_like_ofx(text: str) -> bool:
    upper = text.upper()
    return "<OFX>" in upper or "OFXHEADER" in upper


def looks_like_csv(text: str) -> bool:
    """Texto em linhas, com um separador de colunas logo nas primeiras."""
    lines = [line for line in text.splitlines() if line.strip()][:5]
    return any(delimiter in line for line in lines for delimiter in _CSV_DELIMITERS)


def is_xlsx(content: bytes) -> bool:
    """Um .xlsx é um ZIP com a pasta de trabalho dentro; um ZIP qualquer não serve."""
    if not content.startswith(_ZIP_MAGIC):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            return _XLSX_WORKBOOK in archive.namelist()
    except zipfile.BadZipFile:
        return False


def media_type(content: bytes) -> str | None:
    """O tipo de um PDF ou de uma imagem aceita, pelos primeiros bytes; `None` para o resto."""
    kind = filetype.guess(content[:SNIFF_BYTES])
    mime = kind.mime if kind is not None else None
    return mime if mime in AI_MEDIA_TYPES else None


def sniff_format(content: bytes) -> ImportFormat | None:
    """O formato de verdade do arquivo, pelo conteúdo; `None` quando não é um tipo aceito."""
    head = content[:SNIFF_BYTES]
    kind = filetype.guess(head)
    mime = kind.mime if kind is not None else None
    if mime == PDF_MEDIA_TYPE:
        return ImportFormat.PDF
    if mime in _IMAGE_TYPES:
        return ImportFormat.IMAGE
    if is_xlsx(content):
        return ImportFormat.XLSX
    if mime is not None:
        return None
    text = decode_text(head)
    if text is None:
        return None
    if looks_like_ofx(text):
        return ImportFormat.OFX
    if looks_like_csv(text):
        return ImportFormat.CSV
    return None


async def receive(upload: Readable, *, max_bytes: int | None = None) -> ReceivedFile:
    """Lê o envio em blocos, parando no limite, e confere o tipo pelo conteúdo."""
    limit = max_bytes if max_bytes is not None else get_settings().upload_max_bytes
    chunks: list[bytes] = []
    size = 0
    while chunk := await upload.read(CHUNK_SIZE):
        size += len(chunk)
        if size > limit:
            raise PayloadTooLarge()
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content.strip():
        raise UnsupportedFile(EMPTY_FILE)
    if content.startswith(_OLE_MAGIC):
        raise UnsupportedFile(OLD_EXCEL)
    file_format = sniff_format(content)
    if file_format is None:
        raise UnsupportedFile()
    if file_format == ImportFormat.PDF and _PDF_ENCRYPTION_MARKER in content:
        raise UnsupportedFile(ENCRYPTED_PDF)
    return ReceivedFile(
        content=content, format=file_format, file_hash=hashlib.sha256(content).hexdigest()
    )


def _path(stored_filename: str) -> Path:
    # O nome vem do banco, mas só um nome gerado aqui vira caminho no disco.
    if not _STORED_NAME.fullmatch(stored_filename):
        raise ValueError("nome de arquivo inválido")
    return get_settings().upload_dir / stored_filename


def _write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


async def store(content: bytes) -> str:
    """Grava o conteúdo no volume privado e devolve o nome gerado."""
    stored_filename = uuid.uuid4().hex
    await asyncio.to_thread(_write, _path(stored_filename), content)
    return stored_filename


def _older_than(cutoff: float) -> list[str]:
    folder = get_settings().upload_dir
    if not folder.is_dir():
        return []
    return [
        path.name
        for path in folder.iterdir()
        if _STORED_NAME.fullmatch(path.name) and path.stat().st_mtime < cutoff
    ]


async def stored_before(moment: dt.datetime) -> list[str]:
    """Os arquivos guardados aqui antes de `moment`, para a limpeza dos que ficaram sem dono."""
    return await asyncio.to_thread(_older_than, moment.timestamp())


async def read(stored_filename: str) -> bytes:
    return await asyncio.to_thread(_path(stored_filename).read_bytes)


async def delete(stored_filename: str) -> None:
    """Apaga o arquivo; um arquivo que já não existe não é erro."""
    await asyncio.to_thread(_path(stored_filename).unlink, missing_ok=True)

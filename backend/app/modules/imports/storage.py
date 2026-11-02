"""Arquivos enviados: limite de tamanho e tipo real.

O tipo vem do conteúdo, nunca da extensão nem do `Content-Type` informado: PDF, imagem e
planilha são reconhecidos pelos primeiros bytes; OFX e CSV, que são texto, pela inspeção do
conteúdo (research.md, seção 9). O conteúdo aceito é guardado pelo repositório de importações,
no banco, e apagado depois do processamento (FR-053, ADR 0011).
"""

import hashlib
import io
import zipfile
from dataclasses import dataclass
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
    """Um arquivo guardado, como os importadores o recebem."""

    content: bytes
    format: ImportFormat
    # Nome dado pelo usuário: só ajuda a reconhecer o formato; nunca vira caminho.
    original_filename: str

    async def read(self) -> bytes:
        return self.content


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

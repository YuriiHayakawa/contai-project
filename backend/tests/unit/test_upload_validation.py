"""Validação do envio: tamanho, tipo real pelo conteúdo e nome gerado pelo sistema."""

import hashlib
import io
import re
import zipfile
from pathlib import Path

import pytest

from app.core.errors import PayloadTooLarge
from app.modules.imports import storage
from app.modules.imports.models import ImportFormat
from app.modules.imports.storage import UnsupportedFile
from tests.imports import fixture_bytes, stored_files

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n"
OLD_XLS = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64
EXECUTABLE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00" + b"\x00" * 64


class FakeUpload:
    """Um envio que conta quanto foi lido dele."""

    def __init__(self, content: bytes) -> None:
        self._stream = io.BytesIO(content)
        self.bytes_read = 0

    async def read(self, size: int = -1) -> bytes:
        chunk = self._stream.read(size)
        self.bytes_read += len(chunk)
        return chunk


def _zip(**files: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


# ---------- tamanho


async def test_a_file_at_the_limit_is_accepted_and_one_byte_more_is_refused() -> None:
    content = b"Data;Valor\n" + b"01/09/2026;1,00\n" * 10

    received = await storage.receive(FakeUpload(content), max_bytes=len(content))
    assert received.content == content

    with pytest.raises(PayloadTooLarge) as refused:
        await storage.receive(FakeUpload(content), max_bytes=len(content) - 1)
    assert refused.value.status_code == 413
    assert "10 MB" in refused.value.message


async def test_reading_stops_as_soon_as_the_limit_is_passed() -> None:
    upload = FakeUpload(b"x" * (10 * storage.CHUNK_SIZE))

    with pytest.raises(PayloadTooLarge):
        await storage.receive(upload, max_bytes=storage.CHUNK_SIZE)

    # Leu em blocos e parou no segundo: o resto do envio nem chegou à memória.
    assert upload.bytes_read == 2 * storage.CHUNK_SIZE


async def test_the_default_limit_is_ten_megabytes() -> None:
    with pytest.raises(PayloadTooLarge):
        await storage.receive(FakeUpload(b"a;b\n" * (10 * 1024 * 1024 // 4 + 1)))


# ---------- tipo real


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("banco_azul.ofx", ImportFormat.OFX),
        ("cartao_verde.ofx", ImportFormat.OFX),
        ("banco_laranja_fora_do_padrao.ofx", ImportFormat.OFX),
        ("extrato_ponto_e_virgula.csv", ImportFormat.CSV),
        ("fatura_virgula.csv", ImportFormat.CSV),
        ("extrato_entrada_saida.csv", ImportFormat.CSV),
        ("extrato.xlsx", ImportFormat.XLSX),
    ],
)
async def test_recognizes_every_accepted_format_by_the_content(
    name: str, expected: ImportFormat
) -> None:
    received = await storage.receive(FakeUpload(fixture_bytes(name)))

    assert received.format == expected


@pytest.mark.parametrize(
    ("content", "expected"),
    [(PDF, ImportFormat.PDF), (PNG, ImportFormat.IMAGE), (JPEG, ImportFormat.IMAGE)],
    ids=["pdf", "png", "jpeg"],
)
def test_the_type_comes_from_the_content_whatever_the_name_says(
    content: bytes, expected: ImportFormat
) -> None:
    # Uma imagem enviada como "extrato.csv" continua sendo uma imagem.
    assert storage.sniff_format(content) == expected


def test_a_csv_in_utf16_is_text() -> None:
    assert storage.sniff_format("Data;Valor\n01/09/2026;1,00".encode("utf-16")) == ImportFormat.CSV


@pytest.mark.parametrize(
    "content",
    [
        EXECUTABLE,
        _zip(**{"leia-me.txt": "um zip qualquer"}),
        _zip(**{"word/document.xml": "<w/>", "[Content_Types].xml": "<Types/>"}),
        b"PK\x03\x04 isto diz que e zip mas nao e",
        b"GIF89a" + b"\x00" * 32,
        b"Uma carta em texto corrido sem nenhuma coluna para separar",
        b"{\\rtf1\\ansi texto}",
    ],
    ids=["executável", "zip", "documento do word", "zip quebrado", "gif", "texto corrido", "rtf"],
)
async def test_a_type_that_is_not_accepted_is_refused(content: bytes) -> None:
    with pytest.raises(UnsupportedFile) as refused:
        await storage.receive(FakeUpload(content))

    assert refused.value.status_code == 415
    assert refused.value.code == "unsupported_file"
    assert "OFX, CSV ou planilha" in refused.value.message


@pytest.mark.parametrize("content", [b"", b"   \n\r\n\t  "], ids=["vazio", "só espaços"])
async def test_an_empty_file_is_refused_with_its_own_message(content: bytes) -> None:
    with pytest.raises(UnsupportedFile) as refused:
        await storage.receive(FakeUpload(content))

    assert refused.value.message == storage.EMPTY_FILE


async def test_an_old_excel_file_says_how_to_convert_it() -> None:
    with pytest.raises(UnsupportedFile) as refused:
        await storage.receive(FakeUpload(OLD_XLS))

    assert ".xlsx" in refused.value.message


async def test_the_hash_is_the_sha256_of_the_content() -> None:
    content = fixture_bytes("banco_azul.ofx")

    received = await storage.receive(FakeUpload(content))

    assert received.file_hash == hashlib.sha256(content).hexdigest()


# ---------- gravação no volume privado


async def test_the_stored_name_is_generated_by_the_system(upload_dir: Path) -> None:
    first = await storage.store(b"conteudo")
    second = await storage.store(b"conteudo")

    # Nada do nome dado pelo usuário chega ao disco, nem a extensão.
    assert re.fullmatch(r"[0-9a-f]{32}", first)
    assert first != second
    assert [path.name for path in stored_files(upload_dir)] == sorted([first, second])
    assert await storage.read(first) == b"conteudo"


async def test_the_upload_folder_is_created_when_missing(
    upload_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "upload_dir", upload_dir / "nova" / "pasta")

    stored = await storage.store(b"conteudo")

    assert (upload_dir / "nova" / "pasta" / stored).read_bytes() == b"conteudo"


async def test_deleting_removes_the_file_and_can_be_repeated(upload_dir: Path) -> None:
    stored = await storage.store(b"conteudo")

    await storage.delete(stored)
    await storage.delete(stored)

    assert stored_files(upload_dir) == []
    with pytest.raises(FileNotFoundError):
        await storage.read(stored)


@pytest.mark.parametrize(
    "name", ["../segredo", "..\\segredo", "/etc/passwd", "extrato.ofx", "", "A" * 32]
)
async def test_only_a_name_generated_here_becomes_a_path(name: str, upload_dir: Path) -> None:
    for operation in (storage.read, storage.delete):
        with pytest.raises(ValueError, match="inválido"):
            await operation(name)

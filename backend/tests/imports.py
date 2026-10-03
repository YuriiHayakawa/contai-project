"""Atalhos dos testes de importação: arquivos de exemplo, envio pela API e leitura direta."""

from pathlib import Path
from typing import Any

from httpx import AsyncClient, Response

from app.modules.accounts.models import AccountType
from app.modules.imports import storage
from app.modules.imports.importers.base import ImportContext, Importer, ProposedTransaction
from app.modules.imports.mapping import ColumnMapping
from app.modules.imports.models import ImportFormat

IMPORTS = "/api/v1/imports"
# Arquivos com dados fictícios, um por formato e por jeito de banco.
FIXTURES = Path(__file__).parent / "fixtures" / "imports"

Json = dict[str, Any]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def stored_files(upload_dir: Path) -> list[Path]:
    """O que está guardado no volume de uploads do teste."""
    return sorted(upload_dir.iterdir())


async def send_file(
    client: AsyncClient, account: Json, name: str, content: bytes | None = None, **fields: str
) -> Response:
    """Envia um arquivo para a conta; sem `content`, o arquivo de exemplo com esse nome."""
    return await client.post(
        IMPORTS,
        files={"file": (name, fixture_bytes(name) if content is None else content)},
        data={"account_id": account["id"], **fields},
    )


async def upload(
    client: AsyncClient, account: Json, name: str, content: bytes | None = None
) -> Json:
    response = await send_file(client, account, name, content)
    assert response.status_code == 202, response.text
    body: Json = response.json()
    return body


async def get_import(client: AsyncClient, record: Json) -> Json:
    response = await client.get(f"{IMPORTS}/{record['id']}")
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def stored_file(content: bytes, name: str = "extrato") -> storage.StoredFile:
    """Guarda o conteúdo no volume de testes, como o envio faria."""
    file_format = storage.sniff_format(content)
    assert file_format is not None
    return storage.StoredFile(
        stored_filename=await storage.store(content),
        format=ImportFormat(file_format),
        original_filename=name,
    )


async def read_with(
    importer: Importer[Any],
    content: bytes,
    *,
    account_type: AccountType = AccountType.CHECKING,
    templates: dict[str, ColumnMapping] | None = None,
) -> list[ProposedTransaction]:
    """Lê o conteúdo com o importador, do arquivo guardado às transações propostas."""
    context = ImportContext(account_type=account_type, templates=templates or {})
    raw = await importer.extract(await stored_file(content), context)
    return importer.normalize(raw, context)

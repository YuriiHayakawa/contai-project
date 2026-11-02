"""Atalhos dos testes de importação: arquivos de exemplo, envio pela API e leitura direta."""

from pathlib import Path
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import AccountType
from app.modules.imports import storage
from app.modules.imports.importers.base import ImportContext, Importer, ProposedTransaction
from app.modules.imports.mapping import ColumnMapping
from app.modules.imports.models import ImportFile, ImportFormat

IMPORTS = "/api/v1/imports"
# Arquivos com dados fictícios, um por formato e por jeito de banco.
FIXTURES = Path(__file__).parent / "fixtures" / "imports"

Json = dict[str, Any]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


async def stored_files(session: AsyncSession) -> list[bytes]:
    """O conteúdo dos arquivos enviados que o banco ainda guarda, de todos os usuários."""
    result = await session.execute(select(ImportFile.content))
    return sorted(result.scalars())


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
    """O arquivo guardado, como o processamento o entrega ao importador."""
    file_format = storage.sniff_format(content)
    assert file_format is not None
    return storage.StoredFile(
        content=content,
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


def decisions(record: Json) -> list[Json]:
    """A decisão final de cada linha como a revisão a sugere: as marcadas por padrão, com a
    categoria ou a conta sugerida."""
    return [
        {
            "id": item["id"],
            "selected": item["selected_by_default"],
            "type": item["type"],
            "amount_cents": item["amount_cents"],
            "date": item["date"],
            "description": item["description"],
            "notes": item["notes"],
            "category_id": item["suggested_category_id"],
            "counter_account_id": item["suggested_counter_account_id"],
        }
        for item in record["items"]
    ]


def saved_decisions(record: Json) -> list[Json]:
    """A decisão final de cada linha como está guardada na revisão, com o que o usuário já
    corrigiu: é o que a tela envia ao confirmar uma revisão retomada."""
    return [
        {
            "id": item["id"],
            "selected": item["selected"],
            "type": item["type"],
            "amount_cents": item["amount_cents"],
            "date": item["date"],
            "description": item["description"],
            "notes": item["notes"],
            "category_id": item["category_id"],
            "counter_account_id": item["counter_account_id"],
        }
        for item in record["items"]
    ]


async def send_item_update(
    client: AsyncClient, record: Json, item: Json, **changes: object
) -> Response:
    """Guarda a correção de uma linha da revisão."""
    return await client.patch(f"{IMPORTS}/{record['id']}/items/{item['id']}", json=changes)


async def update_item(client: AsyncClient, record: Json, item: Json, **changes: object) -> Json:
    response = await send_item_update(client, record, item, **changes)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def send_confirmation(
    client: AsyncClient, record: Json, items: list[Json] | None = None
) -> Response:
    """Confirma a revisão; sem `items`, do jeito que ela veio sugerida."""
    body = {"items": decisions(record) if items is None else items}
    return await client.post(f"{IMPORTS}/{record['id']}/confirm", json=body)


async def confirm(client: AsyncClient, record: Json, items: list[Json] | None = None) -> Json:
    response = await send_confirmation(client, record, items)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body

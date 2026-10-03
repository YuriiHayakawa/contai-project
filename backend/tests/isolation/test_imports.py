"""Isolamento das importações.

O usuário A envia um arquivo e o usuário B tenta alcançar a importação: pelo endereço, recebe
404, igual ao de uma importação que não existe; ao tentar importar para uma conta de A, recebe a
recusa de um valor inválido. Nada de A muda.
"""

import uuid
from typing import Any

from httpx import AsyncClient, Response

from app.core import clock
from app.modules.imports.importers.tabular import header_signature
from app.modules.imports.mapping import MappingPreview, MappingSuggestion
from app.modules.imports.models import ImportFormat, ImportKind, ImportStatus
from app.modules.imports.repository import ImportRepository
from tests.finance import create_account
from tests.imports import IMPORTS, get_import, send_file, upload
from tests.isolation.registry import IsolationContext, isolation_case

Json = dict[str, Any]

MAPPING = {"date_column": 0, "description_column": 1, "amount_column": 2}


async def _account_of_a(context: IsolationContext) -> Json:
    return await create_account(context.client_a, name=f"Conta {uuid.uuid4().hex[:8]}")


async def _import_of_a(context: IsolationContext) -> Json:
    return await upload(context.client_a, await _account_of_a(context), "banco_azul.ofx")


async def _import_of_a_awaiting_mapping(context: IsolationContext) -> Json:
    """Uma importação de A à espera das colunas, como o worker a deixaria."""
    account = await _account_of_a(context)
    columns = ["Data", "Descrição", "Valor"]
    record = await ImportRepository(context.session).create(
        context.user_a.id,
        account_id=uuid.UUID(account["id"]),
        kind=ImportKind.STATEMENT,
        file_format=ImportFormat.CSV,
        original_filename="extrato.csv",
        file_hash="0" * 64,
        stored_filename=uuid.uuid4().hex,
        created_at=clock.utcnow(),
    )
    record.status = ImportStatus.AWAITING_MAPPING
    record.waiting_since = clock.utcnow()
    record.mapping_preview = MappingPreview(
        header_signature=header_signature(columns),
        columns=columns,
        rows=[["10/09/2026", "Padaria São João", "-45,90"]],
        suggestion=MappingSuggestion(),
    ).model_dump(mode="json")
    await context.session.commit()
    return await get_import(context.client_a, {"id": str(record.id)})


async def _same_as_unknown(client: AsyncClient, method: str, url: str, **kwargs: Any) -> None:
    """A resposta para a importação de outro usuário é a mesma de uma inexistente."""
    unknown_url = url.replace(url.split("/")[4], str(uuid.uuid4()))
    of_other: Response = await client.request(method, url, **kwargs)
    unknown: Response = await client.request(method, unknown_url, **kwargs)

    assert of_other.status_code == 404, of_other.text
    assert unknown.status_code == 404
    assert of_other.json()["error"] == unknown.json()["error"]


@isolation_case("POST", "/api/v1/imports")
async def upload_to_the_account_of_another_user(context: IsolationContext) -> None:
    account = await _account_of_a(context)
    unknown = {"id": str(uuid.uuid4())}

    of_other = await send_file(context.client_b, account, "banco_azul.ofx")
    of_none = await send_file(context.client_b, unknown, "banco_azul.ofx")

    # A conta de outro usuário é recusada como uma conta que não existe.
    assert of_other.status_code == 422, of_other.text
    assert of_other.json()["error"] == of_none.json()["error"]
    assert set(of_other.json()["error"]["details"]["fields"]) == {"account_id"}


@isolation_case("GET", "/api/v1/imports/{import_id}")
async def get_import_of_another_user(context: IsolationContext) -> None:
    record = await _import_of_a(context)

    await _same_as_unknown(context.client_b, "GET", f"{IMPORTS}/{record['id']}")

    assert (await get_import(context.client_a, record))["status"] == "queued"


@isolation_case("POST", "/api/v1/imports/{import_id}/mapping")
async def map_the_import_of_another_user(context: IsolationContext) -> None:
    record = await _import_of_a_awaiting_mapping(context)

    await _same_as_unknown(
        context.client_b, "POST", f"{IMPORTS}/{record['id']}/mapping", json=MAPPING
    )

    # A importação de A continua esperando as colunas, e nenhum modelo foi salvo para ela.
    unchanged = await get_import(context.client_a, record)
    assert unchanged["status"] == "awaiting_mapping"
    assert unchanged == record
    assert await ImportRepository(context.session).list_templates(context.user_a.id) == []
    assert await ImportRepository(context.session).list_templates(context.user_b.id) == []

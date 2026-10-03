"""Rotas de importação. Só validam a entrada, chamam o serviço e formatam a resposta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Form, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_session
from app.core.rate_limit import limiter, user_or_ip
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.imports.mapping import ColumnMapping
from app.modules.imports.models import ImportKind
from app.modules.imports.schemas import ImportConfirm, ImportPage, ImportRead
from app.modules.imports.service import ImportService

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def get_import_service(session: Annotated[AsyncSession, Depends(get_session)]) -> ImportService:
    return ImportService(session)


ImportServiceDep = Annotated[ImportService, Depends(get_import_service)]


def _upload_limit() -> str:
    return get_settings().rate_limit_upload


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enviar um arquivo para importar",
    description=(
        "Aceita OFX, CSV e planilha Excel (.xlsx) de até 10 MB. O arquivo é lido em segundo "
        "plano: acompanhe por `GET /imports/{id}`. Arquivo grande demais responde `413`; "
        "vazio ou de tipo não aceito, `415 unsupported_file`."
    ),
)
@limiter.limit(_upload_limit, key_func=user_or_ip)
async def upload_import(
    request: Request,
    current: CurrentUserDep,
    service: ImportServiceDep,
    file: UploadFile,
    account_id: Annotated[uuid.UUID, Form()],
    kind: Annotated[ImportKind, Form()] = ImportKind.STATEMENT,
) -> ImportRead:
    return await service.upload(
        current.id, file=file, filename=file.filename, account_id=account_id, kind=kind
    )


@router.get(
    "",
    summary="Ver o histórico de importações",
    description=(
        "Da importação mais nova para a mais antiga. Uma importação expirada aparece como "
        "`failed`, com `error_code` em `mapping_expired` ou `review_expired`."
    ),
)
async def list_imports(
    current: CurrentUserDep,
    service: ImportServiceDep,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> ImportPage:
    return await service.history(current.id, limit=limit, cursor=cursor)


@router.get(
    "/{import_id}",
    summary="Ver uma importação",
    description=(
        "Em `awaiting_mapping` traz `mapping_preview`, com o palpite das colunas; em "
        "`awaiting_review`, as transações propostas em `items`. Nos dois estados, `expires_at` "
        "diz até quando a importação espera. `balance_check` compara o saldo informado pelo "
        "banco com o saldo calculado da conta na mesma data."
    ),
)
async def get_import(
    import_id: uuid.UUID, current: CurrentUserDep, service: ImportServiceDep
) -> ImportRead:
    return await service.get(current.id, import_id)


@router.post(
    "/{import_id}/mapping",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Dizer quais colunas são data, descrição e valor",
    description=(
        "Guarda o modelo de colunas, que vale para os próximos arquivos com a mesma estrutura, "
        "e devolve a importação à fila. Fora de `awaiting_mapping` responde "
        "`409 import_not_awaiting_mapping`."
    ),
)
async def submit_mapping(
    import_id: uuid.UUID, body: ColumnMapping, current: CurrentUserDep, service: ImportServiceDep
) -> ImportRead:
    return await service.submit_mapping(current.id, import_id, body)


@router.post(
    "/{import_id}/confirm",
    summary="Confirmar a revisão e salvar as linhas marcadas",
    description=(
        "Recebe a decisão final de todas as linhas da revisão. As marcadas viram transações, "
        "com as correções feitas; tudo é gravado de uma vez, ou nada. Fora de "
        "`awaiting_review` responde `409 import_not_awaiting_review`."
    ),
)
async def confirm_import(
    import_id: uuid.UUID, body: ImportConfirm, current: CurrentUserDep, service: ImportServiceDep
) -> ImportRead:
    return await service.confirm(current.id, import_id, body)


@router.post(
    "/{import_id}/undo",
    summary="Desfazer uma importação confirmada",
    description=(
        "Remove, de uma vez, todas as transações que a importação criou. Fora de `completed` "
        "responde `409 import_not_completed`."
    ),
)
async def undo_import(
    import_id: uuid.UUID, current: CurrentUserDep, service: ImportServiceDep
) -> ImportRead:
    return await service.undo(current.id, import_id)


@router.delete(
    "/{import_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Descartar uma importação ainda não confirmada",
    description="Uma importação confirmada responde `409 import_already_confirmed`: use desfazer.",
)
async def discard_import(
    import_id: uuid.UUID, current: CurrentUserDep, service: ImportServiceDep
) -> None:
    await service.discard(current.id, import_id)

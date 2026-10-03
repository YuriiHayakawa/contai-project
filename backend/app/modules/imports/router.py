"""Rotas de importação. Só validam a entrada, chamam o serviço e formatam a resposta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Form, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_session
from app.core.rate_limit import limiter, user_or_ip
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.imports.mapping import ColumnMapping
from app.modules.imports.models import ImportKind
from app.modules.imports.schemas import ImportRead
from app.modules.imports.service import ImportService

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])


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
    "/{import_id}",
    summary="Ver uma importação",
    description=(
        "Em `awaiting_mapping` traz `mapping_preview`, com o palpite das colunas; em "
        "`awaiting_review`, as transações propostas em `items`. Nos dois estados, `expires_at` "
        "diz até quando a importação espera."
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

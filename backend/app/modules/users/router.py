"""Rotas do usuário sobre a própria conta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.users.schemas import (
    ChangePasswordRequest,
    RecoveryCodesRegenerateRequest,
    RecoveryCodesResponse,
    SessionRead,
    TwoFactorDisableRequest,
    TwoFactorEnableRequest,
    TwoFactorSetupResponse,
    UpdateProfileRequest,
    UserRead,
)
from app.modules.users.service import UserService

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def get_user_service(session: Annotated[AsyncSession, Depends(get_session)]) -> UserService:
    return UserService(session)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]


@router.get("/me", summary="Perfil do usuário conectado")
async def get_me(current: CurrentUserDep, service: UserServiceDep) -> UserRead:
    return await service.get_profile(current.id)


@router.patch("/me", summary="Alterar o nome")
async def update_me(
    body: UpdateProfileRequest, current: CurrentUserDep, service: UserServiceDep
) -> UserRead:
    return await service.update_name(current.id, body.name)


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Trocar a senha",
    description="Exige a senha atual e encerra as outras sessões (FR-015).",
)
async def change_password(
    body: ChangePasswordRequest, current: CurrentUserDep, service: UserServiceDep
) -> None:
    await service.change_password(
        current.id,
        current_password=body.current_password,
        new_password=body.new_password,
        current_session_id=current.session_id,
    )


@router.get("/me/sessions", summary="Dispositivos conectados (FR-014)")
async def list_sessions(current: CurrentUserDep, service: UserServiceDep) -> list[SessionRead]:
    return await service.list_sessions(current.id, current.session_id)


@router.delete(
    "/me/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Encerrar uma sessão",
)
async def end_session(
    session_id: uuid.UUID, current: CurrentUserDep, service: UserServiceDep
) -> None:
    await service.end_session(current.id, session_id)


@router.delete(
    "/me/sessions",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Encerrar todas as outras sessões",
)
async def end_other_sessions(current: CurrentUserDep, service: UserServiceDep) -> None:
    await service.end_other_sessions(current.id, current.session_id)


@router.post(
    "/me/2fa/setup",
    summary="Começar a ativação da verificação em duas etapas",
    description="Gera o segredo e o QR code; a ativação só vale depois de confirmar um código.",
)
async def setup_two_factor(
    current: CurrentUserDep, service: UserServiceDep
) -> TwoFactorSetupResponse:
    return await service.start_two_factor_setup(current.id)


@router.post(
    "/me/2fa/enable",
    summary="Ativar a verificação em duas etapas",
    description="Confirma o código e devolve os 10 códigos de recuperação, exibidos uma vez.",
)
async def enable_two_factor(
    body: TwoFactorEnableRequest, current: CurrentUserDep, service: UserServiceDep
) -> RecoveryCodesResponse:
    return await service.enable_two_factor(current.id, body.code)


@router.post(
    "/me/2fa/disable",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Desativar a verificação em duas etapas",
    description="Exige a senha e um código válido (FR-013).",
)
async def disable_two_factor(
    body: TwoFactorDisableRequest, current: CurrentUserDep, service: UserServiceDep
) -> None:
    await service.disable_two_factor(current.id, password=body.password, code=body.code)


@router.post(
    "/me/2fa/recovery-codes",
    summary="Gerar novos códigos de recuperação",
    description="Invalida os anteriores; exige a senha e um código válido (FR-011).",
)
async def regenerate_recovery_codes(
    body: RecoveryCodesRegenerateRequest, current: CurrentUserDep, service: UserServiceDep
) -> RecoveryCodesResponse:
    return await service.regenerate_recovery_codes(
        current.id, password=body.password, code=body.code
    )


@router.post(
    "/me/consents/ai-documents",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Aceitar o aviso sobre o envio de PDF e imagem",
    description=(
        "Registra que o usuário leu e aceitou o aviso: o conteúdo de PDFs e imagens é "
        "processado por um serviço de IA externo, que pode usar os dados para melhorar seus "
        "modelos. Sem o aceite, o envio de PDF ou imagem responde `403 ai_consent_required`."
    ),
)
async def accept_ai_documents(current: CurrentUserDep, service: UserServiceDep) -> None:
    await service.accept_ai_documents(current.id)

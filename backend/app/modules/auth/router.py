"""Rotas de autenticação. Só validam a entrada, chamam o serviço e formatam a resposta."""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_session
from app.core.errors import Unauthenticated
from app.core.rate_limit import client_ip, limiter
from app.modules.auth.dependencies import CurrentUserDep
from app.modules.auth.emails import SPAM_REMINDER
from app.modules.auth.errors import RefreshNotFromApp
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    TokenResponse,
    TwoFactorLoginRequest,
    TwoFactorResetCancelBody,
    TwoFactorResetConfirmBody,
    TwoFactorResetConfirmResponse,
    TwoFactorResetRequestBody,
    VerifyEmailRequest,
)
from app.modules.auth.service import SESSION_TTL, AuthService, IssuedTokens, TwoFactorChallenge

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "contai_refresh"
# O cookie só acompanha o pedido de refresh: nenhuma outra rota o recebe.
REFRESH_COOKIE_PATH = "/api/v1/auth/refresh"
CLIENT_HEADER_VALUE = "web"

REGISTERED_MESSAGE = (
    "Quase lá! Enviamos um e-mail para você. Abra o link que está nele para confirmar a conta. "
    f"{SPAM_REMINDER}"
)
RESENT_MESSAGE = (
    "Se este e-mail tiver uma conta esperando confirmação, enviamos um novo link para ele. "
    f"{SPAM_REMINDER}"
)
FORGOT_MESSAGE = (
    "Se este e-mail tiver uma conta no Contaí, enviamos um link para criar uma nova senha. "
    f"{SPAM_REMINDER}"
)
TWO_FACTOR_RESET_REQUESTED_MESSAGE = (
    "Se a verificação em duas etapas estiver ativa nesta conta, enviamos para o seu e-mail um "
    f"link para desativá-la. {SPAM_REMINDER}"
)


def get_auth_service(session: Annotated[AsyncSession, Depends(get_session)]) -> AuthService:
    return AuthService(session)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def _login_limit() -> str:
    return get_settings().rate_limit_login


def _register_limit() -> str:
    return get_settings().rate_limit_register


def _email_request_limit() -> str:
    return get_settings().rate_limit_email_requests


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    # `Secure` sempre, inclusive em desenvolvimento: os navegadores aceitam em localhost.
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=int(SESSION_TTL / timedelta(seconds=1)),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        "",
        max_age=0,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )


def _token_response(response: Response, tokens: IssuedTokens) -> TokenResponse:
    _set_refresh_cookie(response, tokens.refresh_token)
    return TokenResponse(access_token=tokens.access_token)


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Criar conta",
    description="Responde igual para um e-mail novo e para um já cadastrado.",
)
@limiter.limit(_register_limit)
async def register(
    request: Request, body: RegisterRequest, service: AuthServiceDep
) -> MessageResponse:
    await service.register(
        name=body.name,
        email=body.email,
        password=body.password,
        accept_privacy_policy=body.accept_privacy_policy,
    )
    return MessageResponse(message=REGISTERED_MESSAGE)


@router.post(
    "/verify-email",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Confirmar o e-mail com o token do link",
)
async def verify_email(body: VerifyEmailRequest, service: AuthServiceDep) -> None:
    await service.verify_email(body.token)


@router.post(
    "/resend-verification",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Reenviar o link de confirmação",
)
@limiter.limit(_email_request_limit)
async def resend_verification(
    request: Request, body: ResendVerificationRequest, service: AuthServiceDep
) -> MessageResponse:
    await service.resend_verification(body.email)
    return MessageResponse(message=RESENT_MESSAGE)


@router.post(
    "/login",
    summary="Entrar com e-mail e senha",
    description=(
        "Devolve o access token e grava o refresh token em um cookie `httpOnly`. Com a "
        "verificação em duas etapas ativa, devolve `two_factor_required` e um `challenge_token`."
    ),
)
@limiter.limit(_login_limit)
async def login(
    request: Request, response: Response, body: LoginRequest, service: AuthServiceDep
) -> LoginResponse:
    outcome = await service.login(
        email=body.email,
        password=body.password,
        user_agent=request.headers.get("user-agent", ""),
        ip=client_ip(request),
    )
    if isinstance(outcome, TwoFactorChallenge):
        return LoginResponse(two_factor_required=True, challenge_token=outcome.challenge_token)
    _set_refresh_cookie(response, outcome.refresh_token)
    return LoginResponse(access_token=outcome.access_token, token_type="bearer")  # noqa: S106


@router.post(
    "/login/2fa",
    summary="Concluir a entrada com o código da segunda etapa",
    description="Aceita um código do app autenticador ou um código de recuperação.",
)
@limiter.limit(_login_limit)
async def login_two_factor(
    request: Request, response: Response, body: TwoFactorLoginRequest, service: AuthServiceDep
) -> TokenResponse:
    tokens = await service.complete_two_factor_login(
        challenge_token=body.challenge_token,
        code=body.code,
        recovery_code=body.recovery_code,
        user_agent=request.headers.get("user-agent", ""),
        ip=client_ip(request),
    )
    return _token_response(response, tokens)


@router.post(
    "/refresh",
    summary="Renovar o access token com o cookie de refresh",
    description=(
        "Exige o cabeçalho `X-Contai-Client: web` e a origem do próprio app (proteção contra "
        "CSRF). O cookie é enviado pelo navegador e trocado a cada uso."
    ),
)
async def refresh(
    request: Request,
    response: Response,
    service: AuthServiceDep,
    x_contai_client: Annotated[str | None, Header()] = None,
) -> TokenResponse:
    app_origin = get_settings().app_origin.rstrip("/")
    if x_contai_client != CLIENT_HEADER_VALUE or request.headers.get("origin") != app_origin:
        raise RefreshNotFromApp()
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise Unauthenticated()
    tokens = await service.refresh(refresh_token=refresh_token, ip=client_ip(request))
    return _token_response(response, tokens)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sair da conta neste dispositivo",
)
async def logout(response: Response, current: CurrentUserDep, service: AuthServiceDep) -> None:
    await service.logout(current.id, current.session_id)
    _clear_refresh_cookie(response)


@router.post(
    "/password/forgot",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Pedir o link para criar uma nova senha",
    description="Responde igual exista ou não uma conta com o e-mail.",
)
@limiter.limit(_email_request_limit)
async def forgot_password(
    request: Request, body: ForgotPasswordRequest, service: AuthServiceDep
) -> MessageResponse:
    await service.request_password_reset(body.email)
    return MessageResponse(message=FORGOT_MESSAGE)


@router.post(
    "/password/reset",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Criar uma nova senha com o token do link",
    description="Encerra todas as sessões da conta.",
)
async def reset_password(body: ResetPasswordRequest, service: AuthServiceDep) -> None:
    await service.reset_password(token=body.token, new_password=body.new_password)


@router.post(
    "/2fa/reset/request",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Pedir, por e-mail, a desativação da verificação em duas etapas",
    description="Para quem perdeu o app e os códigos. Exige o desafio da etapa da senha.",
)
@limiter.limit(_email_request_limit)
async def request_two_factor_reset(
    request: Request, body: TwoFactorResetRequestBody, service: AuthServiceDep
) -> MessageResponse:
    await service.request_two_factor_reset(body.challenge_token)
    return MessageResponse(message=TWO_FACTOR_RESET_REQUESTED_MESSAGE)


@router.post(
    "/2fa/reset/confirm",
    summary="Abrir a contagem de 72 horas para a desativação",
    description="Confirma o pedido pelo link do e-mail e devolve quando a desativação vale.",
)
async def confirm_two_factor_reset(
    body: TwoFactorResetConfirmBody, service: AuthServiceDep
) -> TwoFactorResetConfirmResponse:
    effective_at = await service.confirm_two_factor_reset(body.token)
    return TwoFactorResetConfirmResponse(effective_at=effective_at)


@router.post(
    "/2fa/reset/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancelar o pedido de desativação pelo link do e-mail",
)
async def cancel_two_factor_reset(body: TwoFactorResetCancelBody, service: AuthServiceDep) -> None:
    await service.cancel_two_factor_reset(body.token)

"""Dependência de autenticação usada por todas as rotas protegidas."""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.database import get_session
from app.core.errors import Forbidden, Unauthenticated
from app.core.security import decode_access_token
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import UserStatus
from app.modules.users.repository import UserRepository

_bearer = HTTPBearer(auto_error=False)

# Únicas rotas liberadas para uma conta com exclusão pedida: ver o perfil e cancelar a exclusão.
PENDING_DELETION_ALLOWED_ROUTES = frozenset(
    {
        ("GET", "/api/v1/users/me"),
        ("DELETE", "/api/v1/users/me/deletion"),
    }
)

EMAIL_NOT_VERIFIED_MESSAGE = "Confirme seu e-mail para continuar. Enviamos um link para você."
PENDING_DELETION_MESSAGE = (
    "Esta conta está com a exclusão agendada. Para voltar a usá-la, cancele a exclusão."
)


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    session_id: uuid.UUID


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrentUser:
    """Valida o access token e confere, a cada requisição, a sessão e a situação da conta."""
    if credentials is None:
        raise Unauthenticated()
    claims = decode_access_token(credentials.credentials)

    auth_session = await AuthRepository(session).get_session(claims.user_id, claims.session_id)
    if (
        auth_session is None
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= clock.utcnow()
    ):
        raise Unauthenticated()

    user = await UserRepository(session).get_by_id(claims.user_id)
    if user is None:
        raise Unauthenticated()
    if user.email_verified_at is None:
        raise Forbidden(EMAIL_NOT_VERIFIED_MESSAGE, code="email_not_verified")
    if user.status == UserStatus.PENDING_DELETION:
        route = request.scope.get("route")
        if (request.method, getattr(route, "path", None)) not in PENDING_DELETION_ALLOWED_ROUTES:
            raise Forbidden(PENDING_DELETION_MESSAGE, code="account_pending_deletion")

    request.state.user_id = user.id
    return CurrentUser(id=user.id, session_id=auth_session.id)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]

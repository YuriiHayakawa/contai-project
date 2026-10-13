"""Schemas de entrada e saída do usuário (contracts/rest-api.md)."""

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, StringConstraints

from app.core.security import MAX_PASSWORD_LENGTH
from app.modules.auth.models import Session
from app.modules.users.devices import device_label
from app.modules.users.models import User, UserStatus

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Password = Annotated[str, StringConstraints(max_length=MAX_PASSWORD_LENGTH * 8)]
TwoFactorCode = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


class UserRead(BaseModel):
    """Perfil devolvido por `GET /users/me`. Nunca inclui hash, segredo nem contadores."""

    name: str
    email: str
    status: UserStatus
    two_factor_enabled: bool
    ai_documents_consent: bool
    deletion_scheduled_at: datetime | None

    @classmethod
    def from_user(cls, user: User) -> Self:
        return cls(
            name=user.name,
            email=user.email,
            status=UserStatus(user.status),
            two_factor_enabled=user.totp_enabled_at is not None,
            ai_documents_consent=user.ai_documents_consent_at is not None,
            deletion_scheduled_at=user.deletion_scheduled_at,
        )


class UpdateProfileRequest(BaseModel):
    name: Name


class ChangePasswordRequest(BaseModel):
    current_password: Password
    new_password: Password


class SessionRead(BaseModel):
    """Uma sessão ativa na tela de dispositivos conectados (FR-014)."""

    id: uuid.UUID
    device: str
    last_used_at: datetime
    is_current: bool

    @classmethod
    def from_session(cls, session: Session, *, is_current: bool) -> Self:
        return cls(
            id=session.id,
            device=device_label(session.user_agent),
            last_used_at=session.last_used_at,
            is_current=is_current,
        )


class TwoFactorSetupResponse(BaseModel):
    """Começo da ativação: o segredo em texto e o `otpauth://` que o QR code representa."""

    otpauth_uri: str
    secret: str


class TwoFactorEnableRequest(BaseModel):
    code: TwoFactorCode


class TwoFactorDisableRequest(BaseModel):
    password: Password
    code: TwoFactorCode


class RecoveryCodesRegenerateRequest(BaseModel):
    password: Password
    code: TwoFactorCode


class RecoveryCodesResponse(BaseModel):
    """Os 10 códigos de recuperação, exibidos uma única vez (FR-011)."""

    recovery_codes: list[str]

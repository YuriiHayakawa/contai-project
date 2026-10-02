"""Schemas de saída do usuário."""

from datetime import datetime
from typing import Self

from pydantic import BaseModel

from app.modules.users.models import User, UserStatus


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

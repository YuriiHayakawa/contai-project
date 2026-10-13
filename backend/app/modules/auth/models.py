"""Modelos de autenticação: sessões, tokens enviados por e-mail e tentativas de login."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAt, UUIDPrimaryKey


class SessionRevokedReason(StrEnum):
    LOGOUT = "logout"
    USER_REVOKED = "user_revoked"
    PASSWORD_CHANGED = "password_changed"  # noqa: S105 - motivo, não é senha
    PASSWORD_RESET = "password_reset"  # noqa: S105 - motivo, não é senha
    TOKEN_REUSE = "token_reuse"  # noqa: S105 - motivo, não é token
    TWO_FACTOR_RESET = "two_factor_reset"
    ACCOUNT_DELETION = "account_deletion"


class EmailTokenType(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"  # noqa: S105 - tipo de token, não é senha
    TWO_FACTOR_RESET_CONFIRM = "two_factor_reset_confirm"
    TWO_FACTOR_RESET_CANCEL = "two_factor_reset_cancel"


def _in_list(column: str, values: type[StrEnum]) -> str:
    return f"{column} IN ({', '.join(repr(item.value) for item in values)})"


class Session(UUIDPrimaryKey, CreatedAt, Base):
    """Um dispositivo conectado; é também a família de rotação do refresh token."""

    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint(
            f"revoked_reason IS NULL OR {_in_list('revoked_reason', SessionRevokedReason)}",
            name="revoked_reason_valid",
        ),
        Index("ix_sessions_user_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    refresh_token_hash: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str] = mapped_column(String(255), server_default="")
    ip: Mapped[str] = mapped_column(String(45), server_default="")
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[SessionRevokedReason | None] = mapped_column(String(30))


class EmailToken(UUIDPrimaryKey, CreatedAt, Base):
    """Token de uso único enviado por e-mail. O banco guarda só o hash."""

    __tablename__ = "email_tokens"
    __table_args__ = (
        CheckConstraint(_in_list("type", EmailTokenType), name="type_valid"),
        Index("ix_email_tokens_user_id_type", "user_id", "type"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[EmailTokenType] = mapped_column(String(30))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RecoveryCode(UUIDPrimaryKey, CreatedAt, Base):
    """Código de recuperação da verificação em duas etapas. São sempre 10 por usuário."""

    __tablename__ = "recovery_codes"
    __table_args__ = (Index("ix_recovery_codes_user_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    code_hash: Mapped[str] = mapped_column(String(64))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TwoFactorResetRequest(UUIDPrimaryKey, CreatedAt, Base):
    """Pedido para desativar a verificação em duas etapas de quem perdeu o celular e os códigos.

    Só vale 72 horas depois do pedido; nesse prazo pode ser cancelado pelo link enviado por
    e-mail ou por uma entrada com código válido. No máximo um pedido em aberto por usuário.
    """

    __tablename__ = "two_factor_reset_requests"
    __table_args__ = (
        # No máximo um pedido em aberto (nem cancelado nem aplicado) por usuário.
        Index(
            "uq_two_factor_reset_open_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("cancelled_at IS NULL AND applied_at IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LoginAttempt(Base):
    """Erros seguidos de login para um e-mail informado, exista ou não uma conta com ele.

    Não tem `user_id` de propósito: contar igual para qualquer e-mail é o que impede o bloqueio
    de revelar quais e-mails estão cadastrados (FR-008). A chave é o SHA-256 do e-mail
    normalizado, para o banco não guardar endereços de quem não é usuário.
    """

    __tablename__ = "login_attempts"
    __table_args__ = (
        CheckConstraint("failed_count >= 0", name="failed_count_not_negative"),
        Index("ix_login_attempts_last_failed_at", "last_failed_at"),
    )

    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    failed_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

"""Entradas e saídas das rotas de Auth (contracts/rest-api.md)."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Literal, Self

from pydantic import BaseModel, StringConstraints, model_validator

from app.core.security import MAX_PASSWORD_LENGTH

if TYPE_CHECKING:
    from app.modules.auth.personal_tokens import PersonalTokenView

# Conferência de formato, sem dependência extra: algo antes do @, um domínio com ponto e
# nenhum espaço. Se o endereço existe de verdade, quem diz é o link de confirmação.
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# A política de senha é aplicada no serviço, que explica como corrigir. Aqui só há um teto,
# folgado, para uma senha absurda não chegar ao hash.
Password = Annotated[str, StringConstraints(max_length=MAX_PASSWORD_LENGTH * 8)]
EmailLinkToken = Annotated[str, StringConstraints(min_length=1, max_length=200)]
# Código do app autenticador (6 dígitos) ou de recuperação; validado de verdade no serviço.
TwoFactorCode = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]
ChallengeToken = Annotated[str, StringConstraints(min_length=1, max_length=500)]


class RegisterRequest(BaseModel):
    name: Name
    email: Email
    password: Password
    # Sem valor padrão verdadeiro: quem não envia o aceite não aceitou.
    accept_privacy_policy: bool = False


class VerifyEmailRequest(BaseModel):
    token: EmailLinkToken


class ResendVerificationRequest(BaseModel):
    email: Email


class LoginRequest(BaseModel):
    # Sem conferência de formato: um e-mail malformado recebe o mesmo 401 de um inexistente.
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254)]
    password: Password


class ForgotPasswordRequest(BaseModel):
    email: Email


class ResetPasswordRequest(BaseModel):
    token: EmailLinkToken
    new_password: Password


class TokenResponse(BaseModel):
    """O access token vai no corpo; o refresh token, só no cookie `httpOnly`."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - tipo do token, não é segredo


class LoginResponse(BaseModel):
    """Login: ou as credenciais, ou o desafio da segunda etapa (FR-012).

    Com a verificação em duas etapas ativa, a senha correta devolve `two_factor_required` e um
    `challenge_token`, sem access token nem cookie de refresh.
    """

    access_token: str | None = None
    token_type: Literal["bearer"] | None = None
    two_factor_required: bool = False
    challenge_token: str | None = None


class MobileTokenResponse(BaseModel):
    """Credenciais do app: o refresh token vai no corpo, e o app o guarda no Keychain."""

    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - tipo do token, não é segredo


class MobileLoginResponse(BaseModel):
    """Login do app: ou as credenciais, ou o desafio da segunda etapa, como no site."""

    access_token: str | None = None
    refresh_token: str | None = None
    token_type: Literal["bearer"] | None = None
    two_factor_required: bool = False
    challenge_token: str | None = None


class MobileRefreshRequest(BaseModel):
    refresh_token: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class TwoFactorLoginRequest(BaseModel):
    """Segunda etapa do login: o desafio e um código do app ou um de recuperação."""

    challenge_token: ChallengeToken
    code: TwoFactorCode | None = None
    recovery_code: TwoFactorCode | None = None

    @model_validator(mode="after")
    def _exactly_one_code(self) -> Self:
        if bool(self.code) == bool(self.recovery_code):
            raise ValueError("informe um código do aplicativo ou um código de recuperação")
        return self


class TwoFactorResetRequestBody(BaseModel):
    challenge_token: ChallengeToken


class TwoFactorResetConfirmBody(BaseModel):
    token: EmailLinkToken


class TwoFactorResetConfirmResponse(BaseModel):
    effective_at: datetime


class TwoFactorResetCancelBody(BaseModel):
    token: EmailLinkToken


class MessageResponse(BaseModel):
    """Resposta genérica dos pedidos que não revelam se um e-mail tem conta (FR-008)."""

    message: str


# ---------- tokens pessoais da Siri (ADR 0012)

PersonalTokenName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]


class PersonalTokenCreate(BaseModel):
    name: PersonalTokenName
    default_account_id: uuid.UUID


class PersonalTokenUpdate(BaseModel):
    default_account_id: uuid.UUID


class AccountRef(BaseModel):
    id: uuid.UUID
    name: str


class PersonalTokenRead(BaseModel):
    """Um token ativo, sem o segredo nem o hash."""

    id: uuid.UUID
    name: str
    default_account: AccountRef | None
    # A conta padrão foi arquivada ou apagada: a Siri não lança frases sem conta citada.
    needs_default_account: bool
    created_at: datetime
    last_used_at: datetime | None

    @classmethod
    def from_view(cls, view: "PersonalTokenView") -> Self:
        account = view.default_account
        return cls(
            id=view.token.id,
            name=view.token.name,
            default_account=AccountRef(id=account.id, name=account.name) if account else None,
            needs_default_account=view.needs_default_account,
            created_at=view.token.created_at,
            last_used_at=view.token.last_used_at,
        )


class PersonalTokenCreated(PersonalTokenRead):
    """A criação: a única resposta que traz o token completo."""

    token: str


class PersonalTokenList(BaseModel):
    items: list[PersonalTokenRead]

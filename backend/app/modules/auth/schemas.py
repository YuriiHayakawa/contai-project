"""Entradas e saídas das rotas de Auth (contracts/rest-api.md)."""

from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

from app.core.security import MAX_PASSWORD_LENGTH

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


class MessageResponse(BaseModel):
    """Resposta genérica dos pedidos que não revelam se um e-mail tem conta (FR-008)."""

    message: str

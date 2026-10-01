"""Primitivas de segurança: senhas, tokens aleatórios e tokens JWT.

A lista de senhas comuns em `data/common_passwords.txt` vem da coleção pública SecLists
("10k-most-common", só as entradas com 8 caracteres ou mais), acrescida de senhas comuns em
português.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core import clock
from app.core.config import get_settings
from app.core.errors import Unauthenticated, ValidationFailed

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
ACCESS_TOKEN_TTL = timedelta(minutes=15)
CHALLENGE_TOKEN_TTL = timedelta(minutes=5)

_JWT_ALGORITHM = "HS256"
_ACCESS_TOKEN_TYPE = "access"  # noqa: S105 - nome de tipo, não é segredo
_CHALLENGE_TOKEN_TYPE = "2fa_challenge"  # noqa: S105 - nome de tipo, não é segredo
_COMMON_PASSWORDS_FILE = Path(__file__).parent / "data" / "common_passwords.txt"

_hasher = PasswordHasher()


# ---------- senhas


class WeakPassword(ValidationFailed):
    code = "weak_password"

    def __init__(self, message: str) -> None:
        super().__init__(message, details={"fields": {"password": message}})


@lru_cache
def _common_passwords() -> frozenset[str]:
    lines = _COMMON_PASSWORDS_FILE.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip())


def validate_password(password: str) -> None:
    """Aplica a política de senha; levanta `WeakPassword` dizendo como corrigir."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword(f"Use uma senha com pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise WeakPassword(f"Use uma senha com no máximo {MAX_PASSWORD_LENGTH} caracteres.")
    if password.strip().lower() in _common_passwords():
        raise WeakPassword(
            "Essa senha é muito comum e fácil de adivinhar. Escolha outra, de preferência "
            "uma frase que só você conheça."
        )


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError, UnicodeEncodeError):
        # Senha errada ou hash que não é um hash Argon2 válido: nos dois casos, não confere.
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# ---------- tokens aleatórios (links de e-mail, refresh)


def new_token() -> str:
    """Token aleatório de 32 bytes, seguro para URL."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 do token. O banco guarda só o hash."""
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- JWT


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID


def _encode(claims: dict[str, Any], ttl: timedelta) -> str:
    issued_at = clock.utcnow()
    payload = {
        **claims,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + ttl).timestamp()),
    }
    return jwt.encode(
        payload, get_settings().jwt_secret.get_secret_value(), algorithm=_JWT_ALGORITHM
    )


def _decode(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            get_settings().jwt_secret.get_secret_value(),
            algorithms=[_JWT_ALGORITHM],
            # A validade é conferida abaixo, contra o relógio da aplicação.
            options={"verify_exp": False, "require": ["exp", "sub", "typ"]},
        )
    except jwt.InvalidTokenError as exc:
        raise Unauthenticated() from exc
    if payload["typ"] != expected_type or payload["exp"] <= clock.utcnow().timestamp():
        raise Unauthenticated()
    return payload


def _to_uuid(value: object) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise Unauthenticated() from exc


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return _encode(
        {"sub": str(user_id), "sid": str(session_id), "typ": _ACCESS_TOKEN_TYPE},
        ACCESS_TOKEN_TTL,
    )


def decode_access_token(token: str) -> AccessTokenClaims:
    payload = _decode(token, _ACCESS_TOKEN_TYPE)
    return AccessTokenClaims(
        user_id=_to_uuid(payload["sub"]), session_id=_to_uuid(payload.get("sid"))
    )


def create_challenge_token(user_id: uuid.UUID) -> str:
    """Token curto entre a etapa da senha e a etapa do código de verificação."""
    return _encode({"sub": str(user_id), "typ": _CHALLENGE_TOKEN_TYPE}, CHALLENGE_TOKEN_TTL)


def decode_challenge_token(token: str) -> uuid.UUID:
    return _to_uuid(_decode(token, _CHALLENGE_TOKEN_TYPE)["sub"])

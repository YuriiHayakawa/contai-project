"""Primitivas de segurança: senhas, tokens aleatórios e tokens JWT.

A lista de senhas comuns em `data/common_passwords.txt` vem da coleção pública SecLists
("10k-most-common", só as entradas com 8 caracteres ou mais), acrescida de senhas comuns em
português.
"""

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken

from app.core import clock
from app.core.config import get_settings
from app.core.errors import Unauthenticated, ValidationFailed

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
ACCESS_TOKEN_TTL = timedelta(minutes=15)
CHALLENGE_TOKEN_TTL = timedelta(minutes=5)

# Verificação em duas etapas (TOTP).
TOTP_ISSUER = "Contaí"
TOTP_STEP_SECONDS = 30
# Aceita o passo atual e um de folga para cada lado, cobrindo um relógio um pouco adiantado ou
# atrasado no celular.
TOTP_VALID_WINDOW = 1
RECOVERY_CODE_COUNT = 10
# Alfabeto dos códigos de recuperação, sem os caracteres que se confundem ao copiar à mão.
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_RECOVERY_GROUP = 5

_JWT_ALGORITHM = "HS256"
_ACCESS_TOKEN_TYPE = "access"  # noqa: S105 - nome de tipo, não é segredo
_CHALLENGE_TOKEN_TYPE = "2fa_challenge"  # noqa: S105 - nome de tipo, não é segredo
_COMMON_PASSWORDS_FILE = Path(__file__).parent / "data" / "common_passwords.txt"

_hasher = PasswordHasher()


# ---------- senhas


class WeakPassword(ValidationFailed):
    code = "weak_password"

    def __init__(self, message: str, field: str = "password") -> None:
        super().__init__(message, details={"fields": {field: message}})


@lru_cache
def _common_passwords() -> frozenset[str]:
    lines = _COMMON_PASSWORDS_FILE.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip())


def validate_password(password: str, field: str = "password") -> None:
    """Aplica a política de senha; levanta `WeakPassword` dizendo como corrigir.

    `field` é o nome do campo da requisição, para a mensagem aparecer junto dele.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPassword(f"Use uma senha com pelo menos {MIN_PASSWORD_LENGTH} caracteres.", field)
    if len(password) > MAX_PASSWORD_LENGTH:
        raise WeakPassword(f"Use uma senha com no máximo {MAX_PASSWORD_LENGTH} caracteres.", field)
    if password.strip().lower() in _common_passwords():
        raise WeakPassword(
            "Essa senha é muito comum e fácil de adivinhar. Escolha outra, de preferência "
            "uma frase que só você conheça.",
            field,
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
            # O tempo é conferido abaixo, contra o relógio da aplicação, e não contra o do
            # sistema: nem a validade nem a hora de emissão são julgadas pela biblioteca.
            options={"verify_exp": False, "verify_iat": False, "require": ["exp", "sub", "typ"]},
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


# ---------- verificação em duas etapas (TOTP)


# Derivada e estável, para desenvolvimento e testes, quando TOTP_ENCRYPTION_KEY vem vazia; em
# produção a configuração exige uma chave de verdade (Fernet.generate_key()).
_DEV_TOTP_KEY = base64.urlsafe_b64encode(hashlib.sha256(b"contai-development-totp-key").digest())


def _totp_cipher() -> Fernet:
    key = get_settings().totp_encryption_key.get_secret_value()
    return Fernet(key.encode() if key else _DEV_TOTP_KEY)


def generate_totp_secret() -> str:
    """Segredo base32 novo, compartilhado com o app autenticador."""
    return pyotp.random_base32()


def encrypt_totp_secret(secret: str) -> str:
    """Cifra o segredo para guardá-lo; o banco nunca vê o segredo em claro."""
    return _totp_cipher().encrypt(secret.encode()).decode()


def decrypt_totp_secret(encrypted: str) -> str:
    try:
        return _totp_cipher().decrypt(encrypted.encode()).decode()
    except InvalidToken as exc:
        # Chave trocada ou dado corrompido: trata como segredo inexistente, sem derrubar o app.
        raise Unauthenticated() from exc


def totp_provisioning_uri(secret: str, account_email: str) -> str:
    """`otpauth://` que o QR code representa, com o emissor e a conta."""
    return pyotp.TOTP(secret).provisioning_uri(name=account_email, issuer_name=TOTP_ISSUER)


def verify_totp(
    secret: str, code: str, *, last_used_step: int | None, now: datetime | None = None
) -> int | None:
    """Confere um código do app. Devolve o passo aceito, ou `None` se não confere.

    Aceita o passo atual e um de folga para cada lado (relógio levemente adiantado ou atrasado).
    Um código de um passo já usado (ou anterior ao último usado) é recusado, para o mesmo código
    não valer duas vezes.
    """
    code = code.strip()
    if not code.isdigit():
        return None
    totp = pyotp.TOTP(secret)
    reference = (now or clock.utcnow()).timestamp()
    current_step = int(reference // TOTP_STEP_SECONDS)
    for offset in range(-TOTP_VALID_WINDOW, TOTP_VALID_WINDOW + 1):
        step = current_step + offset
        at = datetime.fromtimestamp(step * TOTP_STEP_SECONDS, tz=UTC)
        if totp.verify(code, for_time=at, valid_window=0):
            if last_used_step is not None and step <= last_used_step:
                return None
            return step
    return None


# ---------- códigos de recuperação


def _format_recovery_code() -> str:
    raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP * 2))
    return f"{raw[:_RECOVERY_GROUP]}-{raw[_RECOVERY_GROUP:]}"


def generate_recovery_codes() -> list[str]:
    """Dez códigos de recuperação de uso único, no formato `abcde-fghij`."""
    return [_format_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]


def normalize_recovery_code(code: str) -> str:
    """Ignora maiúsculas, espaços e hífens, para o usuário poder digitar do jeito que preferir."""
    return "".join(char for char in code.lower() if char.isalnum())


def hash_recovery_code(code: str) -> str:
    return hash_token(normalize_recovery_code(code))

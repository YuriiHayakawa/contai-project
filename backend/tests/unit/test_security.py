import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core import clock, security
from app.core.config import get_settings
from app.core.errors import Unauthenticated

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _fixed_clock() -> Iterator[None]:
    clock.set_fixed_time(NOW)
    yield
    clock.set_fixed_time(None)


# ---------- política de senha


@pytest.mark.parametrize("password", ["uma frase só minha", "Xk9#mPq2vL", "12345678x!"])
def test_valid_passwords_are_accepted(password: str) -> None:
    security.validate_password(password)


def test_short_password_is_rejected_with_guidance() -> None:
    with pytest.raises(security.WeakPassword) as error:
        security.validate_password("abc1234")

    assert error.value.code == "weak_password"
    assert error.value.status_code == 422
    assert "pelo menos 8" in error.value.message
    assert error.value.details["fields"]["password"] == error.value.message


@pytest.mark.parametrize(
    "password", ["password", "12345678", "senha123", "SENHA123", " qwertyuiop "]
)
def test_common_passwords_are_rejected(password: str) -> None:
    with pytest.raises(security.WeakPassword) as error:
        security.validate_password(password)

    assert "comum" in error.value.message


def test_too_long_password_is_rejected() -> None:
    with pytest.raises(security.WeakPassword):
        security.validate_password("a" * 129)


# ---------- hash de senha


def test_password_hash_uses_argon2id_and_verifies() -> None:
    password_hash = security.hash_password("uma frase só minha")

    assert password_hash.startswith("$argon2id$")
    assert security.verify_password(password_hash, "uma frase só minha") is True
    assert security.verify_password(password_hash, "outra frase") is False
    assert security.password_needs_rehash(password_hash) is False


def test_same_password_gets_different_hashes() -> None:
    assert security.hash_password("uma frase só minha") != security.hash_password(
        "uma frase só minha"
    )


def test_verify_password_with_invalid_hash_returns_false() -> None:
    assert security.verify_password("não é um hash", "qualquer") is False


# ---------- tokens aleatórios


def test_new_token_is_long_random_and_url_safe() -> None:
    first, second = security.new_token(), security.new_token()

    assert first != second
    assert len(first) >= 43
    assert all(char.isalnum() or char in "-_" for char in first)


def test_hash_token_is_sha256_and_deterministic() -> None:
    token = security.new_token()

    assert security.hash_token(token) == security.hash_token(token)
    assert len(security.hash_token(token)) == 64
    assert security.hash_token(token) != token


# ---------- access token


def test_access_token_round_trip() -> None:
    user_id, session_id = uuid.uuid4(), uuid.uuid4()

    claims = security.decode_access_token(security.create_access_token(user_id, session_id))

    assert claims.user_id == user_id
    assert claims.session_id == session_id


def test_access_token_expires_after_15_minutes() -> None:
    token = security.create_access_token(uuid.uuid4(), uuid.uuid4())

    clock.set_fixed_time(NOW + timedelta(minutes=14, seconds=59))
    security.decode_access_token(token)

    clock.set_fixed_time(NOW + timedelta(minutes=15))
    with pytest.raises(Unauthenticated):
        security.decode_access_token(token)


def test_access_token_with_wrong_signature_is_rejected() -> None:
    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "sid": str(uuid.uuid4()), "typ": "access", "exp": 9999999999},
        "outro-segredo-qualquer-com-tamanho-suficiente",
        algorithm="HS256",
    )

    with pytest.raises(Unauthenticated):
        security.decode_access_token(forged)


def test_unsigned_token_is_rejected() -> None:
    unsigned = jwt.encode(
        {"sub": str(uuid.uuid4()), "sid": str(uuid.uuid4()), "typ": "access", "exp": 9999999999},
        key="",
        algorithm="none",
    )

    with pytest.raises(Unauthenticated):
        security.decode_access_token(unsigned)


@pytest.mark.parametrize("token", ["", "abc", "a.b.c"])
def test_malformed_token_is_rejected(token: str) -> None:
    with pytest.raises(Unauthenticated):
        security.decode_access_token(token)


def test_token_without_valid_ids_is_rejected() -> None:
    secret = get_settings().jwt_secret.get_secret_value()
    token = jwt.encode(
        {"sub": "não-é-uuid", "sid": "x", "typ": "access", "exp": 9999999999},
        secret,
        algorithm="HS256",
    )

    with pytest.raises(Unauthenticated):
        security.decode_access_token(token)


# ---------- challenge token (duas etapas)


def test_challenge_token_round_trip_and_expiry() -> None:
    user_id = uuid.uuid4()
    token = security.create_challenge_token(user_id)

    assert security.decode_challenge_token(token) == user_id

    clock.set_fixed_time(NOW + timedelta(minutes=5))
    with pytest.raises(Unauthenticated):
        security.decode_challenge_token(token)


def test_token_types_are_not_interchangeable() -> None:
    user_id, session_id = uuid.uuid4(), uuid.uuid4()

    with pytest.raises(Unauthenticated):
        security.decode_access_token(security.create_challenge_token(user_id))
    with pytest.raises(Unauthenticated):
        security.decode_challenge_token(security.create_access_token(user_id, session_id))

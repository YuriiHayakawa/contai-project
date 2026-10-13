"""Verificação em duas etapas, no nível das primitivas (T187).

Confere a tolerância de um passo, a recusa de reuso, a cifra do segredo e os códigos de
recuperação.
"""

from datetime import UTC, datetime, timedelta

import pyotp
import pytest

from app.core.security import (
    RECOVERY_CODE_COUNT,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_recovery_code,
    normalize_recovery_code,
    verify_totp,
)

NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)


def code_at(secret: str, moment: datetime) -> str:
    return pyotp.TOTP(secret).at(moment)


def test_accepts_the_current_step() -> None:
    secret = generate_totp_secret()
    step = verify_totp(secret, code_at(secret, NOW), last_used_step=None, now=NOW)
    assert step == int(NOW.timestamp() // 30)


def test_accepts_one_step_of_tolerance_on_each_side() -> None:
    secret = generate_totp_secret()
    before = code_at(secret, NOW - timedelta(seconds=30))
    after = code_at(secret, NOW + timedelta(seconds=30))

    assert verify_totp(secret, before, last_used_step=None, now=NOW) is not None
    assert verify_totp(secret, after, last_used_step=None, now=NOW) is not None


def test_rejects_a_code_two_steps_away() -> None:
    secret = generate_totp_secret()
    far = code_at(secret, NOW - timedelta(seconds=90))
    assert verify_totp(secret, far, last_used_step=None, now=NOW) is None


def test_rejects_a_non_numeric_code() -> None:
    assert verify_totp(generate_totp_secret(), "abc123", last_used_step=None, now=NOW) is None


def test_rejects_reusing_the_same_or_an_earlier_step() -> None:
    secret = generate_totp_secret()
    step = verify_totp(secret, code_at(secret, NOW), last_used_step=None, now=NOW)
    assert step is not None
    # O mesmo passo já usado não vale de novo.
    assert verify_totp(secret, code_at(secret, NOW), last_used_step=step, now=NOW) is None
    # Um passo anterior também não.
    earlier = code_at(secret, NOW - timedelta(seconds=30))
    assert verify_totp(secret, earlier, last_used_step=step, now=NOW) is None


def test_encrypts_and_decrypts_the_secret() -> None:
    secret = generate_totp_secret()
    encrypted = encrypt_totp_secret(secret)
    assert encrypted != secret
    assert decrypt_totp_secret(encrypted) == secret


def test_generates_ten_distinct_recovery_codes() -> None:
    codes = generate_recovery_codes()
    assert len(codes) == RECOVERY_CODE_COUNT
    assert len(set(codes)) == RECOVERY_CODE_COUNT
    assert all("-" in code for code in codes)


@pytest.mark.parametrize("typed", ["ABCDE-FGHIJ", "abcde fghij", "abcdefghij"])
def test_recovery_code_matching_ignores_case_spaces_and_hyphens(typed: str) -> None:
    canonical = "abcde-fghij"
    assert normalize_recovery_code(typed) == normalize_recovery_code(canonical)
    assert hash_recovery_code(typed) == hash_recovery_code(canonical)

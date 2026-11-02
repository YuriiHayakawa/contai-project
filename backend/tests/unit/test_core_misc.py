"""Configurações, logs e modelos de e-mail."""

import json
import logging
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import JWT_SECRET_PLACEHOLDER, Settings
from app.core.logging import JsonFormatter
from app.email.templates import render

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "email_templates"

BASE = {
    "database_url": "postgresql+asyncpg://u:p@db/contai",
    "app_origin": "https://contai.example",
    "jwt_secret": "x" * 64,
    "totp_encryption_key": "chave",
    "proxy_shared_secret": "p" * 64,
    "scheduler_token": "t" * 64,
    "smtp_host": "smtp.example",
    "email_from": "Contaí <nao-responda@contai.example>",
}


def _settings(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


# ---------- configurações


def test_secrets_are_not_shown_when_settings_are_printed() -> None:
    settings = _settings(jwt_secret="segredo-que-nao-pode-vazar-de-jeito-nenhum")

    assert "segredo-que-nao-pode-vazar" not in repr(settings)
    assert "segredo-que-nao-pode-vazar" not in str(settings.model_dump())


def test_cors_origins_are_parsed_from_a_comma_separated_list() -> None:
    assert _settings().cors_origins == []
    assert _settings(
        cors_allowed_origins=" https://a.example, https://b.example ,"
    ).cors_origins == [
        "https://a.example",
        "https://b.example",
    ]


@pytest.mark.parametrize(
    "overrides",
    [
        {"jwt_secret": JWT_SECRET_PLACEHOLDER},
        {"jwt_secret": "curto"},
        {"totp_encryption_key": ""},
        {"proxy_shared_secret": ""},
        {"proxy_shared_secret": "curto"},
        {"scheduler_token": ""},
        {"scheduler_token": "curto"},
        {"ai_provider": "gemini", "ai_api_key": ""},
    ],
)
def test_production_refuses_placeholder_or_missing_secrets(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        _settings(environment="production", **overrides)


def test_production_accepts_real_secrets_and_development_is_lenient() -> None:
    assert _settings(environment="production").is_production is True
    assert (
        _settings(jwt_secret=JWT_SECRET_PLACEHOLDER, totp_encryption_key="").is_production is False
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"email_backend": "smtp", "smtp_host": ""},
        {"email_backend": "brevo", "brevo_api_key": ""},
    ],
)
def test_the_chosen_email_transport_must_be_configured(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        _settings(**overrides)


def test_brevo_does_not_need_an_smtp_server() -> None:
    settings = _settings(email_backend="brevo", brevo_api_key="chave", smtp_host="")

    assert settings.email_backend == "brevo"


def test_secrets_have_no_default_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    values = {key: value for key, value in BASE.items() if key != "jwt_secret"}

    with pytest.raises(ValidationError):
        Settings(**values)  # type: ignore[arg-type]


# ---------- logs


def _format(record: logging.LogRecord) -> dict[str, object]:
    return json.loads(JsonFormatter().format(record))  # type: ignore[no-any-return]


def test_log_only_carries_allowed_fields() -> None:
    record = logging.makeLogRecord(
        {
            "name": "contai.test",
            "levelname": "INFO",
            "msg": "job succeeded",
            "job_id": "abc",
            "attempt": 2,
            "password": "segredo",
            "description": "IFOOD *RESTAURANTE",
            "amount_cents": 4590,
            "token": "tok",
        }
    )

    logged = _format(record)

    assert logged["message"] == "job succeeded"
    assert logged["job_id"] == "abc"
    assert logged["attempt"] == 2
    for forbidden in ("password", "description", "amount_cents", "token"):
        assert forbidden not in logged
    assert "segredo" not in json.dumps(logged)


def test_log_of_an_exception_has_type_and_stack_but_not_the_message() -> None:
    try:
        raise ValueError("cpf 123.456.789-00")
    except ValueError:
        record = logging.LogRecord(
            "contai.test", logging.ERROR, __file__, 1, "falhou", None, sys.exc_info()
        )

    logged = _format(record)

    assert logged["exc_type"] == "ValueError"
    assert logged["stack"]
    assert "123.456" not in json.dumps(logged)


# ---------- modelos de e-mail


def test_render_fills_subject_and_body() -> None:
    rendered = render(
        "test_link",
        {"name": "Ana", "link": "https://contai.example/x?token=abc", "reason": "teste"},
        FIXTURES,
    )

    assert rendered.subject == "Olá, Ana"
    assert "https://contai.example/x?token=abc" in rendered.body
    assert not rendered.body.startswith("\n")


def test_render_refuses_missing_variables_and_missing_templates() -> None:
    with pytest.raises(KeyError):
        render("test_link", {"name": "Ana"}, FIXTURES)
    with pytest.raises(OSError):
        render("nao_existe", {}, FIXTURES)


def test_template_must_start_with_subject(tmp_path: Path) -> None:
    (tmp_path / "sem_assunto.txt").write_text("Só o corpo\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Assunto"):
        render("sem_assunto", {}, tmp_path)

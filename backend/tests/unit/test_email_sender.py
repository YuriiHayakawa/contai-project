"""Envio de e-mail pela API do Brevo (T260): o pedido certo, e o que vale nova tentativa."""

import io
import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from email.message import Message
from typing import Any

import pytest

from app.core.config import get_settings
from app.email import sender
from app.email.sender import BREVO_URL, EmailRejected, send_email

API_KEY = "chave-do-brevo-que-nao-pode-vazar"


class _Response:
    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{"messageId": "<1@brevo>"}'


class FakeBrevo:
    """Substituto de `urllib.request.urlopen`: guarda o pedido e responde com `status`."""

    def __init__(self) -> None:
        self.requests: list[urllib.request.Request] = []
        self.status = 201

    def __call__(self, request: urllib.request.Request, timeout: float) -> _Response:
        self.requests.append(request)
        if self.status >= 400:
            raise urllib.error.HTTPError(
                request.full_url, self.status, "erro", Message(), io.BytesIO(b"detalhe")
            )
        return _Response()


@pytest.fixture
def brevo(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeBrevo]:
    fake = FakeBrevo()
    settings = get_settings()
    monkeypatch.setattr(settings, "email_backend", "brevo")
    monkeypatch.setattr(settings, "brevo_api_key", type(settings.brevo_api_key)(API_KEY))
    monkeypatch.setattr(settings, "email_from", "Contaí <contai.app@exemplo.test>")
    monkeypatch.setattr(sender.urllib.request, "urlopen", fake)
    yield fake


async def test_the_message_goes_to_the_brevo_api(brevo: FakeBrevo) -> None:
    await send_email(to="ana@exemplo.test", subject="Olá, Ana", body="Confirme a conta.")

    [request] = brevo.requests
    assert request.full_url == BREVO_URL
    assert request.get_method() == "POST"
    assert request.get_header("Api-key") == API_KEY
    assert request.get_header("Content-type") == "application/json"
    assert request.data is not None
    payload: dict[str, Any] = json.loads(request.data)
    assert payload == {
        "sender": {"name": "Contaí", "email": "contai.app@exemplo.test"},
        "to": [{"email": "ana@exemplo.test"}],
        "subject": "Olá, Ana",
        "textContent": "Confirme a conta.\n",
    }


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_rate_limit_and_server_errors_are_worth_another_try(
    brevo: FakeBrevo, status: int
) -> None:
    brevo.status = status

    # O job transforma `OSError` em nova tentativa.
    with pytest.raises(OSError):
        await send_email(to="ana@exemplo.test", subject="Olá", body="Texto")


@pytest.mark.parametrize("status", [400, 401, 403])
async def test_a_refusal_is_final_and_carries_only_the_status(
    brevo: FakeBrevo, status: int
) -> None:
    brevo.status = status

    with pytest.raises(EmailRejected) as raised:
        await send_email(to="ana@exemplo.test", subject="Olá", body="Texto")

    assert raised.value.code == f"brevo_{status}"
    assert API_KEY not in str(raised.value)
    assert "detalhe" not in str(raised.value)


async def test_smtp_stays_the_default(brevo: FakeBrevo, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []
    monkeypatch.setattr(get_settings(), "email_backend", "smtp")
    monkeypatch.setattr(sender, "_send_smtp", lambda message: sent.append(str(message["To"])))

    await send_email(to="ana@exemplo.test", subject="Olá", body="Texto")

    assert sent == ["ana@exemplo.test"]
    assert brevo.requests == []

"""Envio de e-mail, só com a biblioteca padrão: por SMTP ou pela API do Brevo.

O ambiente local usa SMTP, com o Mailpit. Em produção, o Render gratuito fecha as portas de SMTP,
e o envio vai pela API HTTPS do Brevo (`EMAIL_BACKEND=brevo`, ADR 0010). Os dois bloqueiam, por
isso rodam em outra thread. Nenhum dos dois registra a chave nem o conteúdo da mensagem.
"""

import asyncio
import json
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import parseaddr

from app.core.config import get_settings

SMTP_TIMEOUT_SECONDS = 15
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
BREVO_TIMEOUT_SECONDS = 15
# Respostas do Brevo que valem nova tentativa: cota por minuto e falhas do lado dele.
_TOO_MANY_REQUESTS = 429
_SERVER_ERROR = 500


class EmailRejected(Exception):
    """O provedor recusou a mensagem (remetente, destinatário ou chave): tentar de novo não
    adianta. O código vai para o job, nunca o corpo da resposta."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def build_message(*, to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = get_settings().email_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    return message


def _send_smtp(message: EmailMessage) -> None:
    settings = get_settings()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


def brevo_payload(message: EmailMessage) -> dict[str, object]:
    """O corpo do `POST /v3/smtp/email`: remetente, destinatário, assunto e texto."""
    sender_name, sender_email = parseaddr(str(message["From"]))
    return {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": str(message["To"])}],
        "subject": str(message["Subject"]),
        "textContent": message.get_content(),
    }


def _send_brevo(message: EmailMessage) -> None:
    request = urllib.request.Request(
        BREVO_URL,
        data=json.dumps(brevo_payload(message)).encode(),
        method="POST",
        headers={
            "api-key": get_settings().brevo_api_key.get_secret_value(),
            "content-type": "application/json",
            "accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=BREVO_TIMEOUT_SECONDS) as response:  # noqa: S310 - URL fixa, em HTTPS
            response.read()
    except urllib.error.HTTPError as error:
        if error.code == _TOO_MANY_REQUESTS or error.code >= _SERVER_ERROR:
            # É um OSError: o job tenta de novo, com espera.
            raise
        raise EmailRejected(f"brevo_{error.code}") from None


async def send_email(*, to: str, subject: str, body: str) -> None:
    """Envia um e-mail de texto pelo meio configurado em `EMAIL_BACKEND`.

    Falha de rede, cota por minuto ou erro do servidor levantam `OSError` (vale tentar de novo);
    uma recusa definitiva do Brevo levanta `EmailRejected`.
    """
    message = build_message(to=to, subject=subject, body=body)
    send = _send_brevo if get_settings().email_backend == "brevo" else _send_smtp
    await asyncio.to_thread(send, message)

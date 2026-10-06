"""Envio de e-mail por SMTP, com a biblioteca padrão."""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings

SMTP_TIMEOUT_SECONDS = 15


def build_message(*, to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = get_settings().email_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    return message


def _send_sync(message: EmailMessage) -> None:
    settings = get_settings()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


async def send_email(*, to: str, subject: str, body: str) -> None:
    """Envia um e-mail de texto. A conexão SMTP bloqueia, por isso roda em outra thread."""
    await asyncio.to_thread(_send_sync, build_message(to=to, subject=subject, body=body))

"""Job de envio de e-mail.

O payload traz só o tipo do e-mail, o id do usuário e, opcionalmente, valores de contexto que
não são sensíveis (como uma data). Quando o e-mail leva um link, o token é gerado aqui, no
momento do envio, e só o hash dele é gravado.
"""

import uuid
from urllib.parse import urlencode

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.config import get_settings
from app.core.security import hash_token, new_token
from app.email.sender import send_email
from app.email.templates import EmailType, get_email_type, render
from app.modules.auth.repository import AuthRepository
from app.modules.users.repository import UserRepository
from app.worker import queue
from app.worker.models import Job, JobType


async def enqueue_email(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    email_type: str,
    context: dict[str, str] | None = None,
) -> Job:
    """Enfileira um e-mail para um usuário."""
    return await queue.enqueue(
        session,
        JobType.SEND_EMAIL,
        {"email_type": email_type, "user_id": str(user_id), "context": context or {}},
        user_id=user_id,
    )


async def _build_link(session: AsyncSession, user_id: uuid.UUID, email_type: EmailType) -> str:
    if email_type.token_type is None or email_type.token_ttl is None or not email_type.link_path:
        raise queue.PermanentJobError("email_type_misconfigured")
    now = clock.utcnow()
    token = new_token()
    repository = AuthRepository(session)
    # Um link novo invalida os anteriores do mesmo tipo.
    await repository.invalidate_email_tokens(user_id, email_type.token_type, now)
    await repository.create_email_token(
        user_id=user_id,
        token_type=email_type.token_type,
        token_hash=hash_token(token),
        expires_at=now + email_type.token_ttl,
    )
    origin = get_settings().app_origin.rstrip("/")
    return f"{origin}{email_type.link_path}?{urlencode({'token': token})}"


async def handle_send_email(session: AsyncSession, job: Job) -> None:
    email_type = get_email_type(str(job.payload.get("email_type")))
    if email_type is None:
        raise queue.PermanentJobError("unknown_email_type")

    try:
        user_id = uuid.UUID(str(job.payload.get("user_id")))
    except ValueError as exc:
        raise queue.PermanentJobError("invalid_payload") from exc
    user = await UserRepository(session).get_by_id(user_id)
    if user is None:
        raise queue.PermanentJobError("user_not_found")

    context = {
        str(key): str(value) for key, value in dict(job.payload.get("context") or {}).items()
    }
    context["name"] = user.name
    if email_type.token_type is not None:
        context["link"] = await _build_link(session, user.id, email_type)

    try:
        rendered = render(email_type.template, context, email_type.templates_dir)
    except (KeyError, ValueError, OSError) as exc:
        raise queue.PermanentJobError("template_error") from exc

    try:
        await send_email(to=user.email, subject=rendered.subject, body=rendered.body)
    except OSError as exc:
        # Falha de rede ou do servidor SMTP: vale tentar de novo, com um link novo.
        raise queue.RetryableJobError("smtp_failed") from exc

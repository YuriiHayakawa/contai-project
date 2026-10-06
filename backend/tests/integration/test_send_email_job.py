from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionFactory
from app.core.security import hash_token
from app.email import templates
from app.email.templates import EmailType, register_email_type
from app.modules.auth.models import EmailToken, EmailTokenType
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User
from app.worker.jobs.send_email import enqueue_email
from app.worker.main import build_worker
from app.worker.models import Job, JobStatus
from tests.conftest import FakeSMTP, extract_link

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "email_templates"


@pytest.fixture(autouse=True)
def _email_types() -> Iterator[None]:
    """Tipos de e-mail só destes testes; os reais são registrados pelos módulos."""
    original = dict(templates._EMAIL_TYPES)
    register_email_type(
        EmailType(
            name="test_link",
            template="test_link",
            token_type=EmailTokenType.EMAIL_VERIFICATION,
            token_ttl=timedelta(hours=24),
            link_path="/confirmar-email",
            templates_dir=FIXTURES,
        )
    )
    register_email_type(
        EmailType(name="test_missing", template="nao_existe", templates_dir=FIXTURES)
    )
    yield
    templates._EMAIL_TYPES.clear()
    templates._EMAIL_TYPES.update(original)


async def _run(session_factory: SessionFactory) -> None:
    worker = build_worker(session_factory)
    while await worker.process_next_job():
        pass


async def test_email_is_sent_with_a_valid_single_use_link(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    user_a: User,
    frozen_time: datetime,
) -> None:
    job = await enqueue_email(
        session, user_id=user_a.id, email_type="test_link", context={"reason": "teste"}
    )
    await session.commit()

    await _run(session_factory)
    await session.refresh(job)

    assert job.status == JobStatus.SUCCEEDED
    [message] = smtp.outbox
    assert message["To"] == "ana@exemplo.test"
    assert message["Subject"] == "Olá, Ana"
    assert "Motivo: teste" in message.get_content()

    link = urlparse(extract_link(message))
    assert f"{link.scheme}://{link.netloc}{link.path}" == "http://localhost:8080/confirmar-email"
    [token] = parse_qs(link.query)["token"]

    # O banco guarda só o hash do token, com o tipo e a validade certos.
    stored = await AuthRepository(session).get_email_token_by_hash(hash_token(token))
    assert stored is not None
    assert stored.user_id == user_a.id
    assert stored.type == EmailTokenType.EMAIL_VERIFICATION
    assert stored.expires_at == frozen_time + timedelta(hours=24)
    assert stored.used_at is None
    assert await AuthRepository(session).get_email_token_by_hash(token) is None


async def test_job_payload_never_contains_the_token(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    user_a: User,
    frozen_time: datetime,
) -> None:
    job = await enqueue_email(session, user_id=user_a.id, email_type="test_link")
    await session.commit()

    assert job.payload == {"email_type": "test_link", "user_id": str(user_a.id), "context": {}}


async def test_smtp_failure_is_retried_and_issues_a_new_link(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    user_a: User,
    frozen_time: datetime,
) -> None:
    smtp.fail_next = 1
    job = await enqueue_email(
        session, user_id=user_a.id, email_type="test_link", context={"reason": "teste"}
    )
    await session.commit()

    await _run(session_factory)
    await session.refresh(job)

    assert smtp.outbox == []
    assert (job.status, job.last_error_code) == (JobStatus.QUEUED, "smtp_failed")

    # Na nova tentativa o envio funciona.
    job.run_at = frozen_time
    await session.commit()
    await _run(session_factory)
    await session.refresh(job)

    assert job.status == JobStatus.SUCCEEDED
    assert len(smtp.outbox) == 1
    tokens = (
        await session.execute(select(EmailToken).where(EmailToken.user_id == user_a.id))
    ).scalars()
    # A tentativa que falhou não deixou token válido para trás: só existe o do e-mail enviado.
    assert len([token for token in tokens if token.used_at is None]) == 1


async def test_new_link_invalidates_the_previous_one(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    user_a: User,
    frozen_time: datetime,
) -> None:
    for _ in range(2):
        await enqueue_email(
            session, user_id=user_a.id, email_type="test_link", context={"reason": "teste"}
        )
    await session.commit()

    await _run(session_factory)

    first, second = (parse_qs(urlparse(extract_link(m)).query)["token"][0] for m in smtp.outbox)
    auth = AuthRepository(session)
    first_token = await auth.get_email_token_by_hash(hash_token(first))
    second_token = await auth.get_email_token_by_hash(hash_token(second))

    assert first_token is not None and first_token.used_at is not None
    assert second_token is not None and second_token.used_at is None


@pytest.mark.parametrize(
    ("email_type", "context", "error_code"),
    [
        ("desconhecido", {}, "unknown_email_type"),
        ("test_missing", {}, "template_error"),
        ("test_link", {}, "template_error"),  # falta a variável $reason
    ],
)
async def test_misconfigured_email_fails_permanently_without_sending(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    user_a: User,
    frozen_time: datetime,
    email_type: str,
    context: dict[str, str],
    error_code: str,
) -> None:
    job = await enqueue_email(session, user_id=user_a.id, email_type=email_type, context=context)
    await session.commit()

    await _run(session_factory)
    await session.refresh(job)

    assert job.status == JobStatus.FAILED
    assert job.last_error_code == error_code
    assert smtp.outbox == []


async def test_job_for_missing_user_fails_permanently(
    session: AsyncSession,
    session_factory: SessionFactory,
    smtp: type[FakeSMTP],
    frozen_time: datetime,
) -> None:
    from app.worker import queue
    from app.worker.models import JobType

    job: Job = await queue.enqueue(
        session,
        JobType.SEND_EMAIL,
        {"email_type": "test_link", "user_id": "00000000-0000-0000-0000-000000000000"},
    )
    invalid: Job = await queue.enqueue(
        session, JobType.SEND_EMAIL, {"email_type": "test_link", "user_id": "não-é-uuid"}
    )
    await session.commit()

    await _run(session_factory)
    await session.refresh(job)
    await session.refresh(invalid)

    assert (job.status, job.last_error_code) == (JobStatus.FAILED, "user_not_found")
    assert (invalid.status, invalid.last_error_code) == (JobStatus.FAILED, "invalid_payload")
    assert smtp.outbox == []

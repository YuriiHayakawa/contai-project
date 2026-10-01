from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import usage
from app.ai.models import AiTask
from app.ai.provider import LLMUsage
from app.ai.usage import LimitKind
from app.core import clock
from app.core.errors import AiLimitReached
from app.modules.users.models import User

MODEL = "modelo-de-teste"


async def _record(
    session: AsyncSession, user: User, task: AiTask, *, counts: bool = True, times: int = 1
) -> None:
    for _ in range(times):
        await usage.record_usage(
            session,
            user.id,
            task=task,
            model=MODEL,
            usage=LLMUsage(input_tokens=100, output_tokens=20),
            counts_toward_limit=counts,
        )


async def test_usage_starts_empty(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    status = await usage.get_status(session, user_a.id, LimitKind.QUESTION)

    assert (status.used, status.limit, status.remaining) == (0, 30, 30)
    await usage.check_limit(session, user_a.id, LimitKind.QUESTION)


async def test_questions_count_chat_and_text_entry_together(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    await _record(session, user_a, AiTask.CHAT, times=2)
    await _record(session, user_a, AiTask.TEXT_ENTRY)
    # Chamadas internas de uma mesma pergunta e a categorização não contam.
    await _record(session, user_a, AiTask.CHAT, counts=False, times=4)
    await _record(session, user_a, AiTask.CATEGORIZATION, counts=False)
    await _record(session, user_a, AiTask.STATEMENT_EXTRACTION)

    questions = await usage.get_status(session, user_a.id, LimitKind.QUESTION)
    extractions = await usage.get_status(session, user_a.id, LimitKind.EXTRACTION)

    assert questions.used == 3
    assert extractions.used == 1


async def test_question_limit_is_30_per_day(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    await _record(session, user_a, AiTask.CHAT, times=29)
    await usage.check_limit(session, user_a.id, LimitKind.QUESTION)

    await _record(session, user_a, AiTask.TEXT_ENTRY)

    with pytest.raises(AiLimitReached) as error:
        await usage.check_limit(session, user_a.id, LimitKind.QUESTION)
    assert error.value.status_code == 429
    assert error.value.code == "ai_limit_reached"
    # O limite zera à meia-noite de Brasília.
    assert error.value.details["resets_at"] == "2026-10-02T00:00:00-03:00"
    # O limite de extrações é separado.
    await usage.check_limit(session, user_a.id, LimitKind.EXTRACTION)


async def test_extraction_limit_is_10_per_day(
    session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    await _record(session, user_a, AiTask.STATEMENT_EXTRACTION, times=6)
    await _record(session, user_a, AiTask.RECEIPT_EXTRACTION, times=4)

    with pytest.raises(AiLimitReached) as error:
        await usage.check_limit(session, user_a.id, LimitKind.EXTRACTION)
    assert "OFX" in error.value.message
    await usage.check_limit(session, user_a.id, LimitKind.QUESTION)


async def test_limits_are_per_user(
    session: AsyncSession, user_a: User, user_b: User, frozen_time: datetime
) -> None:
    await _record(session, user_a, AiTask.CHAT, times=30)

    with pytest.raises(AiLimitReached):
        await usage.check_limit(session, user_a.id, LimitKind.QUESTION)
    await usage.check_limit(session, user_b.id, LimitKind.QUESTION)
    assert (await usage.get_status(session, user_b.id, LimitKind.QUESTION)).used == 0


async def test_day_turns_at_midnight_in_sao_paulo(session: AsyncSession, user_a: User) -> None:
    # 23:30 de 1º de outubro em Brasília (02:30 UTC do dia 2).
    clock.set_fixed_time(datetime(2026, 10, 2, 2, 30, tzinfo=UTC))
    try:
        await _record(session, user_a, AiTask.CHAT, times=30)
        with pytest.raises(AiLimitReached):
            await usage.check_limit(session, user_a.id, LimitKind.QUESTION)

        # Meia hora depois já é dia 2 em Brasília: o limite zerou.
        clock.set_fixed_time(clock.utcnow() + timedelta(minutes=31))
        await usage.check_limit(session, user_a.id, LimitKind.QUESTION)
        assert (await usage.get_status(session, user_a.id, LimitKind.QUESTION)).used == 0
    finally:
        clock.set_fixed_time(None)

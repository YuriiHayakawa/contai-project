"""Lançamento por voz pela Siri (feature 002, US3): `POST /api/v1/voice/entries`.

A IA falsa devolve o que "entendeu" da frase; o backend monta o lançamento, aplica as regras da
voz e responde a fala. Nada é gravado em nenhuma resposta diferente de 201.
"""

import datetime as dt
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import fallback as ai_fallback
from app.ai.fake import FakeLLMProvider
from app.ai.models import AiTask, AiUsage
from app.ai.provider import LLMUnavailable
from app.core import clock
from app.core.config import get_settings
from app.modules.assistant import voice_speech as speech
from app.modules.categories.service import CategoryService
from app.modules.transactions.models import Transaction, TransactionSource
from app.modules.users.models import User, UserStatus
from tests.conftest import without_request_id
from tests.finance import create_account, create_category

VOICE = "/api/v1/voice/entries"
TOKENS = "/api/v1/personal-tokens"

Json = dict[str, Any]
Voice = Callable[..., Awaitable[Response]]

pytestmark = pytest.mark.usefixtures("frozen_time")


@pytest_asyncio.fixture
async def finances(client_a: AsyncClient, session: AsyncSession, user_a: User) -> Json:
    # As categorias prontas, com as "Outros", como numa conta confirmada pelo e-mail.
    await CategoryService(session).create_defaults(user_a.id)
    nubank = await create_account(client_a, name="Nubank")
    inter = await create_account(
        client_a, name="Cartão Inter", type="credit_card", closing_day=7, due_day=15
    )
    c6 = await create_account(
        client_a, name="Cartão C6", type="credit_card", closing_day=3, due_day=10
    )
    food = await create_category(client_a, name="Comida na rua")
    salary = await create_category(client_a, name="Freelas", kind="income", icon="briefcase")
    return {"nubank": nubank, "inter": inter, "c6": c6, "food": food, "salary": salary}


@pytest_asyncio.fixture
async def token(client_a: AsyncClient, finances: Json) -> str:
    response = await client_a.post(
        TOKENS, json={"name": "iPhone", "default_account_id": finances["nubank"]["id"]}
    )
    assert response.status_code == 201, response.text
    created: str = response.json()["token"]
    return created


@pytest.fixture
def voice(client: AsyncClient, token: str) -> Voice:
    async def send(
        phrase: str, *, deadline_ms: int | None = None, bearer: str | None = None
    ) -> Response:
        headers = {"Authorization": f"Bearer {bearer or token}"}
        if deadline_ms is not None:
            headers["X-Contai-Deadline"] = str(deadline_ms)
        return await client.post(VOICE, json={"phrase": phrase}, headers=headers)

    return send


def understood(**fields: object) -> dict[str, object]:
    """O que a IA falsa "entendeu" da frase."""
    return {"intent": "entry", "type": "expense", "date_reference": "today", **fields}


def now_ms(offset_seconds: float = 0) -> int:
    return int((clock.utcnow() + timedelta(seconds=offset_seconds)).timestamp() * 1000)


async def voice_rows(session: AsyncSession, user: User) -> list[Transaction]:
    result = await session.execute(
        select(Transaction).where(
            Transaction.user_id == user.id, Transaction.source == TransactionSource.VOICE
        )
    )
    return list(result.scalars())


async def voice_usage(session: AsyncSession, user: User) -> list[AiUsage]:
    result = await session.execute(
        select(AiUsage).where(AiUsage.user_id == user.id, AiUsage.task == AiTask.VOICE_ENTRY)
    )
    return list(result.scalars())


# ---------- frases que gravam


async def test_expense_with_the_account_said_in_the_phrase(
    voice: Voice, fake_llm: FakeLLMProvider, finances: Json, session: AsyncSession, user_a: User
) -> None:
    fake_llm.queue_structured(
        understood(
            amount="45,90",
            description="iFood",
            account_hint="cartão inter",
            category_hint="Comida na rua",
        )
    )

    response = await voice("gastei 45 e 90 no ifood no cartão inter")

    assert response.status_code == 201
    body = response.json()
    assert body["outcome"] == "saved"
    assert body["speech"] == "Anotei 45 reais e 90 centavos em Comida na rua, no Cartão Inter."
    [row] = await voice_rows(session, user_a)
    assert str(row.id) == body["transaction_id"]
    assert row.amount_cents == 4590
    assert str(row.account_id) == finances["inter"]["id"]
    assert str(row.category_id) == finances["food"]["id"]
    assert row.date == dt.date(2026, 10, 1)
    assert row.description == "iFood"
    assert row.voice_phrase == "gastei 45 e 90 no ifood no cartão inter"
    # A frase vai para a IA como dado.
    [call] = fake_llm.calls
    assert "gastei 45 e 90 no ifood no cartão inter" in call.prompt


async def test_without_an_account_it_goes_to_the_default_account(
    voice: Voice, fake_llm: FakeLLMProvider, finances: Json, session: AsyncSession, user_a: User
) -> None:
    fake_llm.queue_structured(understood(amount="12", description="Padaria"))

    response = await voice("gastei 12 na padaria")

    assert response.status_code == 201
    assert response.json()["speech"] == "Anotei 12 reais em Outros, no Nubank."
    [row] = await voice_rows(session, user_a)
    assert str(row.account_id) == finances["nubank"]["id"]


async def test_income(
    voice: Voice, fake_llm: FakeLLMProvider, finances: Json, session: AsyncSession, user_a: User
) -> None:
    fake_llm.queue_structured(
        understood(type="income", amount="200", description="Freela", category_hint="Freelas")
    )

    response = await voice("recebi 200 de um freela")

    assert response.status_code == 201
    assert (
        response.json()["speech"] == "Anotei uma entrada de 200 reais em Freelas, na conta Nubank."
    )
    [row] = await voice_rows(session, user_a)
    assert row.type == "income"
    assert str(row.category_id) == finances["salary"]["id"]


async def test_yesterday(
    voice: Voice, fake_llm: FakeLLMProvider, finances: Json, session: AsyncSession, user_a: User
) -> None:
    fake_llm.queue_structured(
        understood(amount="30", description="Uber", date_reference="yesterday")
    )

    assert (await voice("ontem gastei 30 de uber")).status_code == 201

    [row] = await voice_rows(session, user_a)
    assert row.date == dt.date(2026, 9, 30)


# ---------- frases que não gravam nada


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        (
            understood(amount="45", description="iFood", account_hint="itaú"),
            speech.ACCOUNT_NOT_FOUND,
        ),
        (
            understood(amount="45", description="iFood", account_hint="cartão"),
            speech.ACCOUNT_AMBIGUOUS,
        ),
        (understood(description="iFood"), speech.AMOUNT_NOT_UNDERSTOOD),
        (understood(amount="quarenta e tantos", description="iFood"), speech.AMOUNT_NOT_UNDERSTOOD),
        (understood(amount="0", description="iFood"), speech.AMOUNT_NOT_UNDERSTOOD),
        (
            understood(amount="45", description="iFood", date_reference="2026-10-05"),
            speech.FUTURE_DATE,
        ),
    ],
    ids=["conta inexistente", "dois cartões", "sem valor", "valor inválido", "zero", "futuro"],
)
async def test_unclear_phrases_save_nothing(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    answer: dict[str, object],
    message: str,
) -> None:
    fake_llm.queue_structured(answer)

    response = await voice("uma frase qualquer")

    assert response.status_code == 422
    assert response.json() == {"outcome": "repeat", "speech": message, "transaction_id": None}
    assert await voice_rows(session, user_a) == []


async def test_without_an_account_and_with_the_default_archived_nothing_is_saved(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    client_a: AsyncClient,
    finances: Json,
    session: AsyncSession,
    user_a: User,
) -> None:
    await client_a.post(f"/api/v1/accounts/{finances['nubank']['id']}/archive")
    fake_llm.queue_structured(understood(amount="12", description="Padaria"))

    response = await voice("gastei 12 na padaria")

    assert response.status_code == 422
    assert response.json()["speech"] == speech.NO_ACCOUNT
    assert await voice_rows(session, user_a) == []


async def test_a_named_account_is_still_used_when_the_default_is_archived(
    voice: Voice, fake_llm: FakeLLMProvider, client_a: AsyncClient, finances: Json
) -> None:
    await client_a.post(f"/api/v1/accounts/{finances['nubank']['id']}/archive")
    fake_llm.queue_structured(
        understood(amount="12", description="Padaria", account_hint="cartão c6")
    )

    response = await voice("gastei 12 na padaria no cartão c6")

    assert response.status_code == 201


async def test_an_empty_phrase_does_not_call_the_ai(
    voice: Voice, fake_llm: FakeLLMProvider, session: AsyncSession, user_a: User
) -> None:
    response = await voice("   ")

    assert response.status_code == 422
    assert response.json()["speech"] == speech.EMPTY_PHRASE
    assert fake_llm.calls == []
    assert await voice_usage(session, user_a) == []


@pytest.mark.parametrize(
    ("intent", "message"),
    [
        ("multiple", speech.MULTIPLE_ENTRIES),
        ("transfer", speech.TRANSFER_OR_INSTALLMENTS),
        ("installments", speech.TRANSFER_OR_INSTALLMENTS),
        ("question", speech.QUESTION),
        ("other", speech.QUESTION),
    ],
)
async def test_unsupported_phrases_save_nothing(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    intent: str,
    message: str,
) -> None:
    fake_llm.queue_structured(understood(intent=intent, amount="45", description="iFood"))

    response = await voice("uma frase qualquer")

    assert response.status_code == 422
    assert response.json() == {"outcome": "unsupported", "speech": message, "transaction_id": None}
    assert await voice_rows(session, user_a) == []


# ---------- limites


async def test_the_daily_question_quota_is_checked_before_the_ai(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_daily_question_limit", 0)

    response = await voice("gastei 12 na padaria")

    assert response.status_code == 429
    assert response.json()["outcome"] == "limit"
    assert response.json()["speech"] == speech.DAILY_LIMIT
    assert fake_llm.calls == []
    assert await voice_rows(session, user_a) == []


async def test_the_21st_phrase_in_an_hour_is_refused(
    voice: Voice, fake_llm: FakeLLMProvider, session: AsyncSession, user_a: User
) -> None:
    for _ in range(20):
        fake_llm.queue_structured(understood(intent="question"))
        assert (await voice("quanto gastei?")).status_code == 422

    refused = await voice("quanto gastei?")

    assert refused.status_code == 429
    assert refused.json()["speech"] == speech.HOURLY_LIMIT
    assert len(fake_llm.calls) == 20


async def test_the_ai_being_down_saves_nothing(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ai_fallback, "RETRY_DELAY_SECONDS", 0)
    fake_llm.queue_structured_error(LLMUnavailable())
    fake_llm.queue_structured_error(LLMUnavailable())

    response = await voice("gastei 12 na padaria")

    assert response.status_code == 503
    assert response.json()["outcome"] == "unavailable"
    assert response.json()["speech"] == speech.UNAVAILABLE
    assert await voice_rows(session, user_a) == []
    # A chamada contou na cota, mesmo sem resposta da IA.
    [usage] = await voice_usage(session, user_a)
    assert usage.counts_toward_limit is True


# ---------- prazo


async def test_an_expired_deadline_does_not_call_the_ai_but_counts(
    voice: Voice, fake_llm: FakeLLMProvider, session: AsyncSession, user_a: User
) -> None:
    response = await voice("gastei 12 na padaria", deadline_ms=now_ms(-1))

    assert response.status_code == 503
    assert response.json() == {
        "outcome": "deadline",
        "speech": speech.WAKING,
        "transaction_id": None,
    }
    assert fake_llm.calls == []
    [usage] = await voice_usage(session, user_a)
    assert (usage.model, usage.input_tokens, usage.output_tokens) == ("none", 0, 0)
    assert usage.counts_toward_limit is True


async def test_less_than_a_second_and_a_half_left_does_not_call_the_ai(
    voice: Voice, fake_llm: FakeLLMProvider
) -> None:
    response = await voice("gastei 12 na padaria", deadline_ms=now_ms(1.0))

    assert response.status_code == 503
    assert fake_llm.calls == []


def _slow_ai(fake_llm: FakeLLMProvider, monkeypatch: pytest.MonkeyPatch, seconds: float) -> None:
    """A IA responde, mas o relógio anda `seconds` enquanto ela pensa."""
    original = fake_llm.generate_structured

    async def slow(**kwargs: Any) -> Any:
        result = await original(**kwargs)
        clock.set_fixed_time(clock.utcnow() + timedelta(seconds=seconds))
        return result

    monkeypatch.setattr(fake_llm, "generate_structured", slow)


async def test_a_deadline_passed_after_the_ai_rolls_back(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _slow_ai(fake_llm, monkeypatch, seconds=4)
    fake_llm.queue_structured(understood(amount="12", description="Padaria"))

    response = await voice("gastei 12 na padaria", deadline_ms=now_ms(3))

    assert response.status_code == 503
    assert response.json()["outcome"] == "deadline"
    assert await voice_rows(session, user_a) == []
    [usage] = await voice_usage(session, user_a)
    assert usage.counts_toward_limit is True


async def test_without_the_header_the_deadline_is_arrival_plus_5_5_seconds(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    session: AsyncSession,
    user_a: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _slow_ai(fake_llm, monkeypatch, seconds=5)
    fake_llm.queue_structured(understood(amount="12", description="Padaria"))
    assert (await voice("gastei 12 na padaria")).status_code == 201

    _slow_ai(fake_llm, monkeypatch, seconds=6)
    fake_llm.queue_structured(understood(amount="13", description="Padaria"))
    assert (await voice("gastei 13 na padaria")).status_code == 503

    assert [row.amount_cents for row in await voice_rows(session, user_a)] == [1200]


# ---------- autenticação


async def test_every_authentication_failure_gets_the_same_answer(
    client: AsyncClient,
    client_a: AsyncClient,
    voice: Voice,
    token: str,
    finances: Json,
) -> None:
    other = await client_a.post(
        TOKENS, json={"name": "Revogado", "default_account_id": finances["nubank"]["id"]}
    )
    revoked = other.json()["token"]
    await client_a.delete(f"{TOKENS}/{other.json()['id']}")
    secret = token.partition(".")[2]

    answers = [
        await client.post(VOICE, json={"phrase": "gastei 12"}),
        await voice("gastei 12", bearer="nao-e-token"),
        await voice("gastei 12", bearer=f"ctp_{uuid.uuid4()}.{secret}"),
        await voice("gastei 12", bearer=f"{token.partition('.')[0]}.segredo-errado"),
        await voice("gastei 12", bearer=revoked),
    ]

    assert {answer.status_code for answer in answers} == {401}
    bodies = [without_request_id(answer) for answer in answers]
    assert all(body == bodies[0] for body in bodies)
    assert bodies[0] == {
        "outcome": "unauthorized",
        "speech": speech.UNAUTHORIZED,
        "transaction_id": None,
    }


async def test_a_token_of_an_account_pending_deletion_is_refused(
    voice: Voice, session: AsyncSession, user_a: User
) -> None:
    user_a.status = UserStatus.PENDING_DELETION
    await session.flush()

    response = await voice("gastei 12")

    assert response.status_code == 401
    assert response.json()["outcome"] == "unauthorized"


async def test_the_token_last_use_is_recorded_at_most_once_a_minute(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    client_a: AsyncClient,
    frozen_time: datetime,
) -> None:
    fake_llm.queue_structured(understood(intent="question"))
    await voice("quanto gastei?")
    clock.set_fixed_time(frozen_time + timedelta(seconds=30))
    fake_llm.queue_structured(understood(intent="question"))
    await voice("quanto gastei?")

    [listed] = (await client_a.get(TOKENS)).json()["items"]
    assert datetime.fromisoformat(listed["last_used_at"]) == frozen_time


# ---------- uso e o que não vaza


async def test_each_phrase_counts_as_a_question(
    voice: Voice, fake_llm: FakeLLMProvider, session: AsyncSession, user_a: User
) -> None:
    fake_llm.queue_structured(understood(amount="12", description="Padaria"))
    fake_llm.queue_structured(understood(intent="question"))

    await voice("gastei 12 na padaria")
    await voice("quanto gastei?")

    usages = await voice_usage(session, user_a)
    assert len(usages) == 2
    assert all(usage.counts_toward_limit for usage in usages)
    counted = await session.execute(
        select(func.count())
        .select_from(AiUsage)
        .where(AiUsage.user_id == user_a.id, AiUsage.counts_toward_limit)
    )
    assert counted.scalar_one() == 2


async def test_nothing_private_is_spoken_and_nothing_sensitive_is_logged(
    voice: Voice,
    fake_llm: FakeLLMProvider,
    token: str,
    user_a: User,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    phrase = "gastei 45 no restaurante secreto do bairro"
    fake_llm.queue_structured(understood(amount="45", description="Restaurante"))

    response = await voice(phrase)

    spoken = response.json()["speech"]
    assert user_a.email not in spoken
    assert user_a.name not in spoken
    assert "saldo" not in spoken.lower()
    secret = token.partition(".")[2]
    for record in caplog.records:
        logged = f"{record.getMessage()} {record.__dict__}"
        assert "restaurante secreto" not in logged
        assert secret not in logged
    assert any(getattr(record, "outcome", None) == "saved" for record in caplog.records)

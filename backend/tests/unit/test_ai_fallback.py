"""Modelo reserva: quando o principal não responde, a chamada tenta o reserva (FR-072)."""

import pytest
from google.genai import errors
from pydantic import BaseModel

from app.ai import fallback
from app.ai.fake import FakeLLMProvider
from app.ai.fallback import ModelChoice
from app.ai.gemini import _translate_error
from app.ai.provider import (
    LLMError,
    LLMInvalidResponse,
    LLMMessage,
    LLMQuotaExhausted,
    LLMRateLimited,
    LLMRole,
    LLMUnavailable,
)
from app.core.config import get_settings

MODELS = ModelChoice(primary="principal", fallback="reserva")
MESSAGES = [LLMMessage(role=LLMRole.USER, content="Quanto gastei em setembro?")]


class Answer(BaseModel):
    total: str


@pytest.fixture(autouse=True)
def _no_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fallback, "RETRY_DELAY_SECONDS", 0)


async def _chat(models: ModelChoice = MODELS) -> str:
    result = await fallback.chat(models, system="s", messages=MESSAGES, tools=[])
    return f"{result.model}: {result.text}"


def _models_called(fake: FakeLLMProvider) -> list[str]:
    return [call.model for call in fake.calls]


async def test_the_primary_model_answers_and_the_fallback_is_not_called(
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_text("ok")

    assert await _chat() == "principal: ok"
    assert _models_called(fake_llm) == ["principal"]


@pytest.mark.parametrize(
    "failure",
    [LLMUnavailable("503"), LLMRateLimited(), LLMQuotaExhausted()],
    ids=["indisponível", "muitos pedidos", "cota do dia"],
)
async def test_the_fallback_answers_when_the_primary_does_not(
    fake_llm: FakeLLMProvider, failure: LLMError
) -> None:
    fake_llm.queue_chat_error(failure)
    fake_llm.queue_text("ok")

    # O resultado diz qual modelo respondeu, para o registro de uso.
    assert await _chat() == "reserva: ok"
    assert _models_called(fake_llm) == ["principal", "reserva"]


async def test_structured_calls_use_the_fallback_too(fake_llm: FakeLLMProvider) -> None:
    fake_llm.queue_structured_error(LLMUnavailable("503"))
    fake_llm.queue_structured({"total": "45,90"})

    result = await fallback.generate_structured(MODELS, system="s", prompt="p", schema=Answer)

    assert (result.model, result.value.total) == ("reserva", "45,90")
    assert _models_called(fake_llm) == ["principal", "reserva"]


@pytest.mark.parametrize(
    ("failures", "expected"),
    [
        # Só é "a cota do dia acabou" quando acabou nos dois modelos.
        ((LLMQuotaExhausted(), LLMQuotaExhausted()), LLMQuotaExhausted),
        ((LLMQuotaExhausted(), LLMUnavailable("503")), LLMUnavailable),
        ((LLMUnavailable("503"), LLMQuotaExhausted()), LLMUnavailable),
        ((LLMRateLimited(), LLMQuotaExhausted()), LLMRateLimited),
        ((LLMUnavailable("503"), LLMUnavailable("503")), LLMUnavailable),
    ],
    ids=[
        "cota do dia nos dois",
        "cota no principal, reserva fora do ar",
        "principal fora do ar, reserva sem cota",
        "muitos pedidos no principal, reserva sem cota",
        "os dois fora do ar",
    ],
)
async def test_when_both_models_fail_the_error_says_whether_to_come_back_tomorrow(
    fake_llm: FakeLLMProvider, failures: tuple[LLMError, LLMError], expected: type[LLMError]
) -> None:
    for failure in failures:
        fake_llm.queue_chat_error(failure)

    with pytest.raises(expected) as raised:
        await _chat()

    assert type(raised.value) is expected
    assert _models_called(fake_llm) == ["principal", "reserva"]


async def test_an_invalid_answer_is_not_a_reason_to_call_the_fallback(
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_chat_error(LLMInvalidResponse("resposta sem sentido"))

    with pytest.raises(LLMInvalidResponse):
        await _chat()

    assert _models_called(fake_llm) == ["principal"]


@pytest.mark.parametrize("fallback_model", ["", "principal"], ids=["vazio", "igual ao principal"])
async def test_without_a_fallback_a_passing_failure_is_retried_once_on_the_same_model(
    fake_llm: FakeLLMProvider, fallback_model: str
) -> None:
    fake_llm.queue_chat_error(LLMUnavailable("503"))
    fake_llm.queue_text("ok")

    assert await _chat(ModelChoice("principal", fallback_model)) == "principal: ok"
    assert _models_called(fake_llm) == ["principal", "principal"]


async def test_without_a_fallback_the_daily_quota_is_not_retried(
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_chat_error(LLMQuotaExhausted())

    with pytest.raises(LLMQuotaExhausted):
        await _chat(ModelChoice("principal"))

    # Repetir hoje só gastaria outra chamada recusada.
    assert _models_called(fake_llm) == ["principal"]


def test_the_models_of_each_task_come_from_the_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_model_chat", "chat")
    monkeypatch.setattr(settings, "ai_model_chat_fallback", "chat-reserva")
    monkeypatch.setattr(settings, "ai_model_extraction", "extração")
    monkeypatch.setattr(settings, "ai_model_extraction_fallback", "")

    assert fallback.chat_models() == ModelChoice("chat", "chat-reserva")
    assert fallback.extraction_models() == ModelChoice("extração", "")
    assert not fallback.extraction_models().has_fallback


# ---------- o erro de cota do Gemini


def _quota_error(*quota_ids: str, retry_delay: str) -> errors.ClientError:
    """Um 429 no formato que o Gemini devolve, com os limites estourados e a espera."""
    return errors.ClientError(
        429,
        {
            "error": {
                "code": 429,
                "message": "You exceeded your current quota.",
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [{"quotaId": quota_id} for quota_id in quota_ids],
                    },
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": retry_delay,
                    },
                ],
            }
        },
    )


def test_gemini_daily_quota_is_told_apart_from_requests_per_minute() -> None:
    per_minute = _translate_error(
        _quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", retry_delay="34s")
    )
    per_day = _translate_error(
        _quota_error(
            "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            retry_delay="79198s",
        )
    )

    assert type(per_minute) is LLMRateLimited
    assert per_minute.retry_after == 34
    assert type(per_day) is LLMQuotaExhausted
    assert per_day.retry_after == 79198


def test_gemini_a_wait_of_hours_without_the_quota_name_is_the_daily_quota() -> None:
    assert type(_translate_error(_quota_error(retry_delay="7200.5s"))) is LLMQuotaExhausted
    assert type(_translate_error(_quota_error(retry_delay="59s"))) is LLMRateLimited
    # Sem detalhe nenhum, é um limite passageiro.
    bare = _translate_error(errors.ClientError(429, {"error": {"message": "quota"}}))
    assert type(bare) is LLMRateLimited
    assert bare.retry_after is None

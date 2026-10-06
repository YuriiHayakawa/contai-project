"""O provedor falso e o provedor Gemini, este último com o cliente do SDK substituído."""

from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors, types
from pydantic import BaseModel

from app.ai import factory
from app.ai.fake import FakeLLMProvider
from app.ai.gemini import GeminiProvider
from app.ai.provider import (
    Attachment,
    LLMInvalidResponse,
    LLMMessage,
    LLMRateLimited,
    LLMRole,
    LLMUnavailable,
    ToolCall,
    ToolSpec,
)


class Receipt(BaseModel):
    description: str
    amount: str


TOOL = ToolSpec(
    name="get_account_balances",
    description="Saldo das contas",
    parameters={"type": "object", "properties": {}},
)
MESSAGES = [LLMMessage(role=LLMRole.USER, content="Quanto tenho na poupança?")]

# ---------- provedor falso


async def test_fake_returns_scripted_responses_in_order_and_records_calls() -> None:
    fake = FakeLLMProvider()
    call = ToolCall(id="1", name="get_account_balances", arguments={})
    fake.queue_tool_calls(call)
    fake.queue_text("Você tem R$ 6.500,00.")

    first = await fake.chat(model="m", system="s", messages=MESSAGES, tools=[TOOL])
    second = await fake.chat(model="m", system="s", messages=MESSAGES, tools=[TOOL])

    assert first.tool_calls == (call,)
    assert second.text == "Você tem R$ 6.500,00."
    assert [recorded.operation for recorded in fake.calls] == ["chat", "chat"]
    assert fake.calls[0].messages == tuple(MESSAGES)
    assert fake.calls[0].tools == (TOOL,)


async def test_fake_without_script_fails_loudly() -> None:
    fake = FakeLLMProvider()

    with pytest.raises(LLMInvalidResponse):
        await fake.chat(model="m", system="s", messages=MESSAGES, tools=[])
    with pytest.raises(LLMInvalidResponse):
        await fake.generate_structured(model="m", system="s", prompt="p", schema=Receipt)


async def test_fake_raises_scripted_errors() -> None:
    fake = FakeLLMProvider()
    fake.queue_chat_error(LLMRateLimited(retry_after=30))
    fake.queue_structured_error(LLMUnavailable("fora do ar"))

    with pytest.raises(LLMRateLimited) as error:
        await fake.chat(model="m", system="s", messages=MESSAGES, tools=[])
    assert error.value.retry_after == 30
    with pytest.raises(LLMUnavailable):
        await fake.generate_structured(model="m", system="s", prompt="p", schema=Receipt)


async def test_fake_validates_structured_response_against_schema() -> None:
    fake = FakeLLMProvider()
    fake.queue_structured({"description": "Padaria", "amount": "12,50"})
    fake.queue_structured({"description": "sem valor"})
    attachment = Attachment(mime_type="image/png", data=b"\x89PNG")

    result = await fake.generate_structured(
        model="m", system="s", prompt="p", schema=Receipt, attachments=[attachment]
    )

    assert result.value == Receipt(description="Padaria", amount="12,50")
    assert fake.calls[0].attachments == (attachment,)
    with pytest.raises(LLMInvalidResponse):
        await fake.generate_structured(model="m", system="s", prompt="p", schema=Receipt)


def test_attachment_repr_does_not_expose_content() -> None:
    assert "segredo" not in repr(Attachment(mime_type="application/pdf", data=b"segredo"))


def test_factory_uses_the_fake_provider_in_tests() -> None:
    factory.get_provider.cache_clear()

    assert isinstance(factory.get_provider(), FakeLLMProvider)


# ---------- provedor Gemini


class _FakeModels:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.kwargs: dict[str, Any] = {}

    async def generate_content(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return self.response


def _provider(models: _FakeModels) -> GeminiProvider:
    provider = GeminiProvider(api_key="chave-de-teste")
    provider._client = SimpleNamespace(aio=SimpleNamespace(models=models))  # type: ignore[assignment]
    return provider


def _response(parts: list[types.Part]) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=120, candidates_token_count=30
        ),
    )


async def test_gemini_chat_returns_text_and_usage() -> None:
    models = _FakeModels(_response([types.Part.from_text(text="Você tem R$ 6.500,00.")]))

    result = await _provider(models).chat(
        model="modelo-chat", system="regras", messages=MESSAGES, tools=[TOOL]
    )

    assert result.text == "Você tem R$ 6.500,00."
    assert result.tool_calls == ()
    assert (result.usage.input_tokens, result.usage.output_tokens) == (120, 30)

    config = models.kwargs["config"]
    assert models.kwargs["model"] == "modelo-chat"
    assert config.system_instruction == "regras"
    # A execução automática de funções do SDK fica desligada: quem executa é o backend.
    assert config.automatic_function_calling.disable is True
    assert config.tools[0].function_declarations[0].name == "get_account_balances"


async def test_gemini_chat_returns_tool_calls_without_executing_them() -> None:
    part = types.Part.from_function_call(name="get_top_expenses", args={"limit": 5})
    models = _FakeModels(_response([part]))

    result = await _provider(models).chat(model="m", system="s", messages=MESSAGES, tools=[TOOL])

    assert result.text == ""
    [call] = result.tool_calls
    assert (call.name, call.arguments) == ("get_top_expenses", {"limit": 5})
    assert call.id


async def test_gemini_sends_conversation_history_with_tool_results() -> None:
    models = _FakeModels(_response([types.Part.from_text(text="ok")]))
    history = [
        LLMMessage(role=LLMRole.USER, content="Quanto gastei?"),
        LLMMessage(
            role=LLMRole.ASSISTANT,
            tool_calls=(ToolCall(id="1", name="get_spending_summary", arguments={"a": 1}),),
        ),
        LLMMessage(
            role=LLMRole.TOOL,
            content='{"total": 100}',
            tool_call_id="1",
            tool_name="get_spending_summary",
        ),
    ]

    await _provider(models).chat(model="m", system="s", messages=history, tools=[TOOL])

    contents = models.kwargs["contents"]
    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].function_call.name == "get_spending_summary"
    assert contents[2].parts[0].function_response.name == "get_spending_summary"
    assert contents[2].parts[0].function_response.response == {"result": '{"total": 100}'}


async def test_gemini_structured_output_is_validated() -> None:
    models = _FakeModels(
        _response([types.Part.from_text(text='{"description": "Padaria", "amount": "12,50"}')])
    )
    attachment = Attachment(mime_type="application/pdf", data=b"%PDF-1.7")

    result = await _provider(models).generate_structured(
        model="modelo-extracao",
        system="s",
        prompt="Extraia",
        schema=Receipt,
        attachments=[attachment],
    )

    assert result.value == Receipt(description="Padaria", amount="12,50")
    config = models.kwargs["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == Receipt.model_json_schema()
    parts = models.kwargs["contents"][0].parts
    assert parts[0].inline_data.mime_type == "application/pdf"
    assert parts[1].text == "Extraia"


@pytest.mark.parametrize("text", ["isto não é JSON", '{"description": "sem valor"}'])
async def test_gemini_invalid_structured_output_is_an_error(text: str) -> None:
    models = _FakeModels(_response([types.Part.from_text(text=text)]))

    with pytest.raises(LLMInvalidResponse):
        await _provider(models).generate_structured(
            model="m", system="s", prompt="p", schema=Receipt
        )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (errors.ClientError(429, {"error": {"message": "quota"}}), LLMRateLimited),
        (errors.ClientError(400, {"error": {"message": "bad"}}), LLMUnavailable),
        (errors.ServerError(503, {"error": {"message": "down"}}), LLMUnavailable),
        (TimeoutError(), LLMUnavailable),
        (ConnectionError(), LLMUnavailable),
    ],
)
async def test_gemini_errors_become_provider_errors(
    error: Exception, expected: type[Exception]
) -> None:
    with pytest.raises(expected):
        await _provider(_FakeModels(error=error)).chat(
            model="m", system="s", messages=MESSAGES, tools=[]
        )

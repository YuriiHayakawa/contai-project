"""Provedor de IA falso, com respostas roteirizadas.

É o provedor de todos os testes e do desenvolvimento local com `AI_PROVIDER=fake`. Nunca acessa
a rede: devolve, em ordem, as respostas enfileiradas, e registra as chamadas que recebeu.
"""

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from app.ai.provider import (
    Attachment,
    LLMChatResult,
    LLMError,
    LLMInvalidResponse,
    LLMMessage,
    LLMStructuredResult,
    LLMUsage,
    ToolCall,
    ToolSpec,
)

DEFAULT_USAGE = LLMUsage(input_tokens=10, output_tokens=5)


@dataclass(frozen=True)
class RecordedCall:
    """Uma chamada recebida, para os testes conferirem o que foi enviado ao provedor."""

    operation: str
    model: str
    system: str
    messages: tuple[LLMMessage, ...] = ()
    tools: tuple[ToolSpec, ...] = ()
    prompt: str = ""
    attachments: tuple[Attachment, ...] = ()


class FakeLLMProvider:
    def __init__(self) -> None:
        self.calls: list[RecordedCall] = []
        self._chat_script: deque[LLMChatResult | LLMError] = deque()
        self._structured_script: deque[dict[str, Any] | BaseModel | LLMError] = deque()

    # ---------- roteiro

    def queue_text(self, text: str, usage: LLMUsage = DEFAULT_USAGE) -> None:
        self._chat_script.append(LLMChatResult(text=text, tool_calls=(), usage=usage))

    def queue_tool_calls(self, *tool_calls: ToolCall, usage: LLMUsage = DEFAULT_USAGE) -> None:
        self._chat_script.append(LLMChatResult(text="", tool_calls=tool_calls, usage=usage))

    def queue_structured(self, value: dict[str, Any] | BaseModel) -> None:
        self._structured_script.append(value)

    def queue_chat_error(self, error: LLMError) -> None:
        self._chat_script.append(error)

    def queue_structured_error(self, error: LLMError) -> None:
        self._structured_script.append(error)

    # ---------- LLMProvider

    async def chat(
        self,
        *,
        model: str,
        system: str,
        messages: Sequence[LLMMessage],
        tools: Sequence[ToolSpec],
    ) -> LLMChatResult:
        self.calls.append(
            RecordedCall(
                operation="chat",
                model=model,
                system=system,
                messages=tuple(messages),
                tools=tuple(tools),
            )
        )
        if not self._chat_script:
            raise LLMInvalidResponse("FakeLLMProvider: nenhuma resposta de chat enfileirada")
        scripted = self._chat_script.popleft()
        if isinstance(scripted, LLMError):
            raise scripted
        return scripted

    async def generate_structured[T: BaseModel](
        self,
        *,
        model: str,
        system: str,
        prompt: str,
        schema: type[T],
        attachments: Sequence[Attachment] = (),
    ) -> LLMStructuredResult[T]:
        self.calls.append(
            RecordedCall(
                operation="generate_structured",
                model=model,
                system=system,
                prompt=prompt,
                attachments=tuple(attachments),
            )
        )
        if not self._structured_script:
            raise LLMInvalidResponse("FakeLLMProvider: nenhuma resposta estruturada enfileirada")
        scripted = self._structured_script.popleft()
        if isinstance(scripted, LLMError):
            raise scripted
        raw = scripted.model_dump() if isinstance(scripted, BaseModel) else scripted
        try:
            value = schema.model_validate(raw)
        except ValidationError as exc:
            raise LLMInvalidResponse("a resposta não respeita o schema") from exc
        return LLMStructuredResult(value=value, usage=DEFAULT_USAGE)

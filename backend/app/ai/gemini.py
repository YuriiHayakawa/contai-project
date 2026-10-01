"""Provedor de IA do Google Gemini, pelo SDK oficial `google-genai`.

Tudo que é específico do fornecedor fica neste arquivo. A execução automática de funções do SDK
fica desligada: o modelo só devolve os pedidos de chamada, e quem executa é o backend.
"""

import json
from collections.abc import Sequence
from typing import Any

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from app.ai.provider import (
    Attachment,
    LLMChatResult,
    LLMError,
    LLMInvalidResponse,
    LLMMessage,
    LLMRateLimited,
    LLMRole,
    LLMStructuredResult,
    LLMUnavailable,
    LLMUsage,
    ToolCall,
    ToolSpec,
)

_RATE_LIMIT_STATUS = 429
_NO_AUTOMATIC_CALLS = types.AutomaticFunctionCallingConfig(disable=True)


def _to_contents(messages: Sequence[LLMMessage]) -> list[types.Content]:
    contents: list[types.Content] = []
    for message in messages:
        if message.role == LLMRole.TOOL:
            part = types.Part.from_function_response(
                name=message.tool_name or "", response={"result": message.content}
            )
            contents.append(types.Content(role="user", parts=[part]))
            continue
        parts: list[types.Part] = []
        if message.content:
            parts.append(types.Part.from_text(text=message.content))
        parts.extend(
            types.Part.from_function_call(name=call.name, args=call.arguments)
            for call in message.tool_calls
        )
        role = "model" if message.role == LLMRole.ASSISTANT else "user"
        contents.append(types.Content(role=role, parts=parts))
    return contents


def _to_tools(tools: Sequence[ToolSpec]) -> list[types.Tool]:
    if not tools:
        return []
    declarations = [
        types.FunctionDeclaration(
            name=tool.name, description=tool.description, parameters_json_schema=tool.parameters
        )
        for tool in tools
    ]
    return [types.Tool(function_declarations=declarations)]


def _usage(response: types.GenerateContentResponse) -> LLMUsage:
    metadata = response.usage_metadata
    if metadata is None:
        return LLMUsage()
    return LLMUsage(
        input_tokens=metadata.prompt_token_count or 0,
        output_tokens=metadata.candidates_token_count or 0,
    )


def _translate_error(error: errors.APIError) -> LLMError:
    if error.code == _RATE_LIMIT_STATUS:
        return LLMRateLimited()
    return LLMUnavailable(f"erro {error.code} do fornecedor")


class GeminiProvider:
    def __init__(self, api_key: str) -> None:
        self._client = genai.Client(api_key=api_key)

    async def _generate(
        self, *, model: str, contents: Any, config: types.GenerateContentConfig
    ) -> types.GenerateContentResponse:
        try:
            return await self._client.aio.models.generate_content(
                model=model, contents=contents, config=config
            )
        except errors.APIError as error:
            raise _translate_error(error) from error
        except (OSError, TimeoutError) as error:
            raise LLMUnavailable("o fornecedor não respondeu") from error

    async def chat(
        self,
        *,
        model: str,
        system: str,
        messages: Sequence[LLMMessage],
        tools: Sequence[ToolSpec],
    ) -> LLMChatResult:
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=list(_to_tools(tools)),
            automatic_function_calling=_NO_AUTOMATIC_CALLS,
        )
        response = await self._generate(model=model, contents=_to_contents(messages), config=config)
        calls = tuple(
            ToolCall(
                id=call.id or f"call-{index}",
                name=call.name or "",
                arguments=dict(call.args or {}),
            )
            for index, call in enumerate(response.function_calls or [])
        )
        return LLMChatResult(
            text="" if calls else (response.text or ""), tool_calls=calls, usage=_usage(response)
        )

    async def generate_structured[T: BaseModel](
        self,
        *,
        model: str,
        system: str,
        prompt: str,
        schema: type[T],
        attachments: Sequence[Attachment] = (),
    ) -> LLMStructuredResult[T]:
        parts = [
            types.Part.from_bytes(data=attachment.data, mime_type=attachment.mime_type)
            for attachment in attachments
        ]
        parts.append(types.Part.from_text(text=prompt))
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            automatic_function_calling=_NO_AUTOMATIC_CALLS,
        )
        response = await self._generate(
            model=model, contents=[types.Content(role="user", parts=parts)], config=config
        )
        try:
            value = schema.model_validate(json.loads(response.text or ""))
        except (json.JSONDecodeError, ValidationError) as error:
            raise LLMInvalidResponse("a resposta não respeita o schema") from error
        return LLMStructuredResult(value=value, usage=_usage(response))

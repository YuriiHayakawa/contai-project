"""Interface do provedor de IA.

Todo uso de IA no sistema passa por `LLMProvider`. Os tipos deste módulo são próprios do
projeto: nenhum tipo do SDK de um fornecedor sai da implementação. Trocar de modelo ou de
fornecedor é criar outra implementação; nenhuma regra de negócio muda.

O provedor nunca executa ferramentas: ele só devolve os pedidos de chamada. Quem executa é o
serviço que o chamou, e é ali que o `user_id` da sessão é injetado.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from pydantic import BaseModel


class LLMRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass(frozen=True)
class ToolCall:
    """Pedido do modelo para chamar uma ferramenta."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class LLMMessage:
    """Uma mensagem da conversa.

    Com `role=TOOL`, `content` é o resultado da ferramenta `tool_name` (em JSON), em resposta ao
    pedido `tool_call_id`.
    """

    role: LLMRole
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None
    tool_name: str | None = None


@dataclass(frozen=True)
class ToolSpec:
    """Descrição de uma ferramenta: nome, para que serve e o JSON Schema dos parâmetros."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class Attachment:
    """Arquivo enviado junto do pedido (PDF ou imagem)."""

    mime_type: str
    data: bytes = field(repr=False)


@dataclass(frozen=True)
class LLMUsage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class LLMChatResult:
    """Resultado de uma rodada de conversa: texto, ou pedidos de chamada de ferramenta."""

    text: str
    tool_calls: tuple[ToolCall, ...]
    usage: LLMUsage


@dataclass(frozen=True)
class LLMStructuredResult[T: BaseModel]:
    """Resposta já validada contra o schema pedido."""

    value: T
    usage: LLMUsage


class LLMError(Exception):
    """Erro do provedor de IA."""


class LLMRateLimited(LLMError):
    """O fornecedor recusou por excesso de pedidos. `retry_after` vem em segundos, se informado."""

    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__("rate limited")
        self.retry_after = retry_after


class LLMUnavailable(LLMError):
    """O fornecedor está fora do ar ou não respondeu."""


class LLMInvalidResponse(LLMError):
    """A resposta do modelo não pôde ser interpretada ou não respeitou o schema."""


class LLMProvider(Protocol):
    async def chat(
        self,
        *,
        model: str,
        system: str,
        messages: Sequence[LLMMessage],
        tools: Sequence[ToolSpec],
    ) -> LLMChatResult:
        """Uma rodada de conversa: devolve texto ou pedidos de chamada de ferramenta."""
        ...

    async def generate_structured[T: BaseModel](
        self,
        *,
        model: str,
        system: str,
        prompt: str,
        schema: type[T],
        attachments: Sequence[Attachment] = (),
    ) -> LLMStructuredResult[T]:
        """Gera uma resposta validada contra `schema`, com anexos opcionais."""
        ...

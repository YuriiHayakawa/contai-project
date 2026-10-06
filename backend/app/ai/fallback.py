"""Chamadas ao provedor de IA com modelo reserva.

Todo uso de IA no sistema passa por `chat` e `generate_structured` deste módulo. Quando o
modelo principal responde indisponível ou sem cota, a chamada tenta o reserva antes de desistir
(FR-072). Sem reserva configurado, um erro passageiro ganha uma segunda tentativa no mesmo
modelo, depois de uma pausa curta. A cota do dia é diferente: repetir hoje não adianta.

O resultado diz qual modelo respondeu, para o registro de uso (`ai_usage`).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace

from pydantic import BaseModel

from app.ai import factory
from app.ai.provider import (
    Attachment,
    LLMChatResult,
    LLMMessage,
    LLMQuotaExhausted,
    LLMRateLimited,
    LLMStructuredResult,
    LLMUnavailable,
    ToolSpec,
)
from app.core.config import get_settings

logger = logging.getLogger("contai.ai")

# Pausa antes de repetir no mesmo modelo, quando não há reserva.
RETRY_DELAY_SECONDS = 1.0

type _Failure = LLMRateLimited | LLMUnavailable


@dataclass(frozen=True)
class ModelChoice:
    """O modelo de uma tarefa e o reserva dele; reserva vazio é "sem reserva"."""

    primary: str
    fallback: str = ""

    @property
    def has_fallback(self) -> bool:
        return bool(self.fallback) and self.fallback != self.primary


def chat_models() -> ModelChoice:
    """Modelos do chat, da sugestão de categorias e do lançamento por texto."""
    settings = get_settings()
    return ModelChoice(settings.ai_model_chat, settings.ai_model_chat_fallback)


def extraction_models() -> ModelChoice:
    """Modelos da extração de PDF e imagem."""
    settings = get_settings()
    return ModelChoice(settings.ai_model_extraction, settings.ai_model_extraction_fallback)


def _worst(failures: Sequence[_Failure]) -> _Failure:
    """O erro que vai para quem chamou.

    Só é "a cota do dia acabou" quando acabou em todos os modelos tentados. Se algum falhou
    por outro motivo, ele pode voltar em minutos, e é isso que o usuário precisa saber.
    """
    passing = [failure for failure in failures if not isinstance(failure, LLMQuotaExhausted)]
    return passing[-1] if passing else failures[-1]


async def _attempt[R: (LLMChatResult, LLMStructuredResult[BaseModel])](
    models: ModelChoice, call: Callable[[str], Awaitable[R]]
) -> R:
    failures: list[_Failure] = []
    candidates = [models.primary, models.fallback if models.has_fallback else models.primary]
    for position, model in enumerate(candidates):
        if position > 0 and not models.has_fallback:
            if isinstance(failures[-1], LLMQuotaExhausted):
                break
            await asyncio.sleep(RETRY_DELAY_SECONDS)
        try:
            return replace(await call(model), model=model)
        except (LLMRateLimited, LLMUnavailable) as failure:
            logger.warning(
                "ai model did not answer",
                extra={"model": model, "error_code": type(failure).__name__},
            )
            failures.append(failure)
    raise _worst(failures)


async def chat(
    models: ModelChoice,
    *,
    system: str,
    messages: Sequence[LLMMessage],
    tools: Sequence[ToolSpec],
) -> LLMChatResult:
    """Uma rodada de conversa, no modelo principal ou, se ele não responder, no reserva."""
    provider = factory.get_provider()
    return await _attempt(
        models,
        lambda model: provider.chat(model=model, system=system, messages=messages, tools=tools),
    )


async def generate_structured[T: BaseModel](
    models: ModelChoice,
    *,
    system: str,
    prompt: str,
    schema: type[T],
    attachments: Sequence[Attachment] = (),
) -> LLMStructuredResult[T]:
    """Uma resposta validada contra `schema`, com o mesmo modelo reserva de `chat`.

    O documento anexo vai inteiro em cada tentativa: uma chamada por documento, nunca uma por
    página.
    """
    provider = factory.get_provider()
    return await _attempt(  # type: ignore[return-value]
        models,
        lambda model: provider.generate_structured(
            model=model, system=system, prompt=prompt, schema=schema, attachments=attachments
        ),
    )

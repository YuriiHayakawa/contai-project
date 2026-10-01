"""Registro do uso de IA e limites diários por usuário.

Há dois limites: perguntas (conversa com o assistente e lançamento por texto, somados) e
extrações de documentos. O dia é contado no fuso de Brasília e o limite zera à meia-noite.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.models import AiTask
from app.ai.provider import LLMUsage
from app.ai.repository import AiUsageRepository
from app.core import clock
from app.core.config import get_settings
from app.core.errors import AiLimitReached


class LimitKind(StrEnum):
    QUESTION = "question"
    EXTRACTION = "extraction"


_TASKS: dict[LimitKind, tuple[AiTask, ...]] = {
    LimitKind.QUESTION: (AiTask.CHAT, AiTask.TEXT_ENTRY),
    LimitKind.EXTRACTION: (AiTask.STATEMENT_EXTRACTION, AiTask.RECEIPT_EXTRACTION),
}

_MESSAGES: dict[LimitKind, str] = {
    LimitKind.QUESTION: (
        "Você atingiu o limite de perguntas ao assistente por hoje. Ele volta amanhã."
    ),
    LimitKind.EXTRACTION: (
        "Você atingiu o limite de documentos lidos pela IA por hoje. Amanhã você pode enviar "
        "de novo; arquivos OFX, CSV e planilhas continuam funcionando."
    ),
}


@dataclass(frozen=True)
class UsageStatus:
    used: int
    limit: int
    resets_at: datetime

    @property
    def remaining(self) -> int:
        return max(self.limit - self.used, 0)


def _daily_limit(kind: LimitKind) -> int:
    settings = get_settings()
    if kind == LimitKind.QUESTION:
        return settings.ai_daily_question_limit
    return settings.ai_daily_extraction_limit


def _resets_at() -> datetime:
    """Meia-noite de amanhã em Brasília."""
    tomorrow = clock.today() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=clock.SAO_PAULO)


async def get_status(session: AsyncSession, user_id: uuid.UUID, kind: LimitKind) -> UsageStatus:
    used = await AiUsageRepository(session).count_toward_limit(
        user_id, tasks=_TASKS[kind], usage_date=clock.today()
    )
    return UsageStatus(used=used, limit=_daily_limit(kind), resets_at=_resets_at())


async def check_limit(session: AsyncSession, user_id: uuid.UUID, kind: LimitKind) -> None:
    """Levanta `AiLimitReached`, com o horário em que o limite zera, se o dia já esgotou."""
    status = await get_status(session, user_id, kind)
    if status.remaining == 0:
        raise AiLimitReached(_MESSAGES[kind], details={"resets_at": status.resets_at.isoformat()})


async def record_usage(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    task: AiTask,
    model: str,
    usage: LLMUsage,
    counts_toward_limit: bool,
) -> None:
    """Grava uma chamada ao provedor. Só uma linha por pergunta ou extração conta no limite."""
    await AiUsageRepository(session).record(
        user_id,
        task=task,
        model=model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        counts_toward_limit=counts_toward_limit,
        usage_date=clock.today(),
    )

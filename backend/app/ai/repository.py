"""Único ponto de acesso à tabela `ai_usage`. Todo método exige `user_id`."""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.models import AiTask, AiUsage


class AiUsageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record(
        self,
        user_id: uuid.UUID,
        *,
        task: AiTask,
        model: str,
        input_tokens: int,
        output_tokens: int,
        counts_toward_limit: bool,
        usage_date: date,
    ) -> AiUsage:
        usage = AiUsage(
            user_id=user_id,
            task=task,
            model=model[:100],
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            counts_toward_limit=counts_toward_limit,
            usage_date=usage_date,
        )
        self._session.add(usage)
        await self._session.flush()
        return usage

    async def count_toward_limit(
        self, user_id: uuid.UUID, *, tasks: Sequence[AiTask], usage_date: date
    ) -> int:
        result = await self._session.execute(
            select(func.count())
            .select_from(AiUsage)
            .where(
                AiUsage.user_id == user_id,
                AiUsage.usage_date == usage_date,
                AiUsage.task.in_(tasks),
                AiUsage.counts_toward_limit.is_(True),
            )
        )
        return result.scalar_one()

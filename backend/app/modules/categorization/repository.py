"""Acesso ao banco para as regras de categorização. Todo método exige `user_id`."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categorization.models import CategorizationRule, RuleSource


class CategorizationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(
        self, user_id: uuid.UUID, description_normalized: str
    ) -> CategorizationRule | None:
        result = await self._session.execute(
            select(CategorizationRule).where(
                CategorizationRule.user_id == user_id,
                CategorizationRule.description_normalized == description_normalized,
            )
        )
        return result.scalar_one_or_none()

    async def find(
        self, user_id: uuid.UUID, descriptions: Sequence[str]
    ) -> dict[str, CategorizationRule]:
        """As regras do usuário para estas descrições normalizadas, pela descrição."""
        if not descriptions:
            return {}
        result = await self._session.execute(
            select(CategorizationRule).where(
                CategorizationRule.user_id == user_id,
                CategorizationRule.description_normalized.in_(descriptions),
            )
        )
        return {rule.description_normalized: rule for rule in result.scalars()}

    async def list_all(self, user_id: uuid.UUID) -> list[CategorizationRule]:
        result = await self._session.execute(
            select(CategorizationRule)
            .where(CategorizationRule.user_id == user_id)
            .order_by(CategorizationRule.description_normalized)
        )
        return list(result.scalars())

    async def save_user_rule(
        self, user_id: uuid.UUID, *, description_normalized: str, category_id: uuid.UUID
    ) -> None:
        """Grava a escolha do usuário; se a descrição já tem regra, ela passa a ser esta."""
        await self._upsert(user_id, description_normalized, category_id, RuleSource.USER)

    async def cache_ai_rule(
        self, user_id: uuid.UUID, *, description_normalized: str, category_id: uuid.UUID
    ) -> None:
        """Guarda a sugestão da IA. Uma regra do usuário nunca é substituída por ela (FR-048)."""
        await self._upsert(user_id, description_normalized, category_id, RuleSource.AI)

    async def _upsert(
        self,
        user_id: uuid.UUID,
        description_normalized: str,
        category_id: uuid.UUID,
        source: RuleSource,
    ) -> None:
        statement = insert(CategorizationRule).values(
            user_id=user_id,
            description_normalized=description_normalized,
            category_id=category_id,
            source=source,
        )
        await self._session.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    CategorizationRule.user_id,
                    CategorizationRule.description_normalized,
                ],
                set_={"category_id": category_id, "source": source, "updated_at": func.now()},
                where=(
                    CategorizationRule.source == RuleSource.AI if source == RuleSource.AI else None
                ),
            )
        )

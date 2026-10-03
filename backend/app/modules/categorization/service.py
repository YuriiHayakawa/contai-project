"""Sugestão de categoria e aprendizado com as correções do usuário (FR-047, FR-048).

A sugestão segue uma ordem fixa (research.md, seção 15): a regra do usuário para a descrição
normalizada; a sugestão da IA já guardada; um lote à IA só com as descrições que sobraram e a
lista de categorias; e, para o que a IA não resolver, "Outros". A IA só vê descrições
normalizadas e nomes de categorias: nunca valores, datas ou contas.
"""

import logging
import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import factory as ai_factory
from app.ai import usage as ai_usage
from app.ai.models import AiTask
from app.ai.provider import LLMError
from app.core.config import get_settings
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.models import RuleSource
from app.modules.categorization.repository import CategorizationRepository

logger = logging.getLogger("contai.categorization")

PROMPT_PATH = Path(__file__).parent / "prompts" / "categorize_v1.md"
# Descrições por pedido à IA, e quantos pedidos uma importação pode fazer. O que passar disso
# fica em "Outros": a cota gratuita do provedor é de todos os usuários.
BATCH_SIZE = 150
MAX_BATCHES = 4

_KIND_LABELS = {CategoryKind.EXPENSE: "despesa", CategoryKind.INCOME: "receita"}


class SuggestionSource(StrEnum):
    USER_RULE = "user_rule"
    AI = "ai"
    FALLBACK = "fallback"


@dataclass(frozen=True)
class Line:
    """O que se sabe de um lançamento para sugerir a categoria dele."""

    description_normalized: str
    kind: CategoryKind


@dataclass(frozen=True)
class Suggestion:
    category_id: uuid.UUID
    source: SuggestionSource


class CategoryAssignment(BaseModel):
    """A categoria escolhida para uma descrição, pelos números das duas listas."""

    description: int
    category: int


class CategorizationAnswer(BaseModel):
    assignments: list[CategoryAssignment]


@cache
def system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def build_prompt(categories: Sequence[tuple[CategoryKind, str]], lines: Sequence[Line]) -> str:
    """As duas listas numeradas que o prompt de sistema descreve."""
    listed_categories = [
        f"{index} | {_KIND_LABELS[kind]} | {name}" for index, (kind, name) in enumerate(categories)
    ]
    listed_lines = [
        f"{index} | {_KIND_LABELS[line.kind]} | {line.description_normalized}"
        for index, line in enumerate(lines)
    ]
    return "\n".join(["Categorias:", *listed_categories, "", "Descrições:", *listed_lines])


def category_paths(categories: Sequence[Category]) -> list[tuple[Category, str]]:
    """As categorias com o nome completo, `Categoria > Subcategoria`, em ordem estável."""
    by_id = {category.id: category for category in categories}
    named: list[tuple[Category, str]] = []
    for category in categories:
        parent = by_id.get(category.parent_id) if category.parent_id else None
        named.append((category, f"{parent.name} > {category.name}" if parent else category.name))
    return sorted(named, key=lambda pair: (pair[0].kind, pair[1].casefold(), str(pair[0].id)))


class CategorizationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._rules = CategorizationRepository(session)
        self._categories = CategoryRepository(session)

    # ---------- aprendizado

    async def learn(
        self, user_id: uuid.UUID, *, description_normalized: str, category_id: uuid.UUID
    ) -> None:
        """Guarda a categoria que o usuário escolheu para esta descrição.

        As próximas transações com a mesma descrição normalizada vêm com ela, e a IA nunca a
        substitui. Uma descrição só de números não tem o que aprender.
        """
        if description_normalized:
            await self._rules.save_user_rule(
                user_id, description_normalized=description_normalized, category_id=category_id
            )

    # ---------- sugestão

    async def suggest(self, user_id: uuid.UUID, lines: Sequence[Line]) -> list[Suggestion | None]:
        """A categoria sugerida para cada linha, na mesma ordem.

        `None` só quando o usuário não tem a categoria "Outros" do tipo da linha.
        """
        categories = await self._categories.list_all(user_id)
        active = {category.id: category for category in categories}
        fallback = {
            CategoryKind(category.kind): category.id
            for category in categories
            if category.is_fallback
        }
        rules = await self._rules.find(
            user_id, sorted({line.description_normalized for line in lines})
        )

        found: dict[Line, Suggestion] = {}
        for line in dict.fromkeys(lines):
            rule = rules.get(line.description_normalized)
            category = active.get(rule.category_id) if rule is not None else None
            # Regra de categoria arquivada ou de outro tipo não vale para esta linha.
            if rule is not None and category is not None and category.kind == line.kind:
                source = (
                    SuggestionSource.USER_RULE
                    if rule.source == RuleSource.USER
                    else SuggestionSource.AI
                )
                found[line] = Suggestion(category_id=category.id, source=source)

        found.update(await self._ask_ai(user_id, self._to_ask(lines, found), categories))

        def resolve(line: Line) -> Suggestion | None:
            if line in found:
                return found[line]
            category_id = fallback.get(line.kind)
            if category_id is None:
                return None
            return Suggestion(category_id=category_id, source=SuggestionSource.FALLBACK)

        return [resolve(line) for line in lines]

    @staticmethod
    def _to_ask(lines: Sequence[Line], found: dict[Line, Suggestion]) -> list[Line]:
        """As descrições que vão à IA: cada descrição normalizada uma vez só.

        A resposta vale para todas as linhas iguais. A descrição que aparece nos dois tipos,
        como uma compra e o estorno dela, vai com o tipo em que mais aparece, e a do outro tipo
        fica em "Outros": a regra guardada é uma por descrição. Descrição que já tem regra
        válida, ou que é só de números, não vai.
        """
        covered = {line.description_normalized for line in found}
        kinds: dict[str, Counter[CategoryKind]] = {}
        for line in lines:
            description = line.description_normalized
            if description and description not in covered:
                kinds.setdefault(description, Counter())[line.kind] += 1
        return [
            Line(description_normalized=description, kind=counts.most_common(1)[0][0])
            for description, counts in kinds.items()
        ]

    async def _ask_ai(
        self, user_id: uuid.UUID, lines: Sequence[Line], categories: Sequence[Category]
    ) -> dict[Line, Suggestion]:
        """Pede à IA a categoria das descrições sem regra, em lotes, e guarda as respostas."""
        answered: dict[Line, Suggestion] = {}
        if not lines or not categories:
            return answered
        named = category_paths(categories)
        listed = [(CategoryKind(category.kind), name) for category, name in named]
        model = get_settings().ai_model_chat
        provider = ai_factory.get_provider()

        batches = [lines[start : start + BATCH_SIZE] for start in range(0, len(lines), BATCH_SIZE)]
        for batch in batches[:MAX_BATCHES]:
            try:
                result = await provider.generate_structured(
                    model=model,
                    system=system_prompt(),
                    prompt=build_prompt(listed, batch),
                    schema=CategorizationAnswer,
                )
            except LLMError as error:
                # Sem IA a importação segue: o que faltou fica em "Outros".
                logger.warning("categorization skipped", extra={"error_code": type(error).__name__})
                break
            await ai_usage.record_usage(
                self._session,
                user_id,
                task=AiTask.CATEGORIZATION,
                model=model,
                usage=result.usage,
                counts_toward_limit=False,
            )
            for assignment in result.value.assignments:
                # Número fora da lista, repetido ou de categoria de outro tipo é descartado.
                if not 0 <= assignment.description < len(batch):
                    continue
                if not 0 <= assignment.category < len(named):
                    continue
                line = batch[assignment.description]
                category = named[assignment.category][0]
                if line in answered or category.kind != line.kind:
                    continue
                answered[line] = Suggestion(category_id=category.id, source=SuggestionSource.AI)
                await self._rules.cache_ai_rule(
                    user_id,
                    description_normalized=line.description_normalized,
                    category_id=category.id,
                )
        return answered

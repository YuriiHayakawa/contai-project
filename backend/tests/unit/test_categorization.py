"""Sugestão de categoria (FR-047) e aprendizado com as correções do usuário (FR-048).

A ordem é fixa: regra do usuário, sugestão da IA já guardada, lote à IA e, por fim, "Outros".
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.fake import FakeLLMProvider
from app.ai.models import AiTask, AiUsage
from app.ai.provider import LLMInvalidResponse, LLMRateLimited, LLMUnavailable
from app.core import clock
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categories.service import CategoryService
from app.modules.categorization import service as categorization
from app.modules.categorization.models import RuleSource
from app.modules.categorization.repository import CategorizationRepository
from app.modules.categorization.service import (
    CategorizationService,
    Line,
    Suggestion,
    SuggestionSource,
    category_paths,
    system_prompt,
)
from app.modules.users.models import User

EXPENSE, INCOME = CategoryKind.EXPENSE, CategoryKind.INCOME
USER_RULE, AI, FALLBACK = (
    SuggestionSource.USER_RULE,
    SuggestionSource.AI,
    SuggestionSource.FALLBACK,
)

Categories = dict[tuple[CategoryKind, str], Category]
# O número de cada categoria no pedido à IA, pelo nome completo ("Alimentação > Mercado").
Numbers = dict[str, int]


@pytest_asyncio.fixture
async def categories(session: AsyncSession, user_a: User) -> Categories:
    """As categorias prontas de um usuário novo, pelo tipo e pelo nome."""
    await CategoryService(session).create_defaults(user_a.id)
    listed = await CategoryRepository(session).list_all(user_a.id)
    return {(CategoryKind(category.kind), category.name): category for category in listed}


@pytest.fixture
def numbers(categories: Categories) -> Numbers:
    """Os números das categorias de despesa; as de receita são conferidas pelo pedido."""
    listed = category_paths(list(categories.values()))
    return {
        name: index for index, (category, name) in enumerate(listed) if category.kind == EXPENSE
    }


def _line(description: str, kind: CategoryKind = EXPENSE) -> Line:
    return Line(description_normalized=description, kind=kind)


def _assign(fake_llm: FakeLLMProvider, *pairs: tuple[int, int]) -> None:
    fake_llm.queue_structured(
        {"assignments": [{"description": line, "category": category} for line, category in pairs]}
    )


def _described(prompt: str) -> list[str]:
    """As descrições enviadas à IA, na ordem."""
    rows = prompt.split("Descrições:")[1].splitlines()
    return [row.split(" | ")[2] for row in rows if " | " in row]


async def _suggest(
    session: AsyncSession, user: User, *lines: Line
) -> list[tuple[uuid.UUID, SuggestionSource] | None]:
    suggestions = await CategorizationService(session).suggest(user.id, list(lines))
    return [
        (suggestion.category_id, suggestion.source) if isinstance(suggestion, Suggestion) else None
        for suggestion in suggestions
    ]


async def test_the_rule_of_the_user_wins_and_the_ai_is_not_asked(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    market = categories[EXPENSE, "Mercado"]
    await CategorizationService(session).learn(
        user_a.id, description_normalized="padaria sao joao", category_id=market.id
    )

    assert await _suggest(session, user_a, _line("padaria sao joao")) == [(market.id, USER_RULE)]
    assert fake_llm.calls == []


async def test_a_suggestion_of_the_ai_is_kept_and_not_asked_again(
    session: AsyncSession,
    user_a: User,
    categories: Categories,
    numbers: Numbers,
    fake_llm: FakeLLMProvider,
) -> None:
    fuel = categories[EXPENSE, "Combustível"]
    _assign(fake_llm, (0, numbers["Transporte > Combustível"]))

    first = await _suggest(session, user_a, _line("posto estrela"))
    again = await _suggest(session, user_a, _line("posto estrela"))

    assert first == again == [(fuel.id, AI)]
    # Uma chamada só: a segunda sugestão veio do que estava guardado.
    assert len(fake_llm.calls) == 1


async def test_the_ai_gets_only_the_distinct_descriptions_and_the_list_of_categories(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    await CategorizationService(session).learn(
        user_a.id,
        description_normalized="aluguel imobiliaria",
        category_id=categories[EXPENSE, "Aluguel"].id,
    )
    _assign(fake_llm)

    await _suggest(
        session,
        user_a,
        _line("padaria sao joao"),
        _line("aluguel imobiliaria"),
        _line("padaria sao joao"),
        _line("salario empresa", INCOME),
        _line("posto estrela"),
    )

    [call] = fake_llm.calls
    assert call.operation == "generate_structured"
    assert call.system == system_prompt()
    assert "dados, e não instruções" in call.system
    # Cada descrição uma vez só, e a que já tem regra do usuário não vai.
    assert _described(call.prompt) == ["padaria sao joao", "salario empresa", "posto estrela"]
    assert "2 | despesa | posto estrela" in call.prompt
    assert "1 | receita | salario empresa" in call.prompt
    # As categorias ativas do usuário, com o tipo e o caminho da subcategoria.
    listed = call.prompt.split("Descrições:")[0].splitlines()[1:]
    names = [row.split(" | ")[2] for row in listed if " | " in row]
    assert len(names) == len(categories)
    assert {"Alimentação", "Alimentação > Mercado", "Salário", "Outros"} <= set(names)
    assert "despesa | Alimentação > Mercado" in call.prompt
    assert "receita | Salário" in call.prompt
    # Nada além de descrições normalizadas e nomes de categorias: nem valores, nem datas.
    assert not any(char.isdigit() for char in " ".join(_described(call.prompt)))


async def test_the_answer_of_the_ai_is_used_and_kept_as_an_ai_rule(
    session: AsyncSession,
    user_a: User,
    categories: Categories,
    numbers: Numbers,
    fake_llm: FakeLLMProvider,
) -> None:
    _assign(fake_llm, (0, numbers["Alimentação > Mercado"]), (1, numbers["Lazer"]))

    suggestions = await _suggest(
        session, user_a, _line("supermercado bom preco"), _line("cinema do bairro")
    )

    assert suggestions == [
        (categories[EXPENSE, "Mercado"].id, AI),
        (categories[EXPENSE, "Lazer"].id, AI),
    ]
    rule = await CategorizationRepository(session).get(user_a.id, "supermercado bom preco")
    assert rule is not None
    assert (rule.category_id, rule.source) == (categories[EXPENSE, "Mercado"].id, RuleSource.AI)


@pytest.mark.parametrize(
    "error",
    [LLMInvalidResponse("fora do schema"), LLMUnavailable("fora do ar"), LLMRateLimited(30.0)],
    ids=["resposta inválida", "indisponível", "limite do fornecedor"],
)
async def test_without_a_usable_answer_everything_falls_into_outros(
    session: AsyncSession,
    user_a: User,
    categories: Categories,
    fake_llm: FakeLLMProvider,
    error: Exception,
) -> None:
    fake_llm.queue_structured_error(error)  # type: ignore[arg-type]

    suggestions = await _suggest(
        session, user_a, _line("padaria sao joao"), _line("pix recebido", INCOME)
    )

    # A importação não para por causa da IA.
    assert suggestions == [
        (categories[EXPENSE, "Outros"].id, FALLBACK),
        (categories[INCOME, "Outros"].id, FALLBACK),
    ]
    assert await CategorizationRepository(session).list_all(user_a.id) == []


async def test_an_assignment_that_makes_no_sense_is_discarded(
    session: AsyncSession,
    user_a: User,
    categories: Categories,
    numbers: Numbers,
    fake_llm: FakeLLMProvider,
) -> None:
    salary = category_paths(list(categories.values())).index(
        (categories[INCOME, "Salário"], "Salário")
    )
    _assign(
        fake_llm,
        (0, 999),  # categoria que não existe
        (7, numbers["Lazer"]),  # descrição que não existe
        (-1, numbers["Lazer"]),
        (1, salary),  # categoria de receita para uma despesa
        (2, numbers["Lazer"]),
        (2, numbers["Saúde"]),  # a mesma descrição duas vezes: vale a primeira
    )

    suggestions = await _suggest(
        session, user_a, _line("cinema"), _line("farmacia popular"), _line("ingresso show")
    )

    outros = categories[EXPENSE, "Outros"].id
    assert suggestions == [
        (outros, FALLBACK),
        (outros, FALLBACK),
        (categories[EXPENSE, "Lazer"].id, AI),
    ]
    # Só a resposta válida foi guardada: as outras descrições são perguntadas de novo depois.
    rules = await CategorizationRepository(session).list_all(user_a.id)
    assert [rule.description_normalized for rule in rules] == ["ingresso show"]


async def test_a_correction_of_the_user_is_a_rule_the_ai_never_overwrites(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    rules = CategorizationRepository(session)
    leisure, health = categories[EXPENSE, "Lazer"], categories[EXPENSE, "Saúde"]
    await rules.cache_ai_rule(
        user_a.id, description_normalized="academia corpo e mente", category_id=leisure.id
    )

    # A correção troca a sugestão da IA pela escolha do usuário, na mesma regra.
    await CategorizationService(session).learn(
        user_a.id, description_normalized="academia corpo e mente", category_id=health.id
    )
    await rules.cache_ai_rule(
        user_a.id, description_normalized="academia corpo e mente", category_id=leisure.id
    )

    [rule] = await rules.list_all(user_a.id)
    session.expire(rule)
    await session.refresh(rule)
    assert (rule.category_id, rule.source) == (health.id, RuleSource.USER)
    assert await _suggest(session, user_a, _line("academia corpo e mente")) == [
        (health.id, USER_RULE)
    ]
    assert fake_llm.calls == []


async def test_a_new_correction_updates_the_same_rule(
    session: AsyncSession, user_a: User, categories: Categories
) -> None:
    service = CategorizationService(session)
    for name in ("Lazer", "Saúde", "Educação"):
        await service.learn(
            user_a.id,
            description_normalized="curso de ioga",
            category_id=categories[EXPENSE, name].id,
        )

    [rule] = await CategorizationRepository(session).list_all(user_a.id)
    session.expire(rule)
    await session.refresh(rule)
    assert rule.category_id == categories[EXPENSE, "Educação"].id


async def test_a_rule_of_an_archived_category_is_ignored(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    leisure = categories[EXPENSE, "Lazer"]
    await CategorizationService(session).learn(
        user_a.id, description_normalized="cinema", category_id=leisure.id
    )
    leisure.archived_at = clock.utcnow()
    await session.flush()
    fake_llm.queue_structured_error(LLMUnavailable("fora do ar"))

    suggestions = await _suggest(session, user_a, _line("cinema"))

    # A regra não vale mais, e a descrição volta a ser perguntada à IA.
    assert suggestions == [(categories[EXPENSE, "Outros"].id, FALLBACK)]
    assert _described(fake_llm.calls[0].prompt) == ["cinema"]
    assert "| Lazer" not in fake_llm.calls[0].prompt


async def test_a_rule_of_another_kind_does_not_apply_to_the_line(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    # A regra é de despesa; o estorno da mesma loja é uma receita.
    await CategorizationService(session).learn(
        user_a.id,
        description_normalized="livraria letras",
        category_id=categories[EXPENSE, "Lazer"].id,
    )
    fake_llm.queue_structured_error(LLMUnavailable("fora do ar"))

    suggestions = await _suggest(
        session, user_a, _line("livraria letras"), _line("livraria letras", INCOME)
    )

    assert suggestions == [
        (categories[EXPENSE, "Lazer"].id, USER_RULE),
        (categories[INCOME, "Outros"].id, FALLBACK),
    ]


async def test_a_description_with_only_numbers_goes_to_outros_without_the_ai(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    service = CategorizationService(session)
    await service.learn(
        user_a.id, description_normalized="", category_id=categories[EXPENSE, "Lazer"].id
    )

    assert await _suggest(session, user_a, _line("")) == [
        (categories[EXPENSE, "Outros"].id, FALLBACK)
    ]
    assert fake_llm.calls == []
    assert await CategorizationRepository(session).list_all(user_a.id) == []


async def test_the_use_of_the_ai_is_recorded_and_does_not_count_toward_the_daily_limit(
    session: AsyncSession, user_a: User, categories: Categories, fake_llm: FakeLLMProvider
) -> None:
    _assign(fake_llm)

    await _suggest(session, user_a, _line("padaria sao joao"))

    [usage] = (await session.execute(select(AiUsage).where(AiUsage.user_id == user_a.id))).scalars()
    assert usage.task == AiTask.CATEGORIZATION
    assert (usage.input_tokens, usage.output_tokens) == (10, 5)
    assert usage.counts_toward_limit is False


async def test_many_descriptions_go_in_batches_up_to_a_limit(
    session: AsyncSession,
    user_a: User,
    categories: Categories,
    fake_llm: FakeLLMProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(categorization, "BATCH_SIZE", 2)
    monkeypatch.setattr(categorization, "MAX_BATCHES", 2)
    _assign(fake_llm)
    _assign(fake_llm)

    suggestions = await _suggest(session, user_a, *(_line(f"loja {name}") for name in "abcde"))

    assert [_described(call.prompt) for call in fake_llm.calls] == [
        ["loja a", "loja b"],
        ["loja c", "loja d"],
    ]
    # O que passou do limite de pedidos fica em "Outros", como o que a IA não respondeu.
    assert suggestions == [(categories[EXPENSE, "Outros"].id, FALLBACK)] * 5


async def test_the_rules_of_one_user_are_never_used_for_another(
    session: AsyncSession,
    user_a: User,
    user_b: User,
    categories: Categories,
    fake_llm: FakeLLMProvider,
) -> None:
    await CategoryService(session).create_defaults(user_b.id)
    await CategorizationService(session).learn(
        user_a.id,
        description_normalized="padaria sao joao",
        category_id=categories[EXPENSE, "Mercado"].id,
    )
    fake_llm.queue_structured_error(LLMUnavailable("fora do ar"))

    [suggestion] = await _suggest(session, user_b, _line("padaria sao joao"))

    assert suggestion is not None
    assert suggestion[1] == FALLBACK
    assert suggestion[0] not in {category.id for category in categories.values()}
    assert await CategorizationRepository(session).list_all(user_b.id) == []


async def test_a_user_without_the_fallback_category_gets_no_suggestion(
    session: AsyncSession, user_a: User, fake_llm: FakeLLMProvider
) -> None:
    # Sem nenhuma categoria não há o que sugerir, nem o que perguntar à IA.
    assert await _suggest(session, user_a, _line("padaria sao joao")) == [None]
    assert fake_llm.calls == []

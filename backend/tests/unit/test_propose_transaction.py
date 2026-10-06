"""`propose_transaction`: o lançamento por texto (FR-066, FR-067).

O modelo só diz o que entendeu da frase. O backend converte o valor, resolve a data em
Brasília e procura a conta e a categoria entre as do usuário: a categoria, primeiro nas regras
que ele já ensinou; a conta, na última usada quando a frase não diz qual. Nada é gravado.
"""

import datetime as dt
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.fake import FakeLLMProvider
from app.core import clock
from app.modules.assistant import tools
from app.modules.assistant.tools.base import ToolContext, ToolResult
from app.modules.categorization.repository import CategorizationRepository
from app.modules.transactions.models import Transaction
from app.modules.users.models import User
from tests.assistant import Finances, seed_finances
from tests.finance import create_account, create_category, create_transaction

pytestmark = pytest.mark.usefixtures("frozen_time")

TODAY = dt.date(2026, 10, 1)
NBSP = "\N{NO-BREAK SPACE}"


@pytest_asyncio.fixture
async def finances(client_a: AsyncClient) -> Finances:
    return await seed_finances(client_a)


@pytest.fixture
def context(session: AsyncSession, user_a: User) -> ToolContext:
    return ToolContext(session=session, user_id=user_a.id, today=TODAY)


async def _propose(context: ToolContext, **arguments: Any) -> ToolResult:
    return await tools.execute(
        context,
        "propose_transaction",
        {"type": "expense", "amount": "45", "description": "iFood", **arguments},
    )


async def _proposal(context: ToolContext, **arguments: Any) -> dict[str, Any]:
    result = await _propose(context, **arguments)
    assert not result.is_error, result.data
    assert result.proposal is not None
    return result.proposal


# ---------- valor


@pytest.mark.parametrize(
    ("written", "cents"),
    [
        ("45", 4_500),
        ("45,90", 4_590),
        ("45,9", 4_590),
        ("32,50", 3_250),
        ("1.234,56", 123_456),
        ("R$ 45,90", 4_590),
        # Em ponto flutuante, 0,29 vezes 100 dá 28,999…, e 1,15 vezes 100 dá 114,999…
        ("0,29", 29),
        ("1,15", 115),
    ],
)
async def test_the_written_amount_becomes_cents_exactly(
    context: ToolContext, finances: Finances, written: str, cents: int
) -> None:
    result = await _propose(context, amount=written)

    assert result.proposal is not None
    assert result.proposal["amount_cents"] == cents
    assert result.data["proposal"]["amount"]["cents"] == cents


@pytest.mark.parametrize("written", ["quarenta e cinco", "0", "45,999", "-45"])
async def test_what_is_not_a_value_goes_back_to_the_model_as_a_described_error(
    context: ToolContext, finances: Finances, written: str
) -> None:
    result = await _propose(context, amount=written)

    assert result.is_error and result.proposal is None
    assert f'Não entendi o valor "{written}"' in result.data["error"]


async def test_a_phrase_without_a_value_tells_what_is_missing(
    context: ToolContext, finances: Finances
) -> None:
    result = await tools.execute(
        context, "propose_transaction", {"type": "expense", "description": "iFood"}
    )

    assert result.is_error and result.proposal is None
    assert result.data["missing"] == ["amount"]
    assert "pergunte à pessoa qual foi o valor" in result.data["error"]


# ---------- data


async def test_today_yesterday_and_an_explicit_date_are_resolved_in_brasilia(
    session: AsyncSession, user_a: User, finances: Finances
) -> None:
    # Em UTC já é dia 2; em Brasília ainda são 22h30 do dia 1º.
    clock.set_fixed_time(datetime(2026, 10, 2, 1, 30, tzinfo=UTC))
    context = ToolContext(session=session, user_id=user_a.id, today=clock.today())

    dates = {
        reference: (await _proposal(context, date_reference=reference))["date"]
        for reference in ("today", "yesterday", "2026-09-15", "03/10", "28/12/2025")
    }
    without_date = await _proposal(context)

    assert dates == {
        "today": "2026-10-01",
        "yesterday": "2026-09-30",
        "2026-09-15": "2026-09-15",
        # Dia e mês sem ano: o ano de hoje.
        "03/10": "2026-10-03",
        "28/12/2025": "2025-12-28",
    }
    assert without_date["date"] == "2026-10-01"


@pytest.mark.parametrize("reference", ["sexta", "31/02", "2026-13-01"])
async def test_a_date_that_cannot_be_read_goes_back_to_the_model(
    context: ToolContext, finances: Finances, reference: str
) -> None:
    result = await _propose(context, date_reference=reference)

    assert result.is_error and result.proposal is None
    assert f'Não entendi a data "{reference}"' in result.data["error"]


# ---------- conta


async def test_the_account_comes_from_what_the_phrase_says(
    context: ToolContext, finances: Finances
) -> None:
    chosen = {
        hint: (await _proposal(context, account_hint=hint))["account_id"]
        for hint in (
            "cartão",
            "no cartão de crédito",
            "Cartão Verde",
            "poupança",
            "conta corrente",
            "débito",
            "cartão de débito",
            "pix",
        )
    }

    card, savings, checking = (
        finances.card["id"],
        finances.savings["id"],
        finances.checking["id"],
    )
    assert chosen == {
        "cartão": card,
        "no cartão de crédito": card,
        "Cartão Verde": card,
        "poupança": savings,
        "conta corrente": checking,
        "débito": checking,
        "cartão de débito": checking,
        "pix": checking,
    }


async def test_an_account_found_by_the_name_of_the_bank(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    bank = await create_account(client_a, name="Conta Roxa", institution="Nubank")
    bank_card = await create_account(
        client_a,
        name="Cartão Roxo",
        type="credit_card",
        institution="Nubank",
        closing_day=3,
        due_day=10,
    )

    # "Nubank" serve à conta e ao cartão: fica em aberto. Com o tipo, é um só.
    assert (await _proposal(context, account_hint="nubank"))["account_id"] is None
    assert (await _proposal(context, account_hint="conta do nubank"))["account_id"] == bank["id"]
    assert (await _proposal(context, account_hint="cartão nubank"))["account_id"] == bank_card["id"]


async def test_two_cards_leave_the_account_for_the_user_to_choose(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    blue = await create_account(
        client_a, name="Cartão Azul", type="credit_card", closing_day=5, due_day=12
    )

    result = await _propose(context, account_hint="cartão", category_hint="Alimentação")

    assert result.proposal is not None
    assert result.proposal["account_id"] is None
    assert result.data["missing"] == ["account"]
    assert result.summary == (
        "Preparei o lançamento, mas não sei em qual conta ele entra: você escolhe ao ajustar."
    )
    # Dizendo qual dos dois, a conta vem preenchida.
    assert (await _proposal(context, account_hint="cartão azul"))["account_id"] == blue["id"]


async def test_an_account_that_the_user_does_not_have_stays_open(
    context: ToolContext, finances: Finances
) -> None:
    result = await _propose(context, account_hint="banco laranja", category_hint="Alimentação")

    assert result.proposal is not None and result.proposal["account_id"] is None
    assert result.data["missing"] == ["account"]


async def test_without_an_account_in_the_phrase_the_last_used_one_is_proposed(
    context: ToolContext, finances: Finances, client_a: AsyncClient, frozen_time: datetime
) -> None:
    clock.set_fixed_time(frozen_time + timedelta(minutes=1))
    await create_transaction(client_a, finances.savings, finances.food, description="Feira")

    assert (await _proposal(context))["account_id"] == finances.savings["id"]

    clock.set_fixed_time(frozen_time + timedelta(minutes=2))
    await create_transaction(client_a, finances.card, finances.food, description="Padaria")

    assert (await _proposal(context))["account_id"] == finances.card["id"]
    # Um recebimento não entra em cartão: vale a última conta usada que não é cartão.
    income = await _proposal(context, type="income", description="Freela")
    assert income["account_id"] == finances.savings["id"]


async def test_a_hint_that_only_repeats_the_description_is_not_an_account(
    context: ToolContext, finances: Finances, client_a: AsyncClient, frozen_time: datetime
) -> None:
    clock.set_fixed_time(frozen_time + timedelta(minutes=1))
    await create_transaction(client_a, finances.savings, finances.food, description="Feira")

    # Em "recebi 200 de um freela", o modelo às vezes manda "freela" como conta. A frase não
    # disse conta nenhuma: vale a última usada.
    income = await _proposal(
        context, type="income", amount="200", description="Freela", account_hint="freela"
    )
    expense = await _proposal(context, description="Almoço no trabalho", account_hint="almoço")

    assert income["account_id"] == finances.savings["id"]
    assert expense["account_id"] == finances.savings["id"]


async def test_the_last_used_account_ignores_transfers_and_archived_accounts(
    context: ToolContext, finances: Finances, client_a: AsyncClient, frozen_time: datetime
) -> None:
    clock.set_fixed_time(frozen_time + timedelta(minutes=1))
    await create_transaction(client_a, finances.checking, finances.food, description="Feira")
    clock.set_fixed_time(frozen_time + timedelta(minutes=2))
    await create_transaction(client_a, finances.savings, finances.food, description="Padaria")
    clock.set_fixed_time(frozen_time + timedelta(minutes=3))
    transfer = await client_a.post(
        "/api/v1/transactions/transfers",
        json={
            "from_account_id": finances.checking["id"],
            "to_account_id": finances.card["id"],
            "amount_cents": 10_000,
            "date": "2026-10-01",
            "description": "Pagamento da fatura",
        },
    )
    assert transfer.status_code == 201, transfer.text

    assert (await _proposal(context))["account_id"] == finances.savings["id"]

    archived = await client_a.post(f"/api/v1/accounts/{finances.savings['id']}/archive")
    assert archived.status_code == 200, archived.text

    assert (await _proposal(context))["account_id"] == finances.checking["id"]


async def test_who_has_one_account_and_no_entries_gets_that_account(
    context: ToolContext, client_a: AsyncClient
) -> None:
    only = await create_account(client_a, name="Carteira", type="cash")

    assert (await _proposal(context))["account_id"] == only["id"]

    await create_account(client_a, name="Conta corrente")

    assert (await _proposal(context))["account_id"] is None


# ---------- categoria


async def test_a_rule_the_user_taught_comes_before_the_hint_of_the_model(
    context: ToolContext, finances: Finances, client_a: AsyncClient, fake_llm: FakeLLMProvider
) -> None:
    # Ao lançar "iFood" em Restaurante, o usuário ensinou a categoria dessa descrição (FR-048).
    await create_transaction(client_a, finances.checking, finances.restaurant, description="iFood")

    proposal = await _proposal(context, description="IFOOD", category_hint="Transporte")

    assert proposal["category_id"] == finances.restaurant["id"]
    assert proposal["category_source"] == "user_rule"
    # A regra basta: a IA não é consultada para a categoria.
    assert fake_llm.calls == []


async def test_without_a_rule_the_category_is_the_one_the_model_named(
    context: ToolContext, finances: Finances, fake_llm: FakeLLMProvider
) -> None:
    chosen = {
        hint: await _proposal(context, description="Lanche da tarde", category_hint=hint)
        for hint in ("Transporte", "Alimentação > Mercado", "mercado", "alimentacao")
    }

    assert {hint: proposal["category_id"] for hint, proposal in chosen.items()} == {
        "Transporte": finances.transport["id"],
        "Alimentação > Mercado": finances.market["id"],
        "mercado": finances.market["id"],
        "alimentacao": finances.food["id"],
    }
    assert {proposal["category_source"] for proposal in chosen.values()} == {"ai"}
    assert fake_llm.calls == []


async def test_a_category_that_does_not_fit_stays_open(
    context: ToolContext, finances: Finances, client_a: AsyncClient
) -> None:
    extra = await create_category(
        client_a, name="Renda extra", kind="income", icon="banknote", color="mata"
    )

    unknown = await _propose(context, description="Passagem", category_hint="Viagens")
    wrong_kind = await _proposal(context, description="Passagem", category_hint="Salário")
    without_hint = await _proposal(context, description="Passagem")
    income = await _proposal(
        context, type="income", description="Freela", category_hint="Renda extra"
    )

    assert unknown.proposal is not None and unknown.proposal["category_id"] is None
    assert unknown.data["missing"] == ["category"]
    assert unknown.summary == (
        "Preparei o lançamento, mas não encontrei uma categoria para ele: você escolhe ao ajustar."
    )
    # Uma categoria de receita não serve a um gasto.
    assert wrong_kind["category_id"] is None and wrong_kind["category_source"] is None
    assert without_hint["category_id"] is None
    assert (income["category_id"], income["category_source"]) == (extra["id"], "ai")


# ---------- a proposta


async def test_the_proposal_is_complete_and_nothing_is_recorded(
    context: ToolContext, finances: Finances, session: AsyncSession, user_a: User
) -> None:
    async def recorded() -> tuple[int, int]:
        transactions = await session.execute(select(func.count()).select_from(Transaction))
        rules = await CategorizationRepository(session).list_all(user_a.id)
        return int(transactions.scalar_one()), len(rules)

    before = await recorded()

    result = await _propose(
        context,
        amount="45",
        date_reference="yesterday",
        description="  iFood ",
        account_hint="cartão",
        category_hint="Alimentação > Restaurante",
    )

    assert result.proposal == {
        "type": "expense",
        "amount_cents": 4_500,
        "date": "2026-09-30",
        "description": "iFood",
        "account_id": finances.card["id"],
        "category_id": finances.restaurant["id"],
        "category_source": "ai",
        "status": "pending",
        "transaction_id": None,
    }
    assert result.summary == "Preparei o lançamento. Salve como está ou ajuste antes de salvar."
    assert result.data["missing"] == []
    assert result.data["proposal"] == {
        "type": "expense",
        "amount": {"cents": 4_500, "formatted": f"R${NBSP}45,00"},
        "date": "2026-09-30",
        "description": "iFood",
        "account": "Cartão Verde",
        "category": "Restaurante",
    }
    # Nem lançamento, nem regra de categoria: a proposta espera a conferência do usuário.
    assert await recorded() == before


async def test_the_accounts_and_categories_of_another_user_are_never_proposed(
    context: ToolContext, finances: Finances, client_b: AsyncClient
) -> None:
    other_account = await create_account(client_b, name="Reserva do vizinho")
    other_category = await create_category(client_b, name="Viagens")
    await create_transaction(client_b, other_account, other_category, description="iFood")

    by_name = await _proposal(context, account_hint="reserva do vizinho", category_hint="Viagens")

    assert (by_name["account_id"], by_name["category_id"]) == (None, None)

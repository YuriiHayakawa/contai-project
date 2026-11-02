"""Importação, da revisão em diante: categorias sugeridas, pagamento de fatura, correções
guardadas, conferência de saldo, confirmação, histórico, desfazer, descarte e expiração (FR-046
a FR-054, FR-081 a FR-083 e FR-085).
"""

import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.fake import FakeLLMProvider
from app.core import clock
from app.core.database import SessionFactory
from app.modules.categories.repository import CategoryRepository
from app.modules.categories.service import CategoryService
from app.modules.categorization.models import RuleSource
from app.modules.categorization.repository import CategorizationRepository
from app.modules.categorization.service import category_paths
from app.modules.imports.repository import ImportRepository
from app.modules.users.models import User
from app.worker import queue
from app.worker.jobs.cleanup import cleanup_imports
from app.worker.models import JobType
from tests.conftest import ClientFactory, JobRunner
from tests.finance import (
    ACCOUNTS,
    TRANSACTIONS,
    balance_of,
    create_account,
    create_transaction,
    list_transactions,
)
from tests.imports import (
    IMPORTS,
    confirm,
    decisions,
    fixture_bytes,
    get_import,
    saved_decisions,
    send_confirmation,
    send_item_update,
    stored_files,
    update_item,
    upload,
)

Json = dict[str, Any]

pytestmark = pytest.mark.usefixtures("frozen_time")

SUMMARY = "/api/v1/dashboard/summary"
CSV_MAPPING = {"date_column": 0, "description_column": 1, "amount_column": 3}
# Um extrato de três linhas, sem identificador do banco.
SMALL_CSV = (
    "Data;Descrição;Valor\n"
    "10/09/2026;Padaria São João;-45,90\n"
    "12/09/2026;Posto Estrela;-210,00\n"
    "15/09/2026;Salário;5.450,00\n"
).encode()
SMALL_MAPPING = {"date_column": 0, "description_column": 1, "amount_column": 2}


@pytest_asyncio.fixture
async def categories(session: AsyncSession, user_a: User) -> dict[str, str]:
    """As categorias prontas do usuário A: o id de cada uma, pelo tipo e pelo nome."""
    await CategoryService(session).create_defaults(user_a.id)
    await session.commit()
    listed = await CategoryRepository(session).list_all(user_a.id)
    return {f"{category.kind}:{category.name}": str(category.id) for category in listed}


@pytest_asyncio.fixture
async def checking(client_a: AsyncClient) -> Json:
    return await create_account(
        client_a,
        name="Conta corrente",
        initial_balance_cents=100_000,
        initial_balance_date="2026-10-01",
    )


@pytest_asyncio.fixture
async def card(client_a: AsyncClient) -> Json:
    return await create_account(
        client_a,
        name="Cartão Verde",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-80_000,
        initial_balance_date="2026-09-01",
    )


async def _review(
    client: AsyncClient, run_jobs: JobRunner, account: Json, name: str, content: bytes | None = None
) -> Json:
    """Envia o arquivo e devolve a importação já lida pelo worker."""
    sent = await upload(client, account, name, content)
    await run_jobs()
    return await get_import(client, sent)


async def _small_review(client: AsyncClient, run_jobs: JobRunner, account: Json) -> Json:
    """A revisão do extrato de três linhas, já com as colunas mapeadas."""
    record = await _review(client, run_jobs, account, "pequeno.csv", SMALL_CSV)
    if record["status"] == "awaiting_mapping":
        mapped = await client.post(f"{IMPORTS}/{record['id']}/mapping", json=SMALL_MAPPING)
        assert mapped.status_code == 202, mapped.text
        await run_jobs()
        record = await get_import(client, record)
    assert record["status"] == "awaiting_review", record
    return record


def _by_description(record: Json) -> dict[str, Json]:
    return {item["description"]: item for item in record["items"]}


def _decision(record: Json, line: str, /, **changes: object) -> list[Json]:
    """As decisões sugeridas, com mudanças na linha de uma descrição."""
    target = _by_description(record)[line]["id"]
    return [
        {**decision, **changes} if decision["id"] == target else decision
        for decision in decisions(record)
    ]


def _only(record: Json, description: str) -> list[Json]:
    """As decisões com só a linha desta descrição marcada."""
    target = _by_description(record)[description]["id"]
    return [{**decision, "selected": decision["id"] == target} for decision in decisions(record)]


def _field_errors(response: Any) -> dict[str, str]:
    assert response.status_code == 422, response.text
    fields: dict[str, str] = response.json()["error"]["details"]["fields"]
    return fields


async def _saved(client: AsyncClient, **filters: object) -> list[Json]:
    page = await list_transactions(client, limit=200, **filters)
    items: list[Json] = page["items"]
    return items


async def _month_totals(client: AsyncClient, month: str) -> tuple[int, int]:
    response = await client.get(SUMMARY, params={"month": month})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["income_cents"], body["expense_cents"]


# ---------- categorias sugeridas


async def test_every_proposed_line_comes_with_a_suggested_category(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    # Sem regra e sem resposta da IA, cada linha vem com o "Outros" do tipo dela.
    assert [(item["type"], item["suggested_category_id"]) for item in record["items"]] == [
        ("income", categories["income:Outros"]),
        ("expense", categories["expense:Outros"]),
        ("expense", categories["expense:Outros"]),
        ("expense", categories["expense:Outros"]),
        ("expense", categories["expense:Outros"]),
    ]
    assert {item["category_source"] for item in record["items"]} == {"fallback"}


async def test_the_ai_suggests_categories_from_the_descriptions_only(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    fake_llm: FakeLLMProvider,
    run_jobs: JobRunner,
) -> None:
    listed = category_paths(await CategoryRepository(session).list_all(user_a.id))
    numbers = {f"{category.kind}:{name}": index for index, (category, name) in enumerate(listed)}
    # As descrições distintas vão na ordem do arquivo: salário, padaria, mercado, tarifa, fatura.
    fake_llm.queue_structured(
        {
            "assignments": [
                {"description": 0, "category": numbers["income:Salário"]},
                {"description": 2, "category": numbers["expense:Alimentação > Mercado"]},
            ]
        }
    )

    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    lines = _by_description(record)
    salary, market = lines["SALÁRIO EMPRESA FICTÍCIA LTDA"], lines["SUPERMERCADO BOM PREÇO"]
    assert (salary["suggested_category_id"], salary["category_source"]) == (
        categories["income:Salário"],
        "ai",
    )
    assert (market["suggested_category_id"], market["category_source"]) == (
        categories["expense:Mercado"],
        "ai",
    )
    assert lines["PADARIA SÃO JOÃO"]["category_source"] == "fallback"
    # A IA recebeu as descrições normalizadas e os nomes das categorias; nenhum valor ou data.
    [call] = fake_llm.calls
    assert "padaria sao joao" in call.prompt
    assert "545" not in call.prompt and "2026" not in call.prompt


async def test_a_corrected_category_comes_already_corrected_in_the_next_import(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    first = await _small_review(client_a, run_jobs, checking)
    # O usuário corrige a categoria da padaria e aceita o resto como veio.
    await confirm(
        client_a,
        first,
        _decision(first, "Padaria São João", category_id=categories["expense:Mercado"]),
    )

    october = "Data;Descrição;Valor\n03/10/2026;PADARIA SAO JOAO 03/10;-12,00\n".encode()
    second = await _review(client_a, run_jobs, checking, "outubro.csv", october)

    [line] = second["items"]
    assert (line["suggested_category_id"], line["category_source"]) == (
        categories["expense:Mercado"],
        "user_rule",
    )
    # Só a correção virou regra: aceitar o "Outros" das outras linhas não ensina nada.
    rules = await CategorizationRepository(session).list_all(user_a.id)
    assert [(rule.description_normalized, rule.source) for rule in rules] == [
        ("padaria sao joao", RuleSource.USER)
    ]


async def test_a_refund_in_the_statement_comes_in_the_category_of_the_purchase(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    # O usuário já lançou uma compra nessa livraria em Educação: a regra existe.
    await CategorizationRepository(session).save_user_rule(
        user_a.id,
        description_normalized="livraria letras cia",
        category_id=uuid.UUID(categories["expense:Educação"]),
    )
    await session.commit()

    record = await _review(client_a, run_jobs, card, "cartao_verde.ofx")

    lines = _by_description(record)
    purchase, refund = lines["Livraria Letras & Cia"], lines["Estorno Livraria Letras & Cia"]
    education = categories["expense:Educação"]
    assert (purchase["type"], purchase["suggested_category_id"]) == ("expense", education)
    # O estorno é uma entrada, sugerida na categoria da compra, sem correção manual.
    assert (refund["type"], refund["suggested_category_id"], refund["category_source"]) == (
        "income",
        education,
        "user_rule",
    )

    await confirm(client_a, record)

    # Comprou e devolveu: nada em Educação, e o estorno não entra nas entradas do mês.
    by_category = (
        await client_a.get("/api/v1/dashboard/categories", params={"month": "2026-09"})
    ).json()
    assert [(item["name"], item["amount_cents"]) for item in by_category["items"]] == [
        ("Outros", 1_500)
    ]
    assert await _month_totals(client_a, "2026-09") == (0, 1_500)


# ---------- pagamento de fatura


async def test_an_invoice_payment_is_suggested_as_a_transfer_to_the_card(
    client_a: AsyncClient,
    checking: Json,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]
    assert (payment["type"], payment["transfer_direction"]) == ("transfer", "out")
    assert payment["suggested_counter_account_id"] == card["id"]
    # Com o cartão cadastrado não há o que avisar.
    assert all(item["warning_code"] is None for item in record["items"])
    # Transferência não tem categoria.
    assert (payment["suggested_category_id"], payment["category_source"]) == (None, None)
    others = [item for item in record["items"] if item["id"] != payment["id"]]
    assert all(item["type"] != "transfer" for item in others)
    assert all(item["suggested_counter_account_id"] is None for item in others)


async def test_without_a_card_the_payment_stays_as_an_expense(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]
    assert (payment["type"], payment["suggested_counter_account_id"]) == ("expense", None)
    assert payment["suggested_category_id"] == categories["expense:Outros"]
    assert payment["selected_by_default"] is True
    # A linha segue como despesa, com o aviso de que pode estar contando o gasto duas vezes.
    assert payment["warning_code"] == "invoice_payment_without_card"
    assert "cadastre o cartão" in payment["warning_message"]
    assert "marque esta linha como pagamento de fatura" in payment["warning_message"]
    assert "duas vezes" in payment["warning_message"]
    others = [item for item in record["items"] if item["id"] != payment["id"]]
    assert all((item["warning_code"], item["warning_message"]) == (None, None) for item in others)


async def test_after_registering_the_card_the_line_can_be_marked_as_an_invoice_payment(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    checking = await create_account(
        client_a, name="Conta de setembro", initial_balance_date="2026-09-01"
    )
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    # O aviso levou o usuário a cadastrar o cartão no meio da revisão.
    card = await create_account(
        client_a,
        name="Cartão Verde",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-80_000,
        initial_balance_date="2026-09-01",
    )

    await confirm(
        client_a,
        record,
        _decision(
            record,
            "PAGAMENTO FATURA CARTÃO",
            type="transfer",
            category_id=None,
            counter_account_id=card["id"],
        ),
    )

    # O pagamento virou transferência para o cartão e saiu das despesas do mês.
    assert await balance_of(client_a, card) == 0
    assert await _month_totals(client_a, "2026-09") == (545_000, 4_590 + 18_937 + 1_200)


async def test_with_two_cards_the_one_with_the_closest_open_invoice_is_suggested(
    client_a: AsyncClient,
    checking: Json,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    # O Cartão Verde deve R$ 800,00, o valor pago; o outro deve R$ 50,00.
    await create_account(
        client_a,
        name="Cartão Azul",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-5_000,
        initial_balance_date="2026-09-01",
    )

    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]
    assert payment["suggested_counter_account_id"] == card["id"]


async def test_confirming_an_invoice_payment_creates_a_transfer_and_not_an_expense(
    client_a: AsyncClient, card: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    checking = await create_account(
        client_a, name="Conta de setembro", initial_balance_date="2026-09-01"
    )
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    done = await confirm(client_a, record)

    assert done["imported_count"] == 5
    lines = await client_a.get(TRANSACTIONS, params={"type": "transfer"})
    out, received = sorted(lines.json()["items"], key=lambda line: line["transfer_direction"])[::-1]
    assert (out["account_id"], out["transfer_direction"]) == (checking["id"], "out")
    assert (received["account_id"], received["transfer_direction"]) == (card["id"], "in")
    assert out["transfer_group_id"] == received["transfer_group_id"]
    assert (out["amount_cents"], out["date"], out["category_id"]) == (80_000, "2026-09-20", None)
    # A dívida do cartão caiu, e o pagamento não entrou nas saídas do mês.
    assert await balance_of(client_a, card) == 0
    assert await _month_totals(client_a, "2026-09") == (545_000, 4_590 + 18_937 + 1_200)


# ---------- confirmação


async def test_confirming_saves_only_the_selected_lines_with_the_corrections(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    frozen_time: datetime,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    lines = _by_description(record)
    corrected = {
        lines["PADARIA SÃO JOÃO"]["id"]: {
            "category_id": categories["expense:Restaurante"],
            "description": "Café da manhã na padaria",
            "amount_cents": 4_600,
            "date": "2026-09-11",
        },
        lines["TARIFA PACOTE DE SERVIÇOS"]["id"]: {"selected": False},
        lines["PAGAMENTO FATURA CARTÃO"]["id"]: {"selected": False},
    }
    items = [{**decision, **corrected.get(decision["id"], {})} for decision in decisions(record)]

    done = await confirm(client_a, record, items)

    assert (done["status"], done["imported_count"], done["items"]) == ("completed", 3, None)
    assert datetime.fromisoformat(done["completed_at"]) == frozen_time
    assert done["expires_at"] is None
    saved = await _saved(client_a)
    assert [
        (line["date"], line["type"], line["amount_cents"], line["description"]) for line in saved
    ] == [
        ("2026-09-15", "expense", 18_937, "SUPERMERCADO BOM PREÇO"),
        ("2026-09-11", "expense", 4_600, "Café da manhã na padaria"),
        ("2026-09-05", "income", 545_000, "SALÁRIO EMPRESA FICTÍCIA LTDA"),
    ]
    assert {line["source"] for line in saved} == {"import"}
    assert {line["account_id"] for line in saved} == {checking["id"]}
    bakery = next(line for line in saved if line["amount_cents"] == 4_600)
    assert bakery["category_id"] == categories["expense:Restaurante"]
    # As linhas propostas não ficam guardadas depois da confirmação.
    assert await ImportRepository(session).list_items(user_a.id, uuid.UUID(record["id"])) == []


async def test_lines_of_the_same_day_keep_the_order_of_the_file(
    client_a: AsyncClient, card: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    content = (
        "Data;Descrição;Valor\n10/09/2026;Primeira;-1,00\n10/09/2026;Segunda;-2,00\n"
        "10/09/2026;Terceira;-3,00\n"
    ).encode()
    record = await _review(client_a, run_jobs, card, "ordem.csv", content)
    await client_a.post(f"{IMPORTS}/{record['id']}/mapping", json=SMALL_MAPPING)
    await run_jobs()

    await confirm(client_a, await get_import(client_a, record))

    # A lista mostra a mais nova primeiro: a última linha do arquivo é a mais nova do dia.
    assert [line["description"] for line in await _saved(client_a)] == [
        "Terceira",
        "Segunda",
        "Primeira",
    ]


async def test_importing_the_same_file_again_creates_no_duplicates(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    first = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    done = await confirm(client_a, first)

    again = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    # Toda linha é reconhecida pelo identificador do banco e chega desmarcada.
    assert [item["duplicate_status"] for item in again["items"]] == ["exact"] * 5
    assert not any(item["selected_by_default"] for item in again["items"])
    assert again["already_imported_at"] == done["completed_at"]

    # Confirmar tudo o que vem marcado não salva nada.
    second = await confirm(client_a, again)
    assert (second["status"], second["imported_count"]) == ("completed", 0)
    assert (await list_transactions(client_a))["total_count"] == 5


async def test_a_csv_of_the_same_period_is_recognized_without_bank_ids(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    await confirm(client_a, await _small_review(client_a, run_jobs, checking))

    again = await _small_review(client_a, run_jobs, checking)

    assert [item["duplicate_status"] for item in again["items"]] == ["exact"] * 3
    await confirm(client_a, again)
    assert (await list_transactions(client_a))["total_count"] == 3


async def test_a_line_flagged_as_already_imported_can_still_be_saved_by_choice(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    await confirm(client_a, await _review(client_a, run_jobs, checking, "banco_azul.ofx"))
    again = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    # O usuário marca de novo a padaria, mesmo com o aviso.
    done = await confirm(client_a, again, _decision(again, "PADARIA SÃO JOÃO", selected=True))

    # A linha entra, sem tomar o identificador do banco da que já existe.
    assert done["imported_count"] == 1
    assert (await list_transactions(client_a, q="padaria"))["total_count"] == 2


async def test_history_before_the_reference_date_does_not_change_the_balance(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    # A conta foi cadastrada hoje, 1º de outubro, com R$ 1.000,00; o extrato é de setembro.
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    await confirm(client_a, record)

    assert await balance_of(client_a, checking) == 100_000
    # As transações aparecem no painel do mês delas.
    income, expense = await _month_totals(client_a, "2026-09")
    assert (income, expense) == (545_000, 4_590 + 18_937 + 1_200 + 80_000)


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"category_id": None}, "category_id"),
        ({"category_id": "00000000-0000-4000-8000-000000000000"}, "category_id"),
        ({"category_id": "income"}, "category_id"),
        ({"amount_cents": 0}, "amount_cents"),
        ({"amount_cents": None}, "amount_cents"),
        ({"description": "   "}, "description"),
        ({"description": "x" * 201}, "description"),
        ({"notes": "x" * 1001}, "notes"),
        ({"date": None}, "date"),
        ({"type": None}, "type"),
        ({"type": "transfer"}, "counter_account_id"),
        ({"type": "transfer", "counter_account_id": "self"}, "counter_account_id"),
        ({"type": "transfer", "counter_account_id": "archived"}, "counter_account_id"),
    ],
    ids=[
        "sem categoria",
        "categoria que não existe",
        "categoria de receita em despesa",
        "valor zero",
        "sem valor",
        "descrição em branco",
        "descrição longa demais",
        "observação longa demais",
        "sem data",
        "sem tipo",
        "transferência sem a outra conta",
        "transferência para a própria conta",
        "transferência para conta arquivada",
    ],
)
async def test_a_selected_line_that_is_wrong_is_refused_and_nothing_is_saved(
    client_a: AsyncClient,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    changes: Json,
    field: str,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    archived = await create_account(client_a, name="Conta antiga")
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")
    placeholders = {
        "income": categories["income:Salário"],
        "self": checking["id"],
        "archived": archived["id"],
    }
    changes = {key: placeholders.get(str(value), value) for key, value in changes.items()}

    # A padaria é a segunda linha do arquivo: o erro aponta para ela.
    response = await send_confirmation(
        client_a, record, _decision(record, "PADARIA SÃO JOÃO", **changes)
    )

    assert set(_field_errors(response)) == {f"items.1.{field}"}
    # Uma linha recusada não deixa as outras entrarem: é tudo ou nada.
    assert (await list_transactions(client_a))["total_count"] == 0
    assert (await get_import(client_a, record))["status"] == "awaiting_review"


@pytest.mark.parametrize(
    ("line", "inverted", "selected"),
    [
        ("PADARIA SÃO JOÃO", "income", True),
        ("SALÁRIO EMPRESA FICTÍCIA LTDA", "expense", True),
        ("PAGAMENTO FATURA CARTÃO", "income", True),
        ("PADARIA SÃO JOÃO", "income", False),
    ],
    ids=[
        "saída como receita",
        "entrada como despesa",
        "transferência que sai como receita",
        "linha desmarcada",
    ],
)
async def test_the_confirmation_refuses_to_invert_the_direction_of_any_line(
    client_a: AsyncClient,
    checking: Json,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    line: str,
    inverted: str,
    selected: bool,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    position = [item["description"] for item in record["items"]].index(line)
    # Com uma categoria que serviria ao tipo pedido: o que se recusa é só a inversão.
    category = categories["income:Salário" if inverted == "income" else "expense:Mercado"]

    response = await send_confirmation(
        client_a,
        record,
        _decision(record, line, type=inverted, category_id=category, selected=selected),
    )

    fields = _field_errors(response)
    assert set(fields) == {f"items.{position}.type"}
    # É a mesma regra da correção de uma linha, com a mesma orientação.
    corrected = await send_item_update(client_a, record, record["items"][position], type=inverted)
    assert _field_errors(corrected) == {"type": fields[f"items.{position}.type"]}
    assert "saída do extrato pode ser despesa ou transferência" in fields[f"items.{position}.type"]
    # Nenhuma linha entra, nem as que estavam certas: é tudo ou nada.
    assert (await list_transactions(client_a))["total_count"] == 0
    assert (await get_import(client_a, record))["status"] == "awaiting_review"


async def test_the_confirmation_accepts_what_the_correction_accepts(
    client_a: AsyncClient, card: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    checking = await create_account(client_a, name="Conta corrente")
    record = await _review(client_a, run_jobs, card, "cartao_verde.ofx")
    lines = _by_description(record)
    changes = {
        # A saída vira transferência para outra conta, e a entrada, estorno ou transferência.
        lines["Livraria Letras & Cia"]["id"]: {
            "type": "transfer",
            "category_id": None,
            "counter_account_id": checking["id"],
        },
        lines["Estorno Livraria Letras & Cia"]["id"]: {
            "category_id": categories["expense:Educação"]
        },
    }
    items = [{**decision, **changes.get(decision["id"], {})} for decision in decisions(record)]

    done = await confirm(client_a, record, items)

    assert done["imported_count"] == 4
    refund = (await _saved(client_a, q="Estorno"))[0]
    assert (refund["type"], refund["category_id"]) == ("income", categories["expense:Educação"])
    moved = await _saved(client_a, type="transfer", account_id=checking["id"])
    assert [(side["transfer_direction"], side["amount_cents"]) for side in moved] == [("in", 5_990)]


async def test_an_unselected_line_is_not_checked(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    items = [{"id": decision["id"], "selected": False} for decision in decisions(record)]

    done = await confirm(client_a, record, items)

    assert (done["status"], done["imported_count"]) == ("completed", 0)


@pytest.mark.parametrize("problem", ["missing", "unknown", "repeated"])
async def test_the_review_must_cover_exactly_the_lines_of_the_import(
    client_a: AsyncClient,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    problem: str,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    items = decisions(record)
    if problem == "missing":
        items = items[1:]
    elif problem == "unknown":
        items[0] = {**items[0], "id": str(uuid.uuid4())}
    else:
        items = [*items, items[0]]

    fields = _field_errors(await send_confirmation(client_a, record, items))

    assert "Atualize a página" in fields["items"]
    assert (await list_transactions(client_a))["total_count"] == 0


async def test_confirmation_is_only_accepted_while_the_import_waits_for_review(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    queued = await upload(client_a, checking, "banco_azul.ofx")
    first = await client_a.post(f"{IMPORTS}/{queued['id']}/confirm", json={"items": []})
    record = await _review(client_a, run_jobs, checking, "cartao_verde.ofx")
    await confirm(client_a, record)

    # Confirmar duas vezes não salva duas vezes.
    second = await send_confirmation(client_a, record)

    for response in (first, second):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "import_not_awaiting_review"
    assert (await list_transactions(client_a))["total_count"] == 4


async def test_an_archived_destination_account_blocks_the_confirmation(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    await client_a.post(f"{ACCOUNTS}/{checking['id']}/archive")

    response = await send_confirmation(client_a, record)

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "account_archived"
    assert "Desarquive" in response.json()["error"]["message"]


# ---------- correções guardadas na revisão


async def test_a_correction_is_kept_and_comes_back_when_the_review_is_resumed(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    lines = _by_description(record)
    bakery, fee = lines["PADARIA SÃO JOÃO"], lines["TARIFA PACOTE DE SERVIÇOS"]
    corrections = {
        "category_id": categories["expense:Restaurante"],
        "amount_cents": 4_600,
        "date": "2026-09-11",
    }

    saved = await update_item(
        client_a, record, bakery, description="  Café da manhã na padaria ", **corrections
    )
    await update_item(client_a, record, fee, selected=False)

    # Quem sai da página e volta encontra a revisão como a deixou.
    corrected = {**bakery, **corrections, "description": "Café da manhã na padaria"}
    assert saved == corrected
    resumed = {item["id"]: item for item in (await get_import(client_a, record))["items"]}
    assert resumed[bakery["id"]] == corrected
    assert resumed[fee["id"]] == {**fee, "selected": False}
    # A sugestão continua guardada, e as outras linhas não mudaram.
    assert corrected["suggested_category_id"] == categories["expense:Outros"]
    assert resumed[fee["id"]]["selected_by_default"] is True
    untouched = [item for item in record["items"] if item["id"] not in (bakery["id"], fee["id"])]
    assert all(resumed[item["id"]] == item for item in untouched)
    # Corrigir não salva nenhuma transação: isso é da confirmação (FR-046).
    assert (await list_transactions(client_a))["total_count"] == 0


async def test_a_name_and_a_note_given_in_the_review_go_to_the_transaction(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _small_review(client_a, run_jobs, checking)
    lines = _by_description(record)
    bakery, station = lines["Padaria São João"], lines["Posto Estrela"]
    assert [item["notes"] for item in record["items"]] == [None, None, None]

    named = await update_item(
        client_a,
        record,
        bakery,
        description="Café da manhã com a Amanda",
        notes="  Dividimos a conta; ela me devolve metade.  ",
    )
    await update_item(client_a, record, station, notes="Viagem a trabalho")
    # Apagar a observação é enviar `null` ou deixá-la em branco.
    cleared = await update_item(client_a, record, station, notes="   ")

    assert (named["description"], named["notes"]) == (
        "Café da manhã com a Amanda",
        "Dividimos a conta; ela me devolve metade.",
    )
    assert cleared["notes"] is None
    resumed = await get_import(client_a, record)
    assert _by_description(resumed)["Café da manhã com a Amanda"]["notes"] == named["notes"]
    # Nada virou lançamento ainda.
    assert (await list_transactions(client_a))["total_count"] == 0

    await confirm(client_a, resumed, saved_decisions(resumed))

    saved = {line["description"]: line for line in await _saved(client_a)}
    assert (
        saved["Café da manhã com a Amanda"]["notes"] == "Dividimos a conta; ela me devolve metade."
    )
    assert saved["Posto Estrela"]["notes"] is None
    # A regra de categoria continua valendo para a descrição que veio do banco (FR-048).
    assert saved["Café da manhã com a Amanda"]["source"] == "import"


async def test_the_note_of_a_transfer_goes_to_both_sides(
    client_a: AsyncClient, checking: Json, card: Json, run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]
    await update_item(client_a, record, payment, notes="Fatura de agosto")

    resumed = await get_import(client_a, record)
    await confirm(client_a, resumed, _only(resumed, "PAGAMENTO FATURA CARTÃO"))

    sides = await _saved(client_a)
    assert sorted(side["transfer_direction"] for side in sides) == ["in", "out"]
    assert {side["notes"] for side in sides} == {"Fatura de agosto"}


async def test_the_resumed_review_is_confirmed_with_the_saved_corrections(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    record = await _small_review(client_a, run_jobs, checking)
    lines = _by_description(record)
    await update_item(
        client_a, record, lines["Padaria São João"], category_id=categories["expense:Mercado"]
    )
    await update_item(client_a, record, lines["Posto Estrela"], selected=False)
    # A correção guardada ainda não ensina nada: a regra só nasce na confirmação (FR-048).
    assert await CategorizationRepository(session).list_all(user_a.id) == []

    resumed = await get_import(client_a, record)
    done = await confirm(client_a, resumed, saved_decisions(resumed))

    assert done["imported_count"] == 2
    saved = {line["description"]: line for line in await _saved(client_a)}
    assert sorted(saved) == ["Padaria São João", "Salário"]
    assert saved["Padaria São João"]["category_id"] == categories["expense:Mercado"]
    rules = await CategorizationRepository(session).list_all(user_a.id)
    assert [(rule.description_normalized, rule.source) for rule in rules] == [
        ("padaria sao joao", RuleSource.USER)
    ]


async def test_marking_a_line_as_an_invoice_payment_is_kept(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    checking = await create_account(
        client_a, name="Conta de setembro", initial_balance_date="2026-09-01"
    )
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    card = await create_account(
        client_a,
        name="Cartão Verde",
        type="credit_card",
        closing_day=3,
        due_day=10,
        initial_balance_cents=-80_000,
        initial_balance_date="2026-09-01",
    )
    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]

    saved = await update_item(
        client_a, record, payment, type="transfer", counter_account_id=card["id"]
    )

    # A saída virou uma transferência que sai da conta, e o aviso de gasto em dobro some.
    assert (saved["type"], saved["transfer_direction"]) == ("transfer", "out")
    assert (saved["counter_account_id"], saved["warning_code"]) == (card["id"], None)
    resumed = await get_import(client_a, record)
    assert _by_description(resumed)["PAGAMENTO FATURA CARTÃO"] == saved
    await confirm(client_a, resumed, saved_decisions(resumed))
    assert await balance_of(client_a, card) == 0
    assert await _month_totals(client_a, "2026-09") == (545_000, 4_590 + 18_937 + 1_200)


async def test_a_suggested_invoice_payment_can_be_kept_as_a_common_expense(
    client_a: AsyncClient,
    checking: Json,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    payment = _by_description(record)["PAGAMENTO FATURA CARTÃO"]
    assert (payment["type"], payment["counter_account_id"]) == ("transfer", card["id"])

    saved = await update_item(
        client_a, record, payment, type="expense", category_id=categories["expense:Outros"]
    )

    assert (saved["type"], saved["transfer_direction"]) == ("expense", None)
    assert saved["category_id"] == categories["expense:Outros"]
    # A sugestão do cartão continua registrada. O usuário decidiu com o cartão cadastrado: o
    # aviso de quem não tem cartão não aparece.
    assert saved["suggested_counter_account_id"] == card["id"]
    assert saved["warning_code"] is None
    assert _by_description(await get_import(client_a, record))["PAGAMENTO FATURA CARTÃO"] == saved


async def test_a_corrected_line_keeps_the_direction_of_the_statement(
    client_a: AsyncClient, card: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, card, "cartao_verde.ofx")
    lines = _by_description(record)
    purchase, refund = lines["Livraria Letras & Cia"], lines["Estorno Livraria Letras & Cia"]
    education = categories["expense:Educação"]

    # A entrada marcada como estorno fica na categoria de despesa da compra (FR-084).
    as_refund = await update_item(client_a, record, refund, category_id=education)
    assert (as_refund["type"], as_refund["category_id"]) == ("income", education)

    # Uma saída não vira receita, nem uma entrada, despesa; e despesa não vai em categoria de
    # receita.
    for line, changes, field in (
        (purchase, {"type": "income"}, "type"),
        (refund, {"type": "expense"}, "type"),
        (purchase, {"category_id": categories["income:Salário"]}, "category_id"),
    ):
        response = await send_item_update(client_a, record, line, **changes)
        assert set(_field_errors(response)) == {field}

    # As duas podem ser transferência: a entrada, vinda de outra conta.
    other = await create_account(client_a, name="Conta corrente")
    moved = await update_item(
        client_a, record, refund, type="transfer", counter_account_id=other["id"]
    )
    assert (moved["type"], moved["transfer_direction"]) == ("transfer", "in")
    back = await update_item(client_a, record, refund, type="income")
    assert (back["type"], back["transfer_direction"], back["category_id"]) == (
        "income",
        None,
        education,
    )


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"category_id": "00000000-0000-4000-8000-000000000000"}, "category_id"),
        ({"category_id": "archived_category"}, "category_id"),
        ({"amount_cents": 0}, "amount_cents"),
        ({"description": "   "}, "description"),
        ({"description": "x" * 201}, "description"),
        ({"notes": "x" * 1001}, "notes"),
        ({"date": "2026-02-30"}, "date"),
        ({"counter_account_id": "00000000-0000-4000-8000-000000000000"}, "counter_account_id"),
        ({"counter_account_id": "self"}, "counter_account_id"),
        ({"counter_account_id": "archived_account"}, "counter_account_id"),
    ],
    ids=[
        "categoria que não existe",
        "categoria arquivada",
        "valor zero",
        "descrição em branco",
        "descrição longa demais",
        "observação longa demais",
        "data que não existe",
        "outra conta que não existe",
        "transferência para a própria conta",
        "transferência para conta arquivada",
    ],
)
async def test_a_wrong_correction_is_refused_and_the_line_stays_as_it_was(
    client_a: AsyncClient,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    changes: Json,
    field: str,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    archived = await create_account(client_a, name="Conta antiga")
    await client_a.post(f"{ACCOUNTS}/{archived['id']}/archive")
    await client_a.post(f"/api/v1/categories/{categories['expense:Lazer']}/archive")
    placeholders = {
        "archived_category": categories["expense:Lazer"],
        "self": checking["id"],
        "archived_account": archived["id"],
    }
    changes = {key: placeholders.get(str(value), value) for key, value in changes.items()}
    bakery = _by_description(record)["PADARIA SÃO JOÃO"]

    # Junto vai uma mudança que seria aceita: recusado um campo, nenhum é gravado.
    response = await send_item_update(client_a, record, bakery, selected=False, **changes)

    assert set(_field_errors(response)) == {field}
    assert (await get_import(client_a, record))["items"] == record["items"]


async def test_marking_and_unmarking_all_lines_is_kept_and_moves_the_checked_balance(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    account = await create_account(
        client_a,
        name="Conta de setembro",
        initial_balance_cents=10_000,
        initial_balance_date="2026-09-01",
    )
    food = categories["expense:Mercado"]
    # Lançada à mão: a padaria do extrato chega desmarcada, como provável duplicata.
    await create_transaction(
        client_a, account, {"id": food, "kind": "expense"}, amount_cents=4_590, date="2026-09-10"
    )
    record = await _review(client_a, run_jobs, account, "banco_azul.ofx")
    by_default = [True, False, True, True, True]
    assert [item["selected"] for item in record["items"]] == by_default
    suggested = record["balance_check"]["computed_balance_cents"]

    marked = await client_a.patch(f"{IMPORTS}/{record['id']}/items", json={"selected": True})

    assert marked.status_code == 204, marked.text
    resumed = await get_import(client_a, record)
    assert all(item["selected"] for item in resumed["items"])
    # O que veio sugerido continua registrado, e o saldo conferido segue o que está marcado.
    assert [item["selected_by_default"] for item in resumed["items"]] == by_default
    assert resumed["balance_check"]["computed_balance_cents"] == suggested - 4_590

    await client_a.patch(f"{IMPORTS}/{record['id']}/items", json={"selected": False})

    resumed = await get_import(client_a, record)
    assert not any(item["selected"] for item in resumed["items"])
    check = resumed["balance_check"]
    assert check["computed_balance_cents"] == check["account_balance_cents"]


async def test_corrections_are_only_accepted_while_the_import_waits_for_review(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    queued = await upload(client_a, checking, "banco_azul.ofx")
    early = await client_a.patch(f"{IMPORTS}/{queued['id']}/items", json={"selected": False})
    record = await _review(client_a, run_jobs, checking, "cartao_verde.ofx")
    line = record["items"][0]

    # Uma linha que não é desta importação responde como uma que não existe.
    unknown = await client_a.patch(
        f"{IMPORTS}/{record['id']}/items/{uuid.uuid4()}", json={"selected": False}
    )
    assert unknown.status_code == 404, unknown.text

    await confirm(client_a, record)
    late_line = await send_item_update(client_a, record, line, selected=False)
    late_all = await client_a.patch(f"{IMPORTS}/{record['id']}/items", json={"selected": False})

    for response in (early, late_line, late_all):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "import_not_awaiting_review"
    assert (await list_transactions(client_a))["total_count"] == 4


# ---------- conferência de saldo


async def test_the_bank_balance_is_compared_with_the_balance_of_the_account_on_its_date(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    # O banco diz R$ 4.402,73 em 30 de setembro. O arquivo soma +R$ 4.402,73 no mês.
    account = await create_account(
        client_a, name="Conta de setembro", initial_balance_date="2026-09-01"
    )

    record = await _review(client_a, run_jobs, account, "banco_azul.ofx")

    assert record["balance_check"] == {
        "bank_balance_cents": 440_273,
        "bank_balance_date": "2026-09-30",
        # A conta ainda não tem nenhuma linha do arquivo.
        "account_balance_cents": 0,
        "counted_from": "2026-09-01",
        # Com as cinco linhas marcadas: 5.450,00 - 45,90 - 189,37 - 12,00 - 800,00.
        "computed_balance_cents": 440_273,
        "matches": True,
    }
    assert record["total_check"] is None

    # Depois da confirmação, vale o saldo da conta na data do saldo do banco.
    done = await confirm(client_a, record)
    assert done["balance_check"]["account_balance_cents"] == 440_273
    assert done["balance_check"]["matches"] is True


async def test_a_divergent_balance_shows_both_values_and_does_not_block_the_import(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    account = await create_account(
        client_a,
        name="Conta de setembro",
        initial_balance_cents=10_000,
        initial_balance_date="2026-09-01",
    )
    food = categories["expense:Mercado"]
    # Lançada à mão: a padaria do extrato vira provável duplicata e chega desmarcada.
    await create_transaction(
        client_a, account, {"id": food, "kind": "expense"}, amount_cents=4_590, date="2026-09-10"
    )

    record = await _review(client_a, run_jobs, account, "banco_azul.ofx")

    check = record["balance_check"]
    assert check["account_balance_cents"] == 10_000 - 4_590
    # As quatro linhas marcadas por padrão; a padaria já está no saldo da conta.
    assert check["computed_balance_cents"] == 10_000 - 4_590 + 545_000 - 18_937 - 1_200 - 80_000
    assert (check["bank_balance_cents"], check["matches"]) == (440_273, False)
    # O aviso não impede a importação.
    assert (await confirm(client_a, record))["status"] == "completed"


async def test_only_lines_inside_the_counted_period_enter_the_computed_balance(
    client_a: AsyncClient, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    # A data de referência do saldo inicial é 12 de setembro: o salário do dia 5 e a padaria
    # do dia 10 aparecem nos relatórios, mas não mudam o saldo.
    account = await create_account(
        client_a,
        name="Conta de setembro",
        initial_balance_cents=540_410,
        initial_balance_date="2026-09-12",
    )

    record = await _review(client_a, run_jobs, account, "banco_azul.ofx")

    check = record["balance_check"]
    assert check["counted_from"] == "2026-09-12"
    assert check["computed_balance_cents"] == 540_410 - 18_937 - 1_200 - 80_000
    assert check["matches"] is True


async def test_no_balance_check_when_the_bank_balance_is_before_the_reference_date(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    # A conta foi cadastrada em 1º de outubro; o saldo do banco é de 30 de setembro.
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    assert record["balance_check"] is None


async def test_a_file_without_a_bank_balance_has_no_balance_check(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    assert (await _small_review(client_a, run_jobs, checking))["balance_check"] is None


# ---------- desfazer e descartar


async def test_undoing_removes_everything_the_import_created_and_nothing_else(
    client_a: AsyncClient,
    card: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    frozen_time: datetime,
) -> None:
    checking = await create_account(
        client_a, name="Conta de setembro", initial_balance_date="2026-09-01"
    )
    manual = await create_transaction(
        client_a,
        checking,
        {"id": categories["expense:Lazer"], "kind": "expense"},
        amount_cents=7_000,
        date="2026-09-25",
        description="Cinema",
    )
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    await confirm(client_a, record)
    # Cinco linhas do arquivo, uma delas uma transferência de dois lados, e a lançada à mão.
    assert (await list_transactions(client_a))["total_count"] == 7

    response = await client_a.post(f"{IMPORTS}/{record['id']}/undo")

    assert response.status_code == 200, response.text
    undone = response.json()
    assert (undone["status"], undone["imported_count"]) == ("undone", 5)
    assert datetime.fromisoformat(undone["undone_at"]) == frozen_time
    assert [line["id"] for line in await _saved(client_a)] == [manual["id"]]
    # Os dois lados da transferência saíram: a dívida do cartão voltou.
    assert await balance_of(client_a, card) == -80_000
    assert await balance_of(client_a, checking) == -7_000


async def test_an_undone_file_can_be_imported_again(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    await confirm(client_a, record)
    await client_a.post(f"{IMPORTS}/{record['id']}/undo")

    again = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    assert all(item["selected_by_default"] for item in again["items"])
    assert again["already_imported_at"] is None
    assert (await confirm(client_a, again))["imported_count"] == 5


async def test_only_a_confirmed_import_can_be_undone(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    in_review = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    undone = await _review(client_a, run_jobs, checking, "cartao_verde.ofx")
    await confirm(client_a, undone)
    await client_a.post(f"{IMPORTS}/{undone['id']}/undo")

    for record in (in_review, undone):
        response = await client_a.post(f"{IMPORTS}/{record['id']}/undo")
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "import_not_completed"


async def test_discarding_an_import_in_review_leaves_nothing_behind(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    response = await client_a.delete(f"{IMPORTS}/{record['id']}")

    assert response.status_code == 204, response.text
    assert (await client_a.get(f"{IMPORTS}/{record['id']}")).status_code == 404
    assert await ImportRepository(session).list_items(user_a.id, uuid.UUID(record["id"])) == []
    assert (await list_transactions(client_a))["total_count"] == 0


async def test_discarding_an_import_that_waits_for_the_mapping_deletes_the_file(
    client_a: AsyncClient, checking: Json, session: AsyncSession, run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "extrato_ponto_e_virgula.csv")
    assert len(await stored_files(session)) == 1

    response = await client_a.delete(f"{IMPORTS}/{record['id']}")

    assert response.status_code == 204, response.text
    assert await stored_files(session) == []


async def test_a_confirmed_import_cannot_be_discarded(
    client_a: AsyncClient, checking: Json, categories: dict[str, str], run_jobs: JobRunner
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    await confirm(client_a, record)

    response = await client_a.delete(f"{IMPORTS}/{record['id']}")

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "import_already_confirmed"
    assert "desfazer" in response.json()["error"]["message"]
    assert (await list_transactions(client_a))["total_count"] == 5


# ---------- histórico


async def test_history_lists_the_imports_newest_first_with_what_the_user_needs(
    client_a: AsyncClient,
    client_b: AsyncClient,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    frozen_time: datetime,
) -> None:
    first = await _review(client_a, run_jobs, checking, "banco_azul.ofx")
    await confirm(client_a, first, _only(first, "SALÁRIO EMPRESA FICTÍCIA LTDA"))
    clock.set_fixed_time(frozen_time + timedelta(minutes=5))
    failed = await _review(
        client_a, run_jobs, checking, "vazio.ofx", b"<OFX><STMTRS></STMTRS></OFX>"
    )
    clock.set_fixed_time(frozen_time + timedelta(minutes=10))
    waiting = await _review(client_a, run_jobs, checking, "extrato_ponto_e_virgula.csv")
    await upload(client_b, await create_account(client_b), "banco_azul.ofx")

    response = await client_a.get(IMPORTS)

    assert response.status_code == 200, response.text
    page = response.json()
    assert page["next_cursor"] is None
    assert [
        (item["original_filename"], item["status"], item["item_count"], item["imported_count"])
        for item in page["items"]
    ] == [
        ("extrato_ponto_e_virgula.csv", "awaiting_mapping", 0, 0),
        ("vazio.ofx", "failed", 0, 0),
        ("banco_azul.ofx", "completed", 5, 1),
    ]
    assert [item["id"] for item in page["items"]] == [waiting["id"], failed["id"], first["id"]]
    assert {item["account_id"] for item in page["items"]} == {checking["id"]}
    assert page["items"][1]["error_message"]
    # O histórico não traz as linhas nem a prévia das colunas.
    assert all(item["items"] is None and item["mapping_preview"] is None for item in page["items"])


async def test_history_is_paginated(
    client_a: AsyncClient, checking: Json, frozen_time: datetime
) -> None:
    for minute in range(3):
        clock.set_fixed_time(frozen_time + timedelta(minutes=minute))
        await upload(client_a, checking, f"extrato-{minute}.ofx", b"<OFX>" + bytes([65 + minute]))

    first = (await client_a.get(IMPORTS, params={"limit": 2})).json()
    second = (
        await client_a.get(IMPORTS, params={"limit": 2, "cursor": first["next_cursor"]})
    ).json()

    assert [item["original_filename"] for item in first["items"]] == [
        "extrato-2.ofx",
        "extrato-1.ofx",
    ]
    assert [item["original_filename"] for item in second["items"]] == ["extrato-0.ofx"]
    assert second["next_cursor"] is None
    assert "cursor" in _field_errors(await client_a.get(IMPORTS, params={"cursor": "nada"}))
    assert "limit" in _field_errors(await client_a.get(IMPORTS, params={"limit": 0}))


# ---------- expiração e limpeza


async def test_a_review_left_for_more_than_seven_days_expires_without_saving_anything(
    client_a: AsyncClient,
    client_for: ClientFactory,
    session: AsyncSession,
    user_a: User,
    checking: Json,
    categories: dict[str, str],
    run_jobs: JobRunner,
    session_factory: SessionFactory,
    frozen_time: datetime,
) -> None:
    record = await _review(client_a, run_jobs, checking, "banco_azul.ofx")

    # No último instante do prazo ela ainda está lá.
    clock.set_fixed_time(frozen_time + timedelta(days=7))
    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)
    assert (await get_import(await client_for(user_a), record))["status"] == "awaiting_review"

    clock.set_fixed_time(frozen_time + timedelta(days=7, seconds=1))
    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)

    later = await client_for(user_a)
    expired = await get_import(later, record)
    assert (expired["status"], expired["error_code"]) == ("failed", "review_expired")
    assert (
        "7 dias" in expired["error_message"]
        and "Envie o arquivo de novo" in expired["error_message"]
    )
    assert (expired["items"], expired["expires_at"]) == (None, None)
    assert await ImportRepository(session).list_items(user_a.id, uuid.UUID(record["id"])) == []
    assert (await list_transactions(later))["total_count"] == 0
    # Uma revisão expirada não pode mais ser confirmada.
    assert (await send_confirmation(later, record)).status_code == 409


async def test_a_file_waiting_for_the_mapping_for_more_than_a_day_is_deleted(
    client_a: AsyncClient,
    client_for: ClientFactory,
    user_a: User,
    checking: Json,
    session: AsyncSession,
    run_jobs: JobRunner,
    session_factory: SessionFactory,
    frozen_time: datetime,
) -> None:
    record = await _review(client_a, run_jobs, checking, "extrato_ponto_e_virgula.csv")

    clock.set_fixed_time(frozen_time + timedelta(hours=24))
    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)
    assert (await get_import(await client_for(user_a), record))["status"] == "awaiting_mapping"
    assert len(await stored_files(session)) == 1

    clock.set_fixed_time(frozen_time + timedelta(hours=24, seconds=1))
    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)

    later = await client_for(user_a)
    expired = await get_import(later, record)
    assert (expired["status"], expired["error_code"]) == ("failed", "mapping_expired")
    assert (
        "24 horas" in expired["error_message"]
        and "Envie o arquivo de novo" in expired["error_message"]
    )
    assert expired["mapping_preview"] is None
    assert await stored_files(session) == []
    # O mapeamento chegou tarde: o arquivo já não existe.
    late = await later.post(f"{IMPORTS}/{record['id']}/mapping", json=CSV_MAPPING)
    assert late.status_code == 409


async def test_an_import_whose_job_ran_out_of_attempts_goes_to_error(
    client_a: AsyncClient,
    client_for: ClientFactory,
    user_a: User,
    checking: Json,
    session: AsyncSession,
    run_jobs: JobRunner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def database_down(*args: object, **kwargs: object) -> None:
        raise OperationalError("select 1", {}, Exception("banco fora do ar"))

    sent = await upload(client_a, checking, "banco_azul.ofx")
    monkeypatch.setattr("app.modules.imports.service.ImportService._prepare_review", database_down)

    # A falha do banco é passageira: o job volta para a fila até as tentativas acabarem.
    attempts = 0
    for _ in range(5):
        attempts += await run_jobs()
        clock.set_fixed_time(clock.utcnow() + timedelta(hours=2))
    monkeypatch.undo()

    record = await get_import(await client_for(user_a), sent)
    assert attempts == 3
    # A importação não fica presa "na fila" nem "processando".
    assert (record["status"], record["error_code"]) == ("failed", "processing_error")
    assert "Envie o arquivo de novo" in record["error_message"]
    assert await stored_files(session) == []


async def test_a_job_with_a_broken_payload_does_not_break_the_worker(
    session: AsyncSession, user_a: User, run_jobs: JobRunner
) -> None:
    await queue.enqueue(session, JobType.PROCESS_IMPORT, {"import_id": "nada"}, user_id=user_a.id)
    await queue.enqueue(session, JobType.PROCESS_IMPORT, {"import_id": str(uuid.uuid4())})
    await session.commit()

    assert await run_jobs() == 2


async def test_the_cleanup_keeps_the_file_of_an_import_waiting_for_the_columns(
    client_a: AsyncClient,
    checking: Json,
    session: AsyncSession,
    run_jobs: JobRunner,
    session_factory: SessionFactory,
) -> None:
    waiting = await _review(client_a, run_jobs, checking, "extrato_ponto_e_virgula.csv")

    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)

    assert await stored_files(session) == [fixture_bytes("extrato_ponto_e_virgula.csv")]
    assert (await get_import(client_a, waiting))["status"] == "awaiting_mapping"


async def test_the_file_of_a_finished_import_that_was_left_behind_is_removed(
    client_a: AsyncClient,
    checking: Json,
    session: AsyncSession,
    user_a: User,
    run_jobs: JobRunner,
    session_factory: SessionFactory,
    frozen_time: datetime,
) -> None:
    sent = await upload(client_a, checking, "vazio.ofx", b"<OFX><STMTRS></STMTRS></OFX>")
    await run_jobs()
    # Um arquivo que ficou para trás numa importação já terminada.
    await ImportRepository(session).save_file(
        user_a.id, uuid.UUID(sent["id"]), b"sobrou", created_at=frozen_time
    )
    await session.commit()

    async with session_factory() as worker_session:
        await cleanup_imports(worker_session)

    assert await stored_files(session) == []
    assert (await get_import(client_a, sent))["status"] == "failed"

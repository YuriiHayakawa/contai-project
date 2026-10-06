"""Importação de OFX, CSV e planilha: do envio até a revisão (FR-036 a FR-054).

O envio só guarda o arquivo e põe o processamento na fila; quem lê o arquivo é o worker. Até a
confirmação, que vem depois, nada vira transação.
"""

import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.imports import storage
from app.modules.imports.models import ImportStatus
from app.modules.imports.repository import ImportRepository
from app.modules.users.models import User
from app.worker import queue
from app.worker.models import JobType
from tests.conftest import JobRunner
from tests.finance import (
    ACCOUNTS,
    balance_of,
    create_account,
    create_category,
    create_transaction,
    list_transactions,
)
from tests.imports import (
    IMPORTS,
    fixture_bytes,
    get_import,
    send_file,
    stored_files,
    upload,
)

Json = dict[str, Any]

pytestmark = pytest.mark.usefixtures("frozen_time", "upload_dir")

# Data, histórico e valor do `extrato_ponto_e_virgula.csv`.
CSV_MAPPING = {
    "date_column": 0,
    "description_column": 1,
    "amount_column": 3,
    "date_format": "dmy",
    "decimal_separator": ",",
    "sign_convention": "negative_is_expense",
}


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
        client_a, name="Cartão Verde", type="credit_card", closing_day=3, due_day=10
    )


async def _processed(client: AsyncClient, run_jobs: JobRunner, record: Json) -> Json:
    await run_jobs()
    return await get_import(client, record)


async def _map(client: AsyncClient, record: Json, **changes: object) -> Any:
    return await client.post(f"{IMPORTS}/{record['id']}/mapping", json={**CSV_MAPPING, **changes})


def _field_errors(response: Any) -> dict[str, str]:
    assert response.status_code == 422, response.text
    fields: dict[str, str] = response.json()["error"]["details"]["fields"]
    return fields


def _lines(record: Json) -> list[tuple[str, str, int, str]]:
    return [
        (item["date"], item["type"], item["amount_cents"], item["description"])
        for item in record["items"]
    ]


# ---------- envio


async def test_upload_stores_the_file_and_queues_the_processing(
    client_a: AsyncClient, checking: Json, upload_dir: Path, run_jobs: JobRunner
) -> None:
    response = await send_file(client_a, checking, "banco_azul.ofx")

    assert response.status_code == 202, response.text
    record = response.json()
    assert record["status"] == "queued"
    assert record["account_id"] == checking["id"]
    assert (record["kind"], record["format"]) == ("statement", "ofx")
    assert record["original_filename"] == "banco_azul.ofx"
    assert (record["items"], record["mapping_preview"], record["expires_at"]) == (None, None, None)
    # O arquivo fica no volume privado com um nome gerado, até o worker ler.
    [stored] = stored_files(upload_dir)
    assert stored.name != "banco_azul.ofx"
    assert stored.read_bytes() == fixture_bytes("banco_azul.ofx")
    assert await run_jobs() == 1


async def test_only_the_name_of_the_file_is_kept(client_a: AsyncClient, checking: Json) -> None:
    content = fixture_bytes("banco_azul.ofx")

    record = await upload(client_a, checking, "..\\..\\pasta/extrato de setembro.ofx", content)

    assert record["original_filename"] == "extrato de setembro.ofx"


async def test_the_type_comes_from_the_content_and_not_from_the_name(
    client_a: AsyncClient, checking: Json
) -> None:
    record = await upload(client_a, checking, "extrato.csv", fixture_bytes("banco_azul.ofx"))

    assert record["format"] == "ofx"


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b"GIF89a" + b"\x00" * 64, "OFX, CSV, planilha Excel (.xlsx) ou PDF"),
        (b"MZ\x90\x00" + b"\x00" * 64, "OFX, CSV, planilha Excel (.xlsx) ou PDF"),
        (b"", "está vazio"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64, "salve como .xlsx"),
    ],
    ids=["imagem que não é jpg nem png", "executável", "vazio", "xls antigo"],
)
async def test_a_file_that_is_not_accepted_is_refused_with_what_to_do(
    client_a: AsyncClient, checking: Json, upload_dir: Path, content: bytes, message: str
) -> None:
    # A extensão diz que é um extrato; o conteúdo é que vale.
    response = await send_file(client_a, checking, "extrato.ofx", content)

    assert response.status_code == 415, response.text
    assert response.json()["error"]["code"] == "unsupported_file"
    assert message in response.json()["error"]["message"]
    assert stored_files(upload_dir) == []


async def test_a_file_above_the_limit_is_refused(
    client_a: AsyncClient, checking: Json, upload_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "upload_max_bytes", 1_000)

    response = await send_file(client_a, checking, "banco_azul.ofx")

    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "payload_too_large"
    assert stored_files(upload_dir) == []


async def test_the_destination_account_must_be_an_active_account_of_the_user(
    client_a: AsyncClient, checking: Json, upload_dir: Path
) -> None:
    unknown = {"id": "00000000-0000-4000-8000-000000000000"}
    await client_a.post(f"{ACCOUNTS}/{checking['id']}/archive")

    for account in (unknown, checking):
        fields = _field_errors(await send_file(client_a, account, "banco_azul.ofx"))
        assert set(fields) == {"account_id"}
    assert stored_files(upload_dir) == []


async def test_upload_needs_the_file_and_the_account(client_a: AsyncClient, checking: Json) -> None:
    without_account = await client_a.post(IMPORTS, files={"file": ("a.ofx", b"<OFX>")})
    without_file = await client_a.post(IMPORTS, data={"account_id": checking["id"]})

    assert "account_id" in _field_errors(without_account)
    assert "file" in _field_errors(without_file)


async def test_a_receipt_is_a_picture_or_a_pdf(client_a: AsyncClient, checking: Json) -> None:
    response = await send_file(client_a, checking, "banco_azul.ofx", kind="receipt")

    assert set(_field_errors(response)) == {"kind"}


async def test_uploads_are_rate_limited_per_user(
    client_a: AsyncClient, client_b: AsyncClient, checking: Json, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "rate_limit_upload", "2/hour")
    account_of_b = await create_account(client_b)

    for _ in range(2):
        await upload(client_a, checking, "banco_azul.ofx")
    blocked = await send_file(client_a, checking, "banco_azul.ofx")

    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0
    # O limite é de cada usuário.
    await upload(client_b, account_of_b, "banco_azul.ofx")


async def test_imports_require_authentication(client: AsyncClient) -> None:
    unknown = "00000000-0000-4000-8000-000000000000"

    responses = [
        await client.post(
            IMPORTS, files={"file": ("a.ofx", b"<OFX>")}, data={"account_id": unknown}
        ),
        await client.get(f"{IMPORTS}/{unknown}"),
        await client.post(f"{IMPORTS}/{unknown}/mapping", json=CSV_MAPPING),
    ]

    assert [response.status_code for response in responses] == [401, 401, 401]


async def test_an_unknown_import_is_not_found(client_a: AsyncClient) -> None:
    unknown = "00000000-0000-4000-8000-000000000000"

    assert (await client_a.get(f"{IMPORTS}/{unknown}")).status_code == 404
    assert (
        await client_a.post(f"{IMPORTS}/{unknown}/mapping", json=CSV_MAPPING)
    ).status_code == 404


# ---------- processamento de OFX


async def test_an_ofx_goes_to_review_without_saving_any_transaction(
    client_a: AsyncClient,
    checking: Json,
    upload_dir: Path,
    run_jobs: JobRunner,
    frozen_time: datetime,
) -> None:
    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )

    assert record["status"] == "awaiting_review"
    assert (record["error_code"], record["error_message"]) == (None, None)
    assert record["item_count"] == 5
    assert _lines(record) == [
        ("2026-09-05", "income", 545_000, "SALÁRIO EMPRESA FICTÍCIA LTDA"),
        ("2026-09-10", "expense", 4_590, "PADARIA SÃO JOÃO"),
        ("2026-09-15", "expense", 18_937, "SUPERMERCADO BOM PREÇO"),
        ("2026-09-15", "expense", 1_200, "TARIFA PACOTE DE SERVIÇOS"),
        ("2026-09-20", "expense", 80_000, "PAGAMENTO FATURA CARTÃO"),
    ]
    assert [item["row_index"] for item in record["items"]] == [0, 1, 2, 3, 4]
    assert all(item["duplicate_status"] == "none" for item in record["items"])
    assert all(item["selected_by_default"] for item in record["items"])
    # A revisão espera o usuário por 7 dias (FR-083).
    assert datetime.fromisoformat(record["expires_at"]) == frozen_time + timedelta(days=7)
    # Nada foi salvo: a lista de lançamentos continua vazia e o saldo, o mesmo (FR-046).
    assert (await list_transactions(client_a))["total_count"] == 0
    assert await balance_of(client_a, checking) == 100_000
    # O arquivo original é apagado assim que é lido (FR-053).
    assert stored_files(upload_dir) == []


async def test_an_ofx_out_of_the_standard_is_imported_without_any_setup(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    sent = await upload(client_a, checking, "banco_laranja_fora_do_padrao.ofx")

    record = await _processed(client_a, run_jobs, sent)

    assert record["status"] == "awaiting_review"
    assert [line[:3] for line in _lines(record)] == [
        ("2026-09-03", "expense", 125_000),
        ("2026-09-07", "income", 35_000),
        ("2026-09-11", "expense", 3_240),
    ]


async def test_a_card_statement_in_xml_keeps_both_identical_purchases(
    client_a: AsyncClient, card: Json, run_jobs: JobRunner
) -> None:
    record = await _processed(client_a, run_jobs, await upload(client_a, card, "cartao_verde.ofx"))

    assert _lines(record) == [
        ("2026-09-12", "expense", 5_990, "Livraria Letras & Cia"),
        ("2026-09-18", "expense", 750, "Café da Esquina"),
        ("2026-09-18", "expense", 750, "Café da Esquina"),
        ("2026-09-25", "income", 5_990, "Estorno Livraria Letras & Cia"),
    ]
    assert all(item["selected_by_default"] for item in record["items"])


async def test_the_same_import_is_not_processed_twice(
    client_a: AsyncClient, checking: Json, session: AsyncSession, user_a: User, run_jobs: JobRunner
) -> None:
    sent = await upload(client_a, checking, "banco_azul.ofx")
    # Um segundo job para a mesma importação, como numa nova tentativa da fila.
    await queue.enqueue(
        session, JobType.PROCESS_IMPORT, {"import_id": sent["id"]}, user_id=user_a.id
    )
    await session.commit()

    assert await run_jobs() == 2

    assert (await get_import(client_a, sent))["item_count"] == 5
    assert len((await get_import(client_a, sent))["items"]) == 5


# ---------- duplicatas


async def test_a_transaction_made_by_hand_is_flagged_and_arrives_unselected(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    food = await create_category(client_a)
    # A mesma compra do extrato, lançada à mão dois dias depois e com outro texto.
    manual = await create_transaction(
        client_a, checking, food, amount_cents=4_590, date="2026-09-12", description="Pão e café"
    )

    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )

    flagged = {item["description"]: item for item in record["items"]}["PADARIA SÃO JOÃO"]
    assert flagged["duplicate_status"] == "probable"
    assert flagged["duplicate_of_id"] == manual["id"]
    assert flagged["selected_by_default"] is False
    others = [item for item in record["items"] if item["id"] != flagged["id"]]
    assert all(item["duplicate_status"] == "none" for item in others)
    assert all(item["selected_by_default"] for item in others)


async def test_a_transaction_with_the_same_date_amount_and_description_is_exact(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    food = await create_category(client_a)
    # Só difere em maiúsculas e acentos: a descrição normalizada é a mesma.
    saved = await create_transaction(
        client_a,
        checking,
        food,
        amount_cents=4_590,
        date="2026-09-10",
        description="padaria sao joao",
    )

    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )

    flagged = {item["description"]: item for item in record["items"]}["PADARIA SÃO JOÃO"]
    assert (flagged["duplicate_status"], flagged["duplicate_of_id"]) == ("exact", saved["id"])
    assert flagged["selected_by_default"] is False


async def test_one_saved_purchase_flags_only_one_of_two_identical_lines(
    client_a: AsyncClient, card: Json, run_jobs: JobRunner
) -> None:
    food = await create_category(client_a)
    await create_transaction(
        client_a, card, food, amount_cents=750, date="2026-09-18", description="Café da Esquina"
    )

    record = await _processed(client_a, run_jobs, await upload(client_a, card, "cartao_verde.ofx"))

    coffees = [item for item in record["items"] if item["description"] == "Café da Esquina"]
    assert [item["duplicate_status"] for item in coffees] == ["exact", "none"]


async def test_transactions_of_another_account_are_not_duplicates(
    client_a: AsyncClient, checking: Json, card: Json, run_jobs: JobRunner
) -> None:
    food = await create_category(client_a)
    await create_transaction(
        client_a, card, food, amount_cents=4_590, date="2026-09-10", description="Padaria São João"
    )

    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )

    assert all(item["duplicate_status"] == "none" for item in record["items"])


# ---------- CSV e planilha: mapeamento de colunas


async def test_an_unknown_csv_waits_for_the_column_mapping(
    client_a: AsyncClient,
    checking: Json,
    upload_dir: Path,
    run_jobs: JobRunner,
    frozen_time: datetime,
) -> None:
    sent = await upload(client_a, checking, "extrato_ponto_e_virgula.csv")

    record = await _processed(client_a, run_jobs, sent)

    assert record["status"] == "awaiting_mapping"
    assert record["items"] is None
    preview = record["mapping_preview"]
    assert preview["columns"] == ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"]
    assert preview["rows"][1] == ["10/09/2026", "PADARIA SÃO JOÃO", "000124", "-45,90", "5.904,10"]
    assert preview["suggestion"] == {**CSV_MAPPING, "income_column": None, "expense_column": None}
    # O arquivo fica guardado até o usuário mapear, por no máximo 24 horas (FR-083).
    assert len(stored_files(upload_dir)) == 1
    assert datetime.fromisoformat(record["expires_at"]) == frozen_time + timedelta(hours=24)


async def test_mapping_the_columns_once_serves_the_next_files_with_the_same_structure(
    client_a: AsyncClient, checking: Json, upload_dir: Path, run_jobs: JobRunner
) -> None:
    first = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )

    mapped = await _map(client_a, first)

    assert mapped.status_code == 202, mapped.text
    assert mapped.json()["status"] == "queued"
    assert mapped.json()["mapping_preview"] is None
    first = await _processed(client_a, run_jobs, first)
    assert first["status"] == "awaiting_review"
    assert _lines(first) == [
        ("2026-09-05", "income", 545_000, "SALÁRIO EMPRESA FICTÍCIA LTDA"),
        ("2026-09-10", "expense", 4_590, "PADARIA SÃO JOÃO"),
        ("2026-09-15", "expense", 18_937, "SUPERMERCADO BOM PREÇO; LOJA 2"),
        ("2026-09-20", "expense", 120_000, "PIX ENVIADO JOÃO"),
    ]
    assert stored_files(upload_dir) == []

    # Outro arquivo, do mês seguinte, com as mesmas colunas: o sistema não pergunta de novo.
    october = (
        "Data;Histórico;Documento;Valor (R$);Saldo (R$)\n"
        "02/10/2026;FARMÁCIA POPULAR;000130;-32,40;4.482,33\n"
    ).encode("cp1252")
    second = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "outubro.csv", october)
    )

    assert second["status"] == "awaiting_review"
    assert _lines(second) == [("2026-10-02", "expense", 3_240, "FARMÁCIA POPULAR")]


async def test_a_template_belongs_to_the_user_who_made_it(
    client_a: AsyncClient, client_b: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    first = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )
    await _map(client_a, first)
    account_of_b = await create_account(client_b)

    of_b = await _processed(
        client_b, run_jobs, await upload(client_b, account_of_b, "extrato_ponto_e_virgula.csv")
    )

    assert of_b["status"] == "awaiting_mapping"


async def test_a_spreadsheet_and_separate_income_and_expense_columns(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    sheet = await _processed(client_a, run_jobs, await upload(client_a, checking, "extrato.xlsx"))
    split = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_entrada_saida.csv")
    )
    assert (sheet["format"], sheet["status"]) == ("xlsx", "awaiting_mapping")
    assert (split["format"], split["status"]) == ("csv", "awaiting_mapping")

    # O palpite do sistema já serve para os dois.
    for record in (sheet, split):
        response = await client_a.post(
            f"{IMPORTS}/{record['id']}/mapping", json=record["mapping_preview"]["suggestion"]
        )
        assert response.status_code == 202, response.text
    await run_jobs()

    assert [line[:3] for line in _lines(await get_import(client_a, sheet))] == [
        ("2026-09-05", "income", 545_000),
        ("2026-09-10", "expense", 4_590),
        ("2026-09-15", "expense", 18_937),
    ]
    assert [line[:3] for line in _lines(await get_import(client_a, split))] == [
        ("2026-09-05", "income", 545_000),
        ("2026-09-10", "expense", 4_590),
        ("2026-09-13", "income", 10_000),
        ("2026-09-15", "expense", 23_015),
    ]


async def test_a_mapping_that_cannot_read_the_file_asks_again_without_a_new_upload(
    client_a: AsyncClient, checking: Json, upload_dir: Path, run_jobs: JobRunner
) -> None:
    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )

    # Mês e dia trocados: "15/09/2026" não existe como data americana.
    await _map(client_a, record, date_format="mdy")
    record = await _processed(client_a, run_jobs, record)

    assert record["status"] == "awaiting_mapping"
    assert record["error_code"] == "mapping_mismatch"
    assert "formato da data" in record["error_message"]
    assert record["mapping_preview"]["columns"][0] == "Data"
    assert record["items"] is None
    assert len(stored_files(upload_dir)) == 1
    assert (await list_transactions(client_a))["total_count"] == 0

    # Com o formato certo, a mesma importação segue, e o erro some.
    await _map(client_a, record)
    record = await _processed(client_a, run_jobs, record)
    assert (record["status"], record["error_code"]) == ("awaiting_review", None)
    assert record["item_count"] == 4


async def test_a_wrong_template_is_not_kept_for_the_next_files(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )
    await _map(client_a, record, decimal_separator=".")
    await run_jobs()

    again = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )

    assert (again["status"], again["error_code"]) == ("awaiting_mapping", None)


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"amount_column": 9}, "amount_column"),
        ({"description_column": 0}, "description_column"),
        ({"amount_column": None}, "amount_column"),
        ({"amount_column": None, "income_column": 3}, "amount_column"),
        ({"income_column": 2, "expense_column": 4}, "amount_column"),
        ({"date_format": "anos"}, "date_format"),
        ({"decimal_separator": ";"}, "decimal_separator"),
        ({"date_column": -1}, "date_column"),
    ],
    ids=[
        "coluna que não existe",
        "mesma coluna duas vezes",
        "sem coluna de valor",
        "só a coluna de entrada",
        "valor e entrada/saída juntos",
        "formato de data inválido",
        "separador inválido",
        "coluna negativa",
    ],
)
async def test_a_mapping_that_makes_no_sense_is_refused_with_the_field_to_fix(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner, changes: Json, field: str
) -> None:
    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "extrato_ponto_e_virgula.csv")
    )

    fields = _field_errors(await _map(client_a, record, **changes))

    assert field in fields
    assert (await get_import(client_a, record))["status"] == "awaiting_mapping"


async def test_mapping_is_only_accepted_while_the_import_waits_for_it(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner
) -> None:
    in_review = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )
    # Ainda na fila: o worker não leu o arquivo.
    queued = await upload(client_a, checking, "extrato_ponto_e_virgula.csv")

    for record in (queued, in_review):
        response = await _map(client_a, record)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "import_not_awaiting_mapping"


# ---------- falhas


@pytest.mark.parametrize(
    ("name", "content", "code", "message"),
    [
        ("vazio.ofx", b"<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>", "no_transactions", "período"),
        (
            "quebrado.ofx",
            b"<OFX><STMTRS><STMTTRN><DTPOSTED>ontem<TRNAMT>-1.00</STMTTRN></STMTRS></OFX>",
            "unreadable",
            "Exporte o extrato de novo",
        ),
        ("cabecalho.csv", b"Data;Descricao;Valor\n", "no_transactions", "período"),
    ],
    ids=["ofx sem lançamentos", "ofx ilegível", "csv só com cabeçalho"],
)
async def test_a_file_that_cannot_be_read_fails_and_saves_nothing(
    client_a: AsyncClient,
    checking: Json,
    upload_dir: Path,
    run_jobs: JobRunner,
    name: str,
    content: bytes,
    code: str,
    message: str,
) -> None:
    record = await _processed(client_a, run_jobs, await upload(client_a, checking, name, content))

    assert record["status"] == "failed"
    assert record["error_code"] == code
    assert message in record["error_message"]
    assert (record["items"], record["item_count"], record["expires_at"]) == (None, 0, None)
    assert (await list_transactions(client_a))["total_count"] == 0
    assert stored_files(upload_dir) == []


async def test_a_crash_while_reading_fails_the_import_and_leaves_no_proposed_lines(
    client_a: AsyncClient,
    checking: Json,
    session: AsyncSession,
    user_a: User,
    upload_dir: Path,
    run_jobs: JobRunner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Falha depois de as linhas propostas já terem sido gravadas: ao apagar o arquivo lido.
    delete = storage.delete
    calls = 0

    async def crash_once(stored_filename: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("detalhe que não pode chegar ao usuário")
        await delete(stored_filename)

    monkeypatch.setattr(storage, "delete", crash_once)
    sent = await upload(client_a, checking, "banco_azul.ofx")

    await run_jobs()
    record = await get_import(client_a, sent)

    assert (record["status"], record["error_code"]) == ("failed", "processing_error")
    assert "Nada foi salvo" in record["error_message"]
    assert "detalhe" not in str(record)
    assert await ImportRepository(session).list_items(user_a.id, uuid.UUID(sent["id"])) == []
    assert stored_files(upload_dir) == []


async def test_a_failure_is_recorded_even_if_the_file_cannot_be_deleted(
    client_a: AsyncClient,
    checking: Json,
    upload_dir: Path,
    run_jobs: JobRunner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def disk_error(stored_filename: str) -> None:
        raise PermissionError("disco só para leitura")

    monkeypatch.setattr(storage, "delete", disk_error)
    sent = await upload(client_a, checking, "vazio.ofx", b"<OFX><STMTRS></STMTRS></OFX>")

    record = await _processed(client_a, run_jobs, sent)

    # O usuário fica sabendo da falha; o arquivo que sobrou sai depois, na limpeza periódica.
    assert (record["status"], record["error_code"]) == ("failed", "no_transactions")
    assert len(stored_files(upload_dir)) == 1


async def test_a_file_that_disappeared_fails_with_what_to_do(
    client_a: AsyncClient, checking: Json, upload_dir: Path, run_jobs: JobRunner
) -> None:
    sent = await upload(client_a, checking, "banco_azul.ofx")
    for stored in stored_files(upload_dir):
        stored.unlink()

    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["error_code"]) == ("failed", "file_missing")
    assert "Envie o arquivo de novo" in record["error_message"]


async def test_a_file_with_too_many_transactions_is_refused(
    client_a: AsyncClient, checking: Json, run_jobs: JobRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.modules.imports.service.MAX_TRANSACTIONS", 3)

    record = await _processed(
        client_a, run_jobs, await upload(client_a, checking, "banco_azul.ofx")
    )

    assert (record["status"], record["error_code"]) == ("failed", "too_many_rows")
    assert "período menor" in record["error_message"]


async def test_a_repeated_bank_id_inside_the_file_is_kept_only_once(
    client_a: AsyncClient,
    checking: Json,
    session: AsyncSession,
    user_a: User,
    run_jobs: JobRunner,
) -> None:
    # O banco só aceita um identificador externo por conta; alguns bancos o repetem no arquivo.
    line = "<STMTTRN><DTPOSTED>20260910<TRNAMT>-10.00<FITID>REPETIDO<MEMO>COMPRA {}</STMTTRN>"
    content = f"<OFX><STMTRS>{line.format('A')}{line.format('B')}</STMTRS></OFX>".encode()

    sent = await upload(client_a, checking, "repetido.ofx", content)
    await run_jobs()

    items = await ImportRepository(session).list_items(user_a.id, uuid.UUID(sent["id"]))
    assert [item.external_id for item in items] == ["REPETIDO", None]
    assert (await get_import(client_a, sent))["status"] == ImportStatus.AWAITING_REVIEW

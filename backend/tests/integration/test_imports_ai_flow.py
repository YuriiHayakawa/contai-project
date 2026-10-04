"""Importação de PDF e imagem, lidos por IA: do aviso até a revisão (FR-041 a FR-045, FR-072).

O provedor é o simulado. O envio confere o aceite do aviso e o limite do dia; quem lê o
documento é o worker, em uma chamada só, e o resultado entra na mesma revisão dos outros
formatos.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.fake import FakeLLMProvider
from app.ai.models import AiTask, AiUsage
from app.ai.provider import (
    LLMError,
    LLMQuotaExhausted,
    LLMRateLimited,
    LLMUnavailable,
)
from app.core import clock
from app.core.config import get_settings
from app.modules.users.models import User
from app.worker.models import Job, JobStatus
from tests.conftest import JobRunner
from tests.finance import create_account, create_category, list_transactions
from tests.imports import (
    IMPORTS,
    confirm,
    decisions,
    get_import,
    send_file,
    stored_files,
    upload,
)

Json = dict[str, Any]

pytestmark = pytest.mark.usefixtures("frozen_time", "upload_dir")

CONSENT = "/api/v1/users/me/consents/ai-documents"
PROFILE = "/api/v1/users/me"

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"
ENCRYPTED_PDF = PDF.replace(b"%%EOF", b"trailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF")
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64


def _line(description: str, amount: str, day: str, direction: str = "out") -> Json:
    return {"date": day, "description": description, "amount": amount, "direction": direction}


INVOICE: Json = {
    "lines": [
        _line("PADARIA SAO JOAO", "45,90", "2026-09-10"),
        _line("SUPERMERCADO BOM PRECO", "1.234,56", "2026-09-12"),
        _line("ESTORNO LIVRARIA LETRAS", "30,00", "2026-09-15", "in"),
    ],
    "total": "1.250,46",
}
RECEIPT: Json = {
    "amount": "32,50",
    "date": "2026-09-28",
    "description": "Padaria São João",
    "direction": "out",
}


@pytest.fixture(autouse=True)
def _models(monkeypatch: pytest.MonkeyPatch) -> None:
    """Um modelo de extração e o reserva dele; a segunda tentativa não espera."""
    monkeypatch.setattr(get_settings(), "ai_model_extraction", "principal")
    monkeypatch.setattr(get_settings(), "ai_model_extraction_fallback", "reserva")
    monkeypatch.setattr("app.ai.fallback.RETRY_DELAY_SECONDS", 0)


@pytest_asyncio.fixture
async def card(client_a: AsyncClient) -> Json:
    return await create_account(
        client_a, name="Cartão Verde", type="credit_card", closing_day=3, due_day=10
    )


@pytest_asyncio.fixture
async def consent(client_a: AsyncClient) -> None:
    """O usuário já viu e aceitou o aviso do envio de PDF e imagem."""
    assert (await client_a.post(CONSENT)).status_code == 204


async def _processed(client: AsyncClient, run_jobs: JobRunner, record: Json) -> Json:
    await run_jobs()
    return await get_import(client, record)


async def _usage(session: AsyncSession) -> list[tuple[str, str, bool]]:
    rows = await session.execute(select(AiUsage.task, AiUsage.model, AiUsage.counts_toward_limit))
    return sorted((str(task), model, counts) for task, model, counts in rows)


async def _job(session: AsyncSession) -> Job:
    result = await session.execute(select(Job).execution_options(populate_existing=True))
    return result.scalar_one()


def _documents_sent(fake_llm: FakeLLMProvider) -> list[tuple[str, str, bytes]]:
    """As chamadas que levaram um documento ao modelo: modelo, tipo e conteúdo do anexo."""
    return [
        (call.model, attachment.mime_type, attachment.data)
        for call in fake_llm.calls
        for attachment in call.attachments
    ]


# ---------- o aviso antes do primeiro envio (FR-044)


@pytest.mark.parametrize(
    ("content", "kind"),
    [(PDF, "statement"), (PDF, "receipt"), (PNG, "receipt"), (JPEG, "receipt")],
    ids=["fatura em pdf", "comprovante em pdf", "foto png", "foto jpeg"],
)
async def test_a_pdf_or_a_picture_is_refused_without_the_consent(
    client_a: AsyncClient,
    card: Json,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    content: bytes,
    kind: str,
) -> None:
    response = await send_file(client_a, card, "documento", content, kind=kind)

    assert response.status_code == 403, response.text
    error = response.json()["error"]
    assert error["code"] == "ai_consent_required"
    assert "serviço de IA externo" in error["message"]
    assert "melhorar seus modelos" in error["message"]
    # Nada foi guardado, enfileirado nem enviado ao serviço de IA.
    assert stored_files(upload_dir) == []
    assert await run_jobs() == 0
    assert fake_llm.calls == []


async def test_accepting_the_notice_is_recorded_and_keeps_the_first_date(
    client_a: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    assert (await client_a.get(PROFILE)).json()["ai_documents_consent"] is False

    assert (await client_a.post(CONSENT)).status_code == 204
    clock.set_fixed_time(frozen_time + timedelta(minutes=10))
    assert (await client_a.post(CONSENT)).status_code == 204

    assert (await client_a.get(PROFILE)).json()["ai_documents_consent"] is True
    await session.refresh(user_a)
    assert user_a.ai_documents_consent_at == frozen_time


async def test_the_consent_of_one_user_does_not_serve_another(
    client_a: AsyncClient, client_b: AsyncClient, consent: None
) -> None:
    account_of_b = await create_account(client_b)

    response = await send_file(client_b, account_of_b, "fatura.pdf", PDF)

    assert response.status_code == 403, response.text
    assert (await client_b.get(PROFILE)).json()["ai_documents_consent"] is False


async def test_files_read_without_ai_do_not_ask_for_the_consent(
    client_a: AsyncClient, card: Json
) -> None:
    record = await upload(client_a, card, "cartao_verde.ofx")

    assert record["status"] == "queued"


async def test_after_the_consent_the_document_is_stored_and_queued(
    client_a: AsyncClient, card: Json, consent: None, upload_dir: Path
) -> None:
    statement = await upload(client_a, card, "fatura.pdf", PDF)
    receipt = (await send_file(client_a, card, "recibo.png", PNG, kind="receipt")).json()

    assert (statement["status"], statement["kind"], statement["format"]) == (
        "queued",
        "statement",
        "pdf",
    )
    assert (receipt["status"], receipt["kind"], receipt["format"]) == ("queued", "receipt", "image")
    assert sorted(path.read_bytes() for path in stored_files(upload_dir)) == sorted([PDF, PNG])


# ---------- o que não é aceito


async def test_a_pdf_with_a_password_is_refused_with_what_to_do(
    client_a: AsyncClient, card: Json, consent: None, upload_dir: Path
) -> None:
    response = await send_file(client_a, card, "fatura.pdf", ENCRYPTED_PDF)

    assert response.status_code == 415, response.text
    error = response.json()["error"]
    assert error["code"] == "unsupported_file"
    assert "protegido por senha" in error["message"]
    assert "cópia sem senha" in error["message"]
    assert stored_files(upload_dir) == []


async def test_a_picture_is_only_read_as_a_receipt(
    client_a: AsyncClient, card: Json, consent: None, upload_dir: Path
) -> None:
    response = await send_file(client_a, card, "extrato.png", PNG)

    assert response.status_code == 422, response.text
    fields = response.json()["error"]["details"]["fields"]
    assert set(fields) == {"kind"}
    assert "Comprovante" in fields["kind"]
    assert stored_files(upload_dir) == []


# ---------- limite diário de extrações (FR-071)


async def test_the_daily_limit_counts_what_was_read_and_what_is_in_the_queue(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    frozen_time: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_daily_extraction_limit", 2)
    fake_llm.queue_structured(INVOICE)
    await _processed(client_a, run_jobs, await upload(client_a, card, "setembro.pdf", PDF))
    # O segundo ainda está na fila: já conta, embora o uso só seja gravado quando ele é lido.
    queued = await send_file(client_a, card, "recibo.png", PNG, kind="receipt")
    assert queued.status_code == 202, queued.text

    blocked = await send_file(client_a, card, "outro.pdf", PDF + b"%outro")

    assert blocked.status_code == 429, blocked.text
    error = blocked.json()["error"]
    assert error["code"] == "ai_limit_reached"
    assert "Amanhã você pode enviar de novo" in error["message"]
    assert datetime.fromisoformat(error["details"]["resets_at"]) == datetime.fromisoformat(
        "2026-10-02T00:00:00-03:00"
    )
    assert len(stored_files(upload_dir)) == 1
    # O resto do app continua: um OFX não usa IA e não conta no limite.
    assert (await send_file(client_a, card, "cartao_verde.ofx")).status_code == 202


async def test_the_daily_limit_is_of_each_user(
    client_a: AsyncClient,
    client_b: AsyncClient,
    card: Json,
    consent: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_daily_extraction_limit", 1)
    account_of_b = await create_account(client_b)
    assert (await client_b.post(CONSENT)).status_code == 204
    await upload(client_a, card, "fatura.pdf", PDF)

    assert (await send_file(client_a, card, "outra.pdf", PDF)).status_code == 429
    assert (await send_file(client_b, account_of_b, "fatura.pdf", PDF)).status_code == 202


# ---------- extrato ou fatura em PDF


async def test_a_pdf_statement_goes_to_the_same_review_with_the_total_checked(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
) -> None:
    market = await create_category(client_a, name="Mercado")
    fake_llm.queue_structured(INVOICE)
    # A sugestão de categoria é outro pedido, só com as descrições: aqui, a padaria.
    fake_llm.queue_structured({"assignments": [{"description": 0, "category": 0}]})

    sent = await upload(client_a, card, "fatura de setembro.pdf", PDF)
    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["error_code"], record["item_count"]) == (
        "awaiting_review",
        None,
        3,
    )
    assert [
        (item["date"], item["type"], item["amount_cents"], item["description"])
        for item in record["items"]
    ] == [
        ("2026-09-10", "expense", 4_590, "PADARIA SAO JOAO"),
        ("2026-09-12", "expense", 123_456, "SUPERMERCADO BOM PRECO"),
        ("2026-09-15", "income", 3_000, "ESTORNO LIVRARIA LETRAS"),
    ]
    assert record["items"][0]["suggested_category_id"] == market["id"]
    assert record["total_check"] == {
        "document_total_cents": 125_046,
        "extracted_total_cents": 125_046,
        "matches": True,
    }
    assert record["expires_at"] is not None
    # Uma chamada com o documento, inteiro; a de categorias não leva o arquivo.
    assert _documents_sent(fake_llm) == [("principal", "application/pdf", PDF)]
    assert [bool(call.attachments) for call in fake_llm.calls] == [True, False]
    assert await _usage(session) == [
        (AiTask.CATEGORIZATION, "", False),
        (AiTask.STATEMENT_EXTRACTION, "principal", True),
    ]
    # Nada virou lançamento, e o original foi descartado.
    assert (await list_transactions(client_a))["total_count"] == 0
    assert stored_files(upload_dir) == []


async def test_a_sum_that_differs_from_the_total_is_shown_with_both_values(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_structured({**INVOICE, "lines": INVOICE["lines"][:2]})

    record = await _processed(client_a, run_jobs, await upload(client_a, card, "fatura.pdf", PDF))

    # A divergência avisa, e não impede a revisão.
    assert record["status"] == "awaiting_review"
    assert record["total_check"] == {
        "document_total_cents": 125_046,
        "extracted_total_cents": 128_046,
        "matches": False,
    }


async def test_a_statement_without_a_total_has_no_total_check(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_structured({**INVOICE, "total": None})

    record = await _processed(client_a, run_jobs, await upload(client_a, card, "extrato.pdf", PDF))

    assert (record["status"], record["total_check"]) == ("awaiting_review", None)


# ---------- comprovante


@pytest.mark.parametrize(
    ("content", "media_type", "file_format"),
    [(PNG, "image/png", "image"), (JPEG, "image/jpeg", "image"), (PDF, "application/pdf", "pdf")],
    ids=["png", "jpeg", "pdf"],
)
async def test_a_receipt_becomes_a_single_line_that_the_user_confirms(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    content: bytes,
    media_type: str,
    file_format: str,
) -> None:
    fake_llm.queue_structured(RECEIPT)
    sent = (await send_file(client_a, card, "recibo", content, kind="receipt")).json()

    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["kind"], record["format"]) == (
        "awaiting_review",
        "receipt",
        file_format,
    )
    [line] = record["items"]
    assert (line["date"], line["type"], line["amount_cents"], line["description"]) == (
        "2026-09-28",
        "expense",
        3_250,
        "Padaria São João",
    )
    assert record["total_check"] is None
    assert _documents_sent(fake_llm) == [("principal", media_type, content)]
    assert await _usage(session) == [(AiTask.RECEIPT_EXTRACTION, "principal", True)]
    assert (await list_transactions(client_a))["total_count"] == 0
    assert stored_files(upload_dir) == []

    # A mesma confirmação das outras importações: só agora a linha vira lançamento.
    food = await create_category(client_a)
    [decision] = decisions(record)
    saved = await confirm(client_a, record, [{**decision, "category_id": food["id"]}])

    assert (saved["status"], saved["imported_count"]) == ("completed", 1)
    [transaction] = (await list_transactions(client_a))["items"]
    assert (transaction["amount_cents"], transaction["date"], transaction["source"]) == (
        3_250,
        "2026-09-28",
        "import",
    )


# ---------- serviço de IA ocupado, indisponível ou sem cota (FR-072)


async def test_a_busy_model_puts_the_import_back_in_the_queue_without_a_new_upload(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    frozen_time: datetime,
) -> None:
    for _ in range(2):  # o modelo principal e o reserva
        fake_llm.queue_structured_error(LLMRateLimited(40))
    sent = await upload(client_a, card, "fatura.pdf", PDF)

    waiting = await _processed(client_a, run_jobs, sent)

    # A importação não falhou: voltou para a fila, e quem acompanha lê o motivo da espera.
    assert (waiting["status"], waiting["error_code"]) == ("queued", "ai_busy")
    assert "sem você precisar reenviar" in waiting["error_message"]
    assert [path.read_bytes() for path in stored_files(upload_dir)] == [PDF]
    job = await _job(session)
    assert (job.status, job.attempts, job.last_error_code) == (
        JobStatus.QUEUED,
        1,
        "ai_rate_limited",
    )
    # A espera é a que o provedor pediu.
    assert job.run_at == frozen_time + timedelta(seconds=40)
    assert await run_jobs() == 0

    fake_llm.queue_structured(INVOICE)
    clock.set_fixed_time(frozen_time + timedelta(seconds=41))
    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["error_code"], record["item_count"]) == (
        "awaiting_review",
        None,
        3,
    )
    assert stored_files(upload_dir) == []
    assert (await _job(session)).status == JobStatus.SUCCEEDED
    assert await _usage(session) == [(AiTask.STATEMENT_EXTRACTION, "principal", True)]


@pytest.mark.parametrize(
    "failure",
    [LLMUnavailable("503"), LLMRateLimited(), LLMQuotaExhausted()],
    ids=["indisponível", "muitos pedidos", "cota do dia"],
)
async def test_the_fallback_model_reads_the_document_when_the_primary_does_not(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    failure: LLMError,
) -> None:
    fake_llm.queue_structured_error(failure)
    fake_llm.queue_structured(INVOICE)

    record = await _processed(client_a, run_jobs, await upload(client_a, card, "fatura.pdf", PDF))

    assert (record["status"], record["item_count"]) == ("awaiting_review", 3)
    assert [model for model, _, _ in _documents_sent(fake_llm)] == ["principal", "reserva"]
    # O uso fica no nome do modelo que respondeu.
    assert await _usage(session) == [(AiTask.STATEMENT_EXTRACTION, "reserva", True)]
    assert (await _job(session)).attempts == 1


async def test_the_daily_quota_over_in_both_models_fails_without_new_attempts(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    frozen_time: datetime,
) -> None:
    for _ in range(2):
        fake_llm.queue_structured_error(LLMQuotaExhausted(3600 * 9))
    sent = await upload(client_a, card, "fatura.pdf", PDF)

    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["error_code"]) == ("failed", "ai_quota_exhausted")
    assert "limite de hoje do serviço de IA" in record["error_message"]
    assert "volta a funcionar amanhã" in record["error_message"]
    assert "OFX, CSV e planilhas continuam funcionando" in record["error_message"]
    assert (record["items"], record["item_count"]) == (None, 0)
    # Repetir hoje não adianta: o job terminou, e nada fica esperando outra tentativa.
    job = await _job(session)
    assert (job.status, job.attempts) == (JobStatus.SUCCEEDED, 1)
    clock.set_fixed_time(frozen_time + timedelta(minutes=10))
    assert await run_jobs() == 0
    assert len(_documents_sent(fake_llm)) == 2
    assert stored_files(upload_dir) == []
    assert await _usage(session) == []
    assert (await list_transactions(client_a))["total_count"] == 0


async def test_a_model_that_never_answers_fails_the_import_after_the_attempts(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    frozen_time: datetime,
) -> None:
    for _ in range(6):  # três tentativas, cada uma no modelo principal e no reserva
        fake_llm.queue_structured_error(LLMUnavailable("503"))
    sent = await upload(client_a, card, "fatura.pdf", PDF)

    states = []
    for attempt in range(3):
        # Cada espera é maior que a anterior, e todas cabem em dois minutos.
        clock.set_fixed_time(frozen_time + timedelta(minutes=2 * attempt))
        record = await _processed(client_a, run_jobs, sent)
        states.append((record["status"], record["error_code"]))

    assert states == [("queued", "ai_busy"), ("queued", "ai_busy"), ("failed", "ai_unavailable")]
    assert "Envie o arquivo de novo daqui a alguns minutos" in record["error_message"]
    job = await _job(session)
    assert (job.status, job.attempts, job.last_error_code) == (
        JobStatus.FAILED,
        3,
        "ai_unavailable",
    )
    assert len(_documents_sent(fake_llm)) == 6
    assert stored_files(upload_dir) == []
    assert await _usage(session) == []


# ---------- documento que não dá para ler


@pytest.mark.parametrize(
    ("answer", "extractions_counted"),
    [
        ({"lines": [], "total": None}, 1),
        ({"lines": [_line("COMPRA", "45,90", "sem data")], "total": None}, 1),
        ({"resposta": "não é um extrato"}, 0),
    ],
    ids=["sem lançamentos", "linha ilegível", "resposta fora do schema"],
)
async def test_a_document_that_cannot_be_read_fails_and_saves_nothing(
    client_a: AsyncClient,
    card: Json,
    consent: None,
    session: AsyncSession,
    upload_dir: Path,
    run_jobs: JobRunner,
    fake_llm: FakeLLMProvider,
    answer: Json,
    extractions_counted: int,
) -> None:
    sent = await upload(client_a, card, "foto de um gato.pdf", PDF)
    fake_llm.queue_structured(answer)

    record = await _processed(client_a, run_jobs, sent)

    assert (record["status"], record["error_code"]) == ("failed", "document_unreadable")
    assert "Nada foi salvo" in record["error_message"]
    assert "inteiro e nítido" in record["error_message"]
    assert (record["items"], record["item_count"], record["total_check"]) == (None, 0, None)
    assert (await list_transactions(client_a))["total_count"] == 0
    assert stored_files(upload_dir) == []
    # Não há nova tentativa, e a leitura feita conta no limite do dia mesmo sem resultado.
    assert (await _job(session)).status == JobStatus.SUCCEEDED
    assert len(await _usage(session)) == extractions_counted
    assert (await client_a.get(f"{IMPORTS}/{sent['id']}")).json()["status"] == "failed"

"""Importador de comprovante, recibo ou nota fiscal, em foto ou PDF, lido por IA (FR-042)."""

from datetime import date
from typing import Any

import pytest

from app.ai.fake import FakeLLMProvider
from app.ai.models import AiTask
from app.core.config import get_settings
from app.modules.accounts.models import AccountType
from app.modules.imports.importers import ai_document, find_importer
from app.modules.imports.importers.base import (
    DOCUMENT_UNREADABLE,
    ImportContext,
    ImportFailed,
    ProposedTransaction,
)
from app.modules.imports.importers.receipt_ai import PROMPT, ReceiptAiImporter
from app.modules.imports.models import ImportFormat, ImportKind
from app.modules.transactions.models import TransactionType
from tests.imports import stored_file

pytestmark = pytest.mark.usefixtures("upload_dir")

TODAY = date(2026, 10, 1)
CONTEXT = ImportContext(account_type=AccountType.CHECKING, today=TODAY)
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n"

Json = dict[str, Any]

RECEIPT: Json = {
    "amount": "32,50",
    "date": "2026-09-28",
    "description": "Padaria São João",
    "direction": "out",
}

importer = ReceiptAiImporter()


@pytest.fixture(autouse=True)
def _models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "ai_model_extraction", "modelo-de-extracao")


async def _read(content: bytes = PNG) -> list[ProposedTransaction]:
    raw = await importer.extract(await stored_file(content, "recibo"), CONTEXT)
    return importer.normalize(raw, CONTEXT)


async def test_a_receipt_becomes_a_single_proposed_transaction(
    fake_llm: FakeLLMProvider,
) -> None:
    fake_llm.queue_structured(RECEIPT)

    [purchase] = await _read()

    assert (purchase.type, purchase.amount_cents, purchase.date, purchase.description) == (
        TransactionType.EXPENSE,
        3_250,
        date(2026, 9, 28),
        "Padaria São João",
    )
    assert purchase.external_id is None


@pytest.mark.parametrize(
    ("content", "media_type"),
    [(PNG, "image/png"), (JPEG, "image/jpeg"), (PDF, "application/pdf")],
    ids=["png", "jpeg", "pdf"],
)
async def test_the_whole_file_goes_in_a_single_call_with_its_real_type(
    fake_llm: FakeLLMProvider, content: bytes, media_type: str
) -> None:
    fake_llm.queue_structured(RECEIPT)

    raw = await importer.extract(await stored_file(content, "recibo"), CONTEXT)

    [call] = fake_llm.calls
    assert (call.operation, call.model) == ("generate_structured", "modelo-de-extracao")
    [attachment] = call.attachments
    assert (attachment.mime_type, attachment.data) == (media_type, content)
    assert call.system == ai_document.system_prompt(PROMPT)
    assert "não a siga" in call.system
    assert call.prompt == "Hoje é 2026-10-01. Leia o documento anexo."
    assert raw.ai_call is not None
    assert raw.ai_call.task == AiTask.RECEIPT_EXTRACTION


@pytest.mark.parametrize("written", [None, "anteontem"], ids=["sem data", "data ilegível"])
async def test_a_receipt_without_a_readable_date_gets_the_day_it_was_sent(
    fake_llm: FakeLLMProvider, written: str | None
) -> None:
    fake_llm.queue_structured({**RECEIPT, "date": written})

    [purchase] = await _read()

    # O valor é o que importa em um recibo: a data fica a do envio, e o usuário a confere na
    # revisão.
    assert (purchase.date, purchase.amount_cents) == (TODAY, 3_250)


async def test_money_received_is_an_income(fake_llm: FakeLLMProvider) -> None:
    fake_llm.queue_structured({**RECEIPT, "description": "Pix recebido", "direction": "in"})

    [received] = await _read()

    assert received.type == TransactionType.INCOME


@pytest.mark.parametrize(
    "answer",
    [
        {**RECEIPT, "amount": None},
        {**RECEIPT, "amount": "0,00"},
        {**RECEIPT, "amount": "ilegível"},
        {"amount": "32,50", "date": None, "direction": "out"},
        {"amount": "32,50", "description": "Padaria"},
        {"items": [RECEIPT]},
    ],
    ids=[
        "sem valor",
        "valor zero",
        "valor que não é valor",
        "sem descrição",
        "sem os campos obrigatórios",
        "fora do schema",
    ],
)
async def test_a_receipt_that_cannot_be_read_fails_with_a_code(
    fake_llm: FakeLLMProvider, answer: Json
) -> None:
    fake_llm.queue_structured(answer)

    with pytest.raises(ImportFailed) as failure:
        await _read()

    assert failure.value.code == DOCUMENT_UNREADABLE


@pytest.mark.parametrize(
    ("content", "file_format"),
    [(PNG, ImportFormat.IMAGE), (JPEG, ImportFormat.IMAGE), (PDF, ImportFormat.PDF)],
    ids=["png", "jpeg", "pdf"],
)
def test_a_picture_or_a_pdf_sent_as_a_receipt_goes_to_this_importer(
    content: bytes, file_format: ImportFormat
) -> None:
    found = find_importer(content, "recibo", file_format, ImportKind.RECEIPT)

    assert isinstance(found, ReceiptAiImporter)


def test_an_ofx_is_never_a_receipt() -> None:
    assert find_importer(b"<OFX>", "extrato.ofx", ImportFormat.OFX, ImportKind.RECEIPT) is None

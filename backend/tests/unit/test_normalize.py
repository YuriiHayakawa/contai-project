import uuid
from datetime import date

import pytest

from app.modules.transactions.normalize import fingerprint, normalize_description

ACCOUNT = uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest.mark.parametrize(
    ("description", "normalized"),
    [
        ("Padaria São João", "padaria sao joao"),
        ("PADARIA SAO JOAO", "padaria sao joao"),
        ("PAG*Padaria São João 12/05 #4821", "pag padaria sao joao"),
        ("Mercado - Compra 2026-10-01", "mercado compra"),
        ("  Posto   Ipiranga,  Av. Brasil  ", "posto ipiranga av brasil"),
        ("UBER *TRIP 0123456", "uber trip"),
        ("Açaí & Cia.", "acai cia"),
        ("uber2 3x", "uber2 3x"),
        ("Farmácia 24h", "farmacia 24h"),
        ("12/05/2026", ""),
        ("", ""),
    ],
)
def test_normalize_description(description: str, normalized: str) -> None:
    assert normalize_description(description) == normalized


def test_descriptions_that_differ_only_by_case_accents_numbers_or_dates_are_equal() -> None:
    variants = ["Padaria São João 01/10", "PADARIA SAO JOAO 15/10 #99", "padaria, são joão."]

    assert len({normalize_description(variant) for variant in variants}) == 1


def _fingerprint(**overrides: object) -> str:
    values: dict[str, object] = {
        "account_id": ACCOUNT,
        "date": date(2026, 10, 1),
        "transaction_type": "expense",
        "amount_cents": 4590,
        "description_normalized": "padaria sao joao",
        **overrides,
    }
    return fingerprint(**values)  # type: ignore[arg-type]


def test_fingerprint_is_a_deterministic_sha256() -> None:
    first, second = _fingerprint(), _fingerprint()

    assert first == second
    assert len(first) == 64
    assert int(first, 16) >= 0


@pytest.mark.parametrize(
    "change",
    [
        {"account_id": uuid.UUID("22222222-2222-2222-2222-222222222222")},
        {"date": date(2026, 10, 2)},
        {"transaction_type": "income"},
        {"amount_cents": 4591},
        {"description_normalized": "padaria"},
    ],
    ids=["conta", "data", "tipo", "valor", "descrição"],
)
def test_fingerprint_changes_with_each_of_its_five_parts(change: dict[str, object]) -> None:
    assert _fingerprint(**change) != _fingerprint()


def test_fields_do_not_run_together_in_the_fingerprint() -> None:
    # "45" + "90 x" e "4590" + "x" não podem dar o mesmo hash.
    assert _fingerprint(amount_cents=45, description_normalized="90 x") != _fingerprint(
        amount_cents=4590, description_normalized="x"
    )

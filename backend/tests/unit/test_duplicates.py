"""Detecção de duplicatas: identificador externo, impressão digital e lançamento provável."""

import uuid
from datetime import date, timedelta

import pytest

from app.modules.imports.duplicates import (
    Candidate,
    DuplicateMatch,
    ExistingTransaction,
    classify,
)
from app.modules.imports.models import DuplicateStatus
from app.modules.transactions.models import TransactionType, TransferDirection

EXPENSE, INCOME, TRANSFER = (
    TransactionType.EXPENSE,
    TransactionType.INCOME,
    TransactionType.TRANSFER,
)
NONE, EXACT, PROBABLE = DuplicateStatus.NONE, DuplicateStatus.EXACT, DuplicateStatus.PROBABLE
DAY = date(2026, 9, 15)


def _line(
    fingerprint: str = "padaria",
    *,
    amount_cents: int = 4_590,
    day: date = DAY,
    kind: TransactionType = EXPENSE,
    external_id: str | None = None,
) -> Candidate:
    return Candidate(
        type=kind,
        amount_cents=amount_cents,
        date=day,
        fingerprint=fingerprint,
        external_id=external_id,
    )


def _saved(
    fingerprint: str = "padaria",
    *,
    amount_cents: int = 4_590,
    day: date = DAY,
    kind: TransactionType = EXPENSE,
    external_id: str | None = None,
    transfer_direction: TransferDirection | None = None,
) -> ExistingTransaction:
    return ExistingTransaction(
        id=uuid.uuid4(),
        type=kind,
        amount_cents=amount_cents,
        date=day,
        fingerprint=fingerprint,
        external_id=external_id,
        transfer_direction=transfer_direction,
    )


def _statuses(matches: list[DuplicateMatch]) -> list[DuplicateStatus]:
    return [match.status for match in matches]


def test_a_line_whose_external_id_is_already_in_the_account_is_exact() -> None:
    saved = _saved("texto antigo", external_id="FIT-1")

    # O identificador do banco basta, mesmo que o usuário tenha editado a descrição ou a data.
    [match] = classify([_line("texto novo", external_id="FIT-1", day=DAY + timedelta(30))], [saved])

    assert (match.status, match.duplicate_of_id) == (EXACT, saved.id)


def test_a_new_file_has_no_duplicates() -> None:
    matches = classify([_line(external_id="FIT-1"), _line("mercado", amount_cents=100)], [])

    assert _statuses(matches) == [NONE, NONE]
    assert all(match.duplicate_of_id is None for match in matches)


def test_the_fingerprint_is_compared_by_count() -> None:
    # Duas compras idênticas no mesmo dia são legítimas: com uma já salva, só uma é duplicata.
    saved = _saved()

    matches = classify([_line(), _line()], [saved])

    assert _statuses(matches) == [EXACT, NONE]
    assert matches[0].duplicate_of_id == saved.id


def test_two_saved_and_three_in_the_file_leave_one_new() -> None:
    matches = classify([_line(), _line(), _line()], [_saved(), _saved()])

    assert _statuses(matches) == [EXACT, EXACT, NONE]


def test_importing_the_same_file_again_marks_every_line_as_exact() -> None:
    lines = [
        _line("salario", amount_cents=545_000, kind=INCOME, external_id="A"),
        _line("padaria", external_id="B"),
        _line("padaria", external_id="C"),
        _line("pix", amount_cents=35_000, kind=INCOME),
    ]
    saved = [
        _saved(
            line.fingerprint,
            amount_cents=line.amount_cents,
            kind=line.type,
            external_id=line.external_id,
        )
        for line in lines
    ]

    assert _statuses(classify(lines, saved)) == [EXACT] * 4


@pytest.mark.parametrize("days", [-3, -1, 0, 2, 3])
def test_same_amount_and_type_within_three_days_is_probable(days: int) -> None:
    # A descrição não importa: é o que pega o lançamento feito à mão.
    manual = _saved("almoco", day=DAY + timedelta(days))

    [match] = classify([_line("restaurante do ze")], [manual])

    assert (match.status, match.duplicate_of_id) == (PROBABLE, manual.id)


@pytest.mark.parametrize(
    "saved",
    [
        _saved("almoco", day=DAY + timedelta(4)),
        _saved("almoco", day=DAY - timedelta(4)),
        _saved("almoco", amount_cents=4_591),
        _saved("almoco", kind=INCOME),
    ],
    ids=["quatro dias depois", "quatro dias antes", "outro valor", "sentido contrário"],
)
def test_a_different_amount_type_or_a_distant_date_is_not_a_duplicate(
    saved: ExistingTransaction,
) -> None:
    assert _statuses(classify([_line("restaurante do ze")], [saved])) == [NONE]


def test_a_transfer_made_by_hand_matches_the_debit_in_the_statement() -> None:
    # O extrato do banco não sabe o que é transferência: o pagamento da fatura sai como débito.
    payment = _saved("pagamento da fatura", kind=TRANSFER, transfer_direction=TransferDirection.OUT)
    received = _saved("resgate", kind=TRANSFER, transfer_direction=TransferDirection.IN)

    assert _statuses(classify([_line("pagamento fatura cartao")], [payment])) == [PROBABLE]
    assert _statuses(classify([_line("pagamento fatura cartao")], [received])) == [NONE]
    assert _statuses(classify([_line("ted recebida", kind=INCOME)], [received])) == [PROBABLE]


def test_each_saved_transaction_explains_one_line_only() -> None:
    manual = _saved("almoco")

    matches = classify([_line("restaurante a"), _line("restaurante b")], [manual])

    assert _statuses(matches) == [PROBABLE, NONE]


def test_probable_picks_the_saved_transaction_with_the_closest_date() -> None:
    far = _saved("almoco", day=DAY - timedelta(3))
    near = _saved("almoco", day=DAY + timedelta(1))

    [match] = classify([_line("restaurante")], [far, near])

    assert match.duplicate_of_id == near.id


def test_exact_matches_come_before_probable_ones() -> None:
    # A transação salva com o mesmo identificador fica com a linha dela; a lançada à mão, com
    # a outra linha de mesmo valor.
    imported = _saved("padaria", external_id="FIT-1")
    manual = _saved("lanche", day=DAY + timedelta(1))

    matches = classify([_line("cafe"), _line("padaria", external_id="FIT-1")], [imported, manual])

    assert [(match.status, match.duplicate_of_id) for match in matches] == [
        (PROBABLE, manual.id),
        (EXACT, imported.id),
    ]


def test_exact_and_probable_lines_arrive_unselected() -> None:
    saved = [_saved("padaria"), _saved("almoco", amount_cents=3_000, day=DAY + timedelta(2))]
    lines = [
        _line("padaria"),
        _line("restaurante", amount_cents=3_000),
        _line("novo", amount_cents=1),
    ]

    matches = classify(lines, saved)

    assert _statuses(matches) == [EXACT, PROBABLE, NONE]
    assert [match.selected_by_default for match in matches] == [False, False, True]


def test_the_answer_follows_the_order_of_the_file() -> None:
    saved = _saved("c")

    matches = classify(
        [_line("a", amount_cents=1), _line("b", amount_cents=2), _line("c")], [saved]
    )

    assert _statuses(matches) == [NONE, NONE, EXACT]

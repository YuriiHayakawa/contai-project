import pytest

from app.core.money import MINUS, NBSP, format_brl, parse_brl, split_installments


@pytest.mark.parametrize(
    ("total", "count", "expected"),
    [
        (10000, 3, [3334, 3333, 3333]),
        (10000, 2, [5000, 5000]),
        (100, 3, [34, 33, 33]),
        (1, 3, [1, 0, 0]),
        (9999, 1, [9999]),
        (123457, 48, [2573, *([2572] * 47)]),
    ],
)
def test_split_installments(total: int, count: int, expected: list[int]) -> None:
    parts = split_installments(total, count)

    assert parts == expected
    assert sum(parts) == total


@pytest.mark.parametrize(("total", "count"), [(0, 3), (-100, 2), (100, 0)])
def test_split_installments_rejects_invalid_input(total: int, count: int) -> None:
    with pytest.raises(ValueError):
        split_installments(total, count)


@pytest.mark.parametrize(
    ("cents", "expected"),
    [
        (0, f"R${NBSP}0,00"),
        (5, f"R${NBSP}0,05"),
        (4590, f"R${NBSP}45,90"),
        (123456, f"R${NBSP}1.234,56"),
        (100000000, f"R${NBSP}1.000.000,00"),
        (-4590, f"{MINUS}R${NBSP}45,90"),
    ],
)
def test_format_brl(cents: int, expected: str) -> None:
    assert format_brl(cents) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("45", 4500),
        ("45,9", 4590),
        ("45,90", 4590),
        ("1.234,56", 123456),
        ("1234.56", 123456),
        ("12.5", 1250),
        ("1.234", 123400),
        ("1.234.567", 123456700),
        ("R$ 45,90", 4590),
        (f"R${NBSP}1.234,56", 123456),
        (" 0,05 ", 5),
    ],
)
def test_parse_brl(text: str, expected: int) -> None:
    assert parse_brl(text) == expected


@pytest.mark.parametrize("text", ["", "abc", "-45", "45,901", "1,2,3", "12..5", "R$"])
def test_parse_brl_rejects_invalid_values(text: str) -> None:
    with pytest.raises(ValueError):
        parse_brl(text)


def test_parse_and_format_round_trip() -> None:
    assert parse_brl(format_brl(987654321)) == 987654321

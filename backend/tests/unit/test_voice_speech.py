"""As falas da Siri: o valor por extenso e as mensagens de contracts/siri-shortcut.md."""

import pytest

from app.modules.assistant import voice_speech as speech


@pytest.mark.parametrize(
    ("cents", "spoken"),
    [
        (4500, "45 reais"),
        (4590, "45 reais e 90 centavos"),
        (100, "1 real"),
        (101, "1 real e 1 centavo"),
        (90, "90 centavos"),
        (1, "1 centavo"),
        (123400, "1.234 reais"),
        (123456, "1.234 reais e 56 centavos"),
        (100000000, "1.000.000 reais"),
    ],
)
def test_amounts_are_spoken_in_full(cents: int, spoken: str) -> None:
    assert speech.spoken_brl(cents) == spoken


def test_saved_expense_says_amount_category_and_account() -> None:
    assert (
        speech.saved_expense(4590, category="Alimentação", account="Cartão Inter")
        == "Anotei 45 reais e 90 centavos em Alimentação, no Cartão Inter."
    )


def test_saved_income_says_it_is_an_entry() -> None:
    assert (
        speech.saved_income(20000, category="Salário", account="Nubank")
        == "Anotei uma entrada de 200 reais em Salário, na conta Nubank."
    )


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (speech.AMOUNT_NOT_UNDERSTOOD, "Não entendi o valor. Pode repetir dizendo quanto foi?"),
        (
            speech.ACCOUNT_NOT_FOUND,
            "Não encontrei essa conta. Pode repetir dizendo o nome da conta?",
        ),
        (
            speech.ACCOUNT_AMBIGUOUS,
            "Você tem mais de uma conta assim. Pode repetir dizendo qual?",
        ),
        (
            speech.NO_ACCOUNT,
            "Não sei em qual conta lançar. Repita dizendo a conta, ou escolha uma conta padrão "
            "no app.",
        ),
        (speech.FUTURE_DATE, "A data ficou no futuro. Pode repetir dizendo quando foi?"),
        (speech.EMPTY_PHRASE, "Não ouvi nada. Pode repetir?"),
        (speech.MULTIPLE_ENTRIES, "Entendi mais de um gasto. Diga um de cada vez."),
        (
            speech.TRANSFER_OR_INSTALLMENTS,
            "Transferências e compras parceladas não dá para lançar por voz. Lance pelo app ou "
            "pelo site.",
        ),
        (
            speech.QUESTION,
            "Pela Siri eu só anoto gastos e entradas. Para perguntas, use o assistente no app.",
        ),
        (speech.DAILY_LIMIT, "O limite de uso de hoje acabou. Lance esse gasto pelo app."),
        (
            speech.HOURLY_LIMIT,
            "Foram muitos lançamentos em pouco tempo. Tente de novo daqui a pouco.",
        ),
        (
            speech.UNAVAILABLE,
            "Não consegui lançar agora. Nada foi salvo. Tente de novo em alguns minutos.",
        ),
        (
            speech.WAKING,
            "O Contaí está acordando. Nada foi lançado. Tente de novo em um minuto.",
        ),
        (
            speech.UNAUTHORIZED,
            "Não consegui confirmar seu acesso. Abra o app do Contaí e conecte a Siri de novo.",
        ),
    ],
)
def test_messages_match_the_contract(message: str, expected: str) -> None:
    assert message == expected

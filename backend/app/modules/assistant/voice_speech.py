"""O que a Siri fala (contracts/siri-shortcut.md).

As falas são montadas aqui, a partir do resultado, e nunca escritas pelo modelo. O valor é dito
por extenso, porque a leitura de "R$ 45,90" pela voz do iOS varia. Nenhuma fala traz saldo,
outros lançamentos nem dados pessoais (FR-024).
"""

AMOUNT_NOT_UNDERSTOOD = "Não entendi o valor. Pode repetir dizendo quanto foi?"
ACCOUNT_NOT_FOUND = "Não encontrei essa conta. Pode repetir dizendo o nome da conta?"
ACCOUNT_AMBIGUOUS = "Você tem mais de uma conta assim. Pode repetir dizendo qual?"
NO_ACCOUNT = (
    "Não sei em qual conta lançar. Repita dizendo a conta, ou escolha uma conta padrão no app."
)
DATE_NOT_UNDERSTOOD = "Não entendi quando foi. Pode repetir dizendo o dia?"
FUTURE_DATE = "A data ficou no futuro. Pode repetir dizendo quando foi?"
EMPTY_PHRASE = "Não ouvi nada. Pode repetir?"
PHRASE_TOO_LONG = "A frase ficou longa demais. Diga só um gasto, de forma curta."
MULTIPLE_ENTRIES = "Entendi mais de um gasto. Diga um de cada vez."
TRANSFER_OR_INSTALLMENTS = (
    "Transferências e compras parceladas não dá para lançar por voz. Lance pelo app ou pelo site."
)
QUESTION = "Pela Siri eu só anoto gastos e entradas. Para perguntas, use o assistente no app."
DAILY_LIMIT = "O limite de uso de hoje acabou. Lance esse gasto pelo app."
HOURLY_LIMIT = "Foram muitos lançamentos em pouco tempo. Tente de novo daqui a pouco."
UNAVAILABLE = "Não consegui lançar agora. Nada foi salvo. Tente de novo em alguns minutos."
WAKING = "O Contaí está acordando. Nada foi lançado. Tente de novo em um minuto."
UNAUTHORIZED = "Não consegui confirmar seu acesso. Abra o app do Contaí e conecte a Siri de novo."


def _grouped(number: int) -> str:
    return f"{number:,}".replace(",", ".")


def spoken_brl(cents: int) -> str:
    """`4590` vira "45 reais e 90 centavos"; `100` vira "1 real"; `90`, "90 centavos"."""
    reais, centavos = divmod(abs(cents), 100)
    reais_part = "1 real" if reais == 1 else f"{_grouped(reais)} reais"
    centavos_part = "1 centavo" if centavos == 1 else f"{centavos} centavos"
    if centavos == 0:
        return reais_part
    if reais == 0:
        return centavos_part
    return f"{reais_part} e {centavos_part}"


def saved_expense(cents: int, *, category: str, account: str) -> str:
    return f"Anotei {spoken_brl(cents)} em {category}, no {account}."


def saved_income(cents: int, *, category: str, account: str) -> str:
    return f"Anotei uma entrada de {spoken_brl(cents)} em {category}, na conta {account}."

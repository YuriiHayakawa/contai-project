"""Detecção de pagamento de fatura de cartão na importação (FR-081). Regras puras, sem banco.

O pagamento da fatura aparece no extrato da conta como uma saída. No Contaí ele é uma
transferência da conta para o cartão: as compras já contaram como gasto no mês em que foram
feitas, e lançar o pagamento como despesa contaria tudo duas vezes.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.modules.transactions.models import TransactionType

# Trechos da descrição normalizada (minúsculas, sem acentos nem pontuação) que indicam o
# pagamento de uma fatura.
INVOICE_PAYMENT_TERMS = (
    "pagamento fatura",
    "pag fatura",
    "pgto fatura",
    "pagto cartao",
    "fatura cartao",
)


@dataclass(frozen=True)
class CardInvoice:
    """Um cartão do usuário e quanto está em aberto na fatura dele."""

    account_id: uuid.UUID
    open_invoice_cents: int


def is_invoice_payment(transaction_type: TransactionType, description_normalized: str) -> bool:
    """Uma saída cuja descrição traz um dos termos de pagamento de fatura."""
    if transaction_type != TransactionType.EXPENSE:
        return False
    return any(term in description_normalized for term in INVOICE_PAYMENT_TERMS)


def suggest_card(amount_cents: int, cards: Sequence[CardInvoice]) -> uuid.UUID | None:
    """O cartão cuja fatura em aberto tem o valor mais próximo do valor pago.

    Sem cartão cadastrado não há o que sugerir; em empate, vale a ordem em que os cartões
    foram informados. O usuário confirma ou troca na revisão.
    """
    if not cards:
        return None
    closest = min(cards, key=lambda card: abs(card.open_invoice_cents - amount_cents))
    return closest.account_id

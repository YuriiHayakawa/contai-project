"""Detecção de duplicatas na importação (research.md, seção 14). Regras puras, sem banco.

Três níveis, do mais certo ao menos certo:

1. Identificador externo (o FITID do OFX): a conta já tem uma transação com ele → `exact`.
2. Impressão digital (conta, data, tipo, valor e descrição normalizada), comparada por
   contagem: se o arquivo tem duas linhas idênticas e a conta já tem uma, só uma é `exact`.
3. Provável: mesmo sentido do dinheiro e mesmo valor, com até 3 dias de diferença, qualquer
   descrição → `probable`. É o que pega o lançamento feito à mão.

Cada transação existente explica no máximo uma linha do arquivo. Linhas `exact` e `probable`
chegam desmarcadas à revisão (FR-049), e por isso reimportar o mesmo arquivo não duplica nada
(FR-050).
"""

import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from app.modules.imports.models import DuplicateStatus
from app.modules.transactions.models import TransactionType, TransferDirection

PROBABLE_WINDOW = dt.timedelta(days=3)


@dataclass(frozen=True)
class Candidate:
    """Uma linha do arquivo, já com a impressão digital calculada."""

    type: TransactionType
    amount_cents: int
    date: dt.date
    fingerprint: str
    external_id: str | None = None
    transfer_direction: TransferDirection | None = None


@dataclass(frozen=True)
class ExistingTransaction:
    """Uma transação que já está na conta de destino."""

    id: uuid.UUID
    type: TransactionType
    amount_cents: int
    date: dt.date
    fingerprint: str
    external_id: str | None = None
    transfer_direction: TransferDirection | None = None


@dataclass(frozen=True)
class DuplicateMatch:
    status: DuplicateStatus = DuplicateStatus.NONE
    # Transação existente que motivou o aviso.
    duplicate_of_id: uuid.UUID | None = None

    @property
    def selected_by_default(self) -> bool:
        return self.status == DuplicateStatus.NONE


def _money_leaves(
    transaction_type: TransactionType, transfer_direction: TransferDirection | None
) -> bool:
    """Despesa e transferência enviada tiram dinheiro da conta; o resto põe.

    O extrato do banco não sabe o que é transferência: o pagamento de fatura lançado à mão como
    transferência aparece nele como uma saída comum.
    """
    if transaction_type == TransactionType.TRANSFER:
        return transfer_direction == TransferDirection.OUT
    return transaction_type == TransactionType.EXPENSE


def classify(
    candidates: Sequence[Candidate], existing: Sequence[ExistingTransaction]
) -> list[DuplicateMatch]:
    """Diz, para cada linha do arquivo e na mesma ordem, se ela parece já estar na conta."""
    matches: list[DuplicateMatch | None] = [None] * len(candidates)
    used: set[uuid.UUID] = set()

    def mark(index: int, status: DuplicateStatus, transaction: ExistingTransaction) -> None:
        matches[index] = DuplicateMatch(status=status, duplicate_of_id=transaction.id)
        used.add(transaction.id)

    # 1. Identificador externo.
    by_external_id = {item.external_id: item for item in existing if item.external_id}
    for index, candidate in enumerate(candidates):
        found = by_external_id.get(candidate.external_id) if candidate.external_id else None
        if found is not None and found.id not in used:
            mark(index, DuplicateStatus.EXACT, found)

    # 2. Impressão digital, por contagem: cada transação existente explica uma linha só.
    by_fingerprint: dict[str, list[ExistingTransaction]] = defaultdict(list)
    for item in existing:
        if item.id not in used:
            by_fingerprint[item.fingerprint].append(item)
    for index, candidate in enumerate(candidates):
        available = by_fingerprint.get(candidate.fingerprint)
        if matches[index] is None and available:
            mark(index, DuplicateStatus.EXACT, available.pop(0))

    # 3. Provável: mesmo sentido e valor, em data próxima. Fica com a de data mais próxima.
    for index, candidate in enumerate(candidates):
        if matches[index] is not None:
            continue
        leaves = _money_leaves(candidate.type, candidate.transfer_direction)
        near = [
            item
            for item in existing
            if item.id not in used
            and item.amount_cents == candidate.amount_cents
            and _money_leaves(item.type, item.transfer_direction) == leaves
            and abs(item.date - candidate.date) <= PROBABLE_WINDOW
        ]
        if near:
            closest = min(near, key=lambda item: abs(item.date - candidate.date))
            mark(index, DuplicateStatus.PROBABLE, closest)

    return [match or DuplicateMatch() for match in matches]

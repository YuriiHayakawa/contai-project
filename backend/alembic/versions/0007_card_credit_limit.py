"""Limite do cartão de crédito, separado do saldo (FR-019, FR-088).

O único valor do cadastro de um cartão era o saldo inicial, e um limite digitado ali virava
dinheiro a favor do usuário, que escondia a fatura. O limite ganha uma coluna própria, que
nunca entra em saldo nenhum, e o valor inicial de um cartão passa a ser só a dívida que ele já
tinha: negativa ou zero.

Antes de criar as restrições, os cartões antigos com valor inicial positivo são acertados: o
valor tinha sido informado como o limite, vai para a coluna nova, e a dívida inicial fica em
zero. O caminho de volta não devolve esse valor ao saldo inicial.

Revision ID: 0007_card_credit_limit
Revises: 0006_import_item_notes
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_card_credit_limit"
down_revision: str | None = "0006_import_item_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fica à parte para o teste da migração rodar exatamente o que ela roda.
MOVE_POSITIVE_INITIAL_AMOUNT_TO_LIMIT = """
UPDATE accounts
   SET credit_limit_cents = initial_balance_cents,
       initial_balance_cents = 0
 WHERE type = 'credit_card'
   AND initial_balance_cents > 0
"""

_CONSTRAINTS = {
    "ck_accounts_credit_limit_positive": "credit_limit_cents > 0",
    "ck_accounts_credit_limit_only_for_cards": (
        "type = 'credit_card' OR credit_limit_cents IS NULL"
    ),
    "ck_accounts_card_initial_balance_is_debt": (
        "type <> 'credit_card' OR initial_balance_cents <= 0"
    ),
}


def upgrade() -> None:
    op.add_column("accounts", sa.Column("credit_limit_cents", sa.BigInteger()))
    op.execute(MOVE_POSITIVE_INITIAL_AMOUNT_TO_LIMIT)
    for name, condition in _CONSTRAINTS.items():
        op.create_check_constraint(op.f(name), "accounts", condition)


def downgrade() -> None:
    for name in _CONSTRAINTS:
        op.drop_constraint(op.f(name), "accounts", type_="check")
    op.drop_column("accounts", "credit_limit_cents")

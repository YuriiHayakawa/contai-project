"""Bloqueio de login contado por e-mail informado, exista ou não a conta.

As colunas `failed_login_count` e `locked_until` saem de `users`: com a contagem só nas contas,
o bloqueio revelava quais e-mails estavam cadastrados (FR-008).

Revision ID: 0001b_login_attempts
Revises: 0001_core
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001b_login_attempts"
down_revision: str | None = "0001_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "login_attempts",
        sa.Column("email_hash", sa.String(64), nullable=False),
        sa.Column("failed_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email_hash", name="pk_login_attempts"),
        # `op.f` marca o nome como final: sem ele, a convenção de nomes do metadata acrescenta
        # o prefixo de novo e o nome sai dobrado.
        sa.CheckConstraint(
            "failed_count >= 0", name=op.f("ck_login_attempts_failed_count_not_negative")
        ),
    )
    op.create_index("ix_login_attempts_last_failed_at", "login_attempts", ["last_failed_at"])
    # As contagens e os bloqueios em curso nas contas são descartados: valem no máximo
    # 15 minutos, e a chave nova (hash do e-mail) não se calcula no banco.
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_count")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("failed_login_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True)))
    op.drop_index("ix_login_attempts_last_failed_at", table_name="login_attempts")
    op.drop_table("login_attempts")

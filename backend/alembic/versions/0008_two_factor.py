"""Verificação em duas etapas: códigos de recuperação e pedido de desativação (US9).

Cria `recovery_codes` (10 por usuário, uso único) e `two_factor_reset_requests` (o pedido de
desativação de quem perdeu o celular e os códigos, que só vale 72 horas). Os campos de TOTP já
estão em `users` desde a migração inicial.

Revision ID: 0008_two_factor
Revises: 0007_card_credit_limit
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_two_factor"
down_revision: str | None = "0007_card_credit_limit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recovery_codes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recovery_codes")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_recovery_codes_user_id_users"),
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])

    op.create_table(
        "two_factor_reset_requests",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_two_factor_reset_requests")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_two_factor_reset_requests_user_id_users"),
            ondelete="CASCADE",
        ),
    )
    # No máximo um pedido em aberto (nem cancelado nem aplicado) por usuário.
    op.create_index(
        "uq_two_factor_reset_open_per_user",
        "two_factor_reset_requests",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("cancelled_at IS NULL AND applied_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_two_factor_reset_open_per_user", table_name="two_factor_reset_requests")
    op.drop_table("two_factor_reset_requests")
    op.drop_index("ix_recovery_codes_user_id", table_name="recovery_codes")
    op.drop_table("recovery_codes")

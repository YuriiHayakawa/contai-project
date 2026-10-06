"""Contas, categorias e transações.

Revision ID: 0002_finance
Revises: 0001b_login_attempts
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_finance"
down_revision: str | None = "0001b_login_attempts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID_DEFAULT = sa.text("gen_random_uuid()")
_NOW = sa.func.now()


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("institution", sa.String(60)),
        sa.Column(
            "initial_balance_cents", sa.BigInteger(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("initial_balance_date", sa.Date(), nullable=False),
        sa.Column("closing_day", sa.Integer()),
        sa.Column("due_day", sa.Integer()),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_accounts_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "type IN ('checking', 'credit_card', 'cash', 'savings', 'investment')",
            name=op.f("ck_accounts_type_valid"),
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 60", name=op.f("ck_accounts_name_length")
        ),
        sa.CheckConstraint(
            "closing_day BETWEEN 1 AND 31", name=op.f("ck_accounts_closing_day_range")
        ),
        sa.CheckConstraint("due_day BETWEEN 1 AND 31", name=op.f("ck_accounts_due_day_range")),
        sa.CheckConstraint(
            "(type = 'credit_card' AND closing_day IS NOT NULL AND due_day IS NOT NULL) "
            "OR (type <> 'credit_card' AND closing_day IS NULL AND due_day IS NULL)",
            name=op.f("ck_accounts_card_days_match_type"),
        ),
    )
    op.create_index("ix_accounts_user_id", "accounts", ["user_id"])
    op.create_index(
        "uq_accounts_user_id_name_active",
        "accounts",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("parent_id", sa.Uuid()),
        sa.Column("icon", sa.String(40), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("is_fallback", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_categories_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["categories.id"],
            name="fk_categories_parent_id_categories",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("kind IN ('expense', 'income')", name=op.f("ck_categories_kind_valid")),
        sa.CheckConstraint(
            "color IN ('tinta', 'caqui', 'piscina', 'mostarda', 'goiaba', 'mata', 'ameixa', "
            "'pitanga', 'ardosia')",
            name=op.f("ck_categories_color_valid"),
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 40", name=op.f("ck_categories_name_length")
        ),
        sa.CheckConstraint(
            "color <> 'ardosia' OR is_fallback",
            name=op.f("ck_categories_neutral_color_only_fallback"),
        ),
        sa.CheckConstraint(
            "NOT is_fallback OR parent_id IS NULL",
            name=op.f("ck_categories_fallback_is_top_level"),
        ),
        sa.CheckConstraint(
            "NOT is_fallback OR archived_at IS NULL",
            name=op.f("ck_categories_fallback_never_archived"),
        ),
    )
    op.create_index("ix_categories_user_id", "categories", ["user_id"])
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])
    op.create_index(
        "uq_categories_user_id_kind_name_top_level_active",
        "categories",
        ["user_id", "kind", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL AND archived_at IS NULL"),
    )
    op.create_index(
        "uq_categories_parent_id_name_active",
        "categories",
        ["parent_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL AND archived_at IS NULL"),
    )
    op.create_index(
        "uq_categories_user_id_kind_fallback",
        "categories",
        ["user_id", "kind"],
        unique=True,
        postgresql_where=sa.text("is_fallback"),
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("transfer_direction", sa.String(3)),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("description_normalized", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("category_id", sa.Uuid()),
        sa.Column("transfer_group_id", sa.Uuid()),
        sa.Column("installment_group_id", sa.Uuid()),
        sa.Column("installment_number", sa.Integer()),
        sa.Column("installment_count", sa.Integer()),
        # A chave estrangeira para `imports` entra com a tabela, na migração das importações.
        sa.Column("import_id", sa.Uuid()),
        sa.Column("external_id", sa.String(255)),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("source", sa.String(10), server_default="manual", nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_transactions_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_transactions_account_id_accounts",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], name="fk_transactions_category_id_categories"
        ),
        sa.CheckConstraint(
            "type IN ('expense', 'income', 'transfer')", name=op.f("ck_transactions_type_valid")
        ),
        sa.CheckConstraint(
            "source IN ('manual', 'import', 'assistant')",
            name=op.f("ck_transactions_source_valid"),
        ),
        sa.CheckConstraint("amount_cents > 0", name=op.f("ck_transactions_amount_positive")),
        sa.CheckConstraint(
            "char_length(description) BETWEEN 1 AND 200",
            name=op.f("ck_transactions_description_length"),
        ),
        sa.CheckConstraint(
            "(type = 'transfer' AND transfer_direction IN ('out', 'in') "
            "AND transfer_group_id IS NOT NULL AND category_id IS NULL) "
            "OR (type <> 'transfer' AND transfer_direction IS NULL "
            "AND transfer_group_id IS NULL AND category_id IS NOT NULL)",
            name=op.f("ck_transactions_transfer_fields_match_type"),
        ),
        sa.CheckConstraint(
            "(installment_group_id IS NULL AND installment_number IS NULL "
            "AND installment_count IS NULL) "
            "OR (installment_group_id IS NOT NULL AND installment_count BETWEEN 2 AND 48 "
            "AND installment_number BETWEEN 1 AND installment_count)",
            name=op.f("ck_transactions_installment_fields_consistent"),
        ),
    )
    op.create_index("ix_transactions_user_id_date", "transactions", ["user_id", "date"])
    op.create_index(
        "ix_transactions_user_id_account_id_date", "transactions", ["user_id", "account_id", "date"]
    )
    op.create_index(
        "ix_transactions_user_id_category_id_date",
        "transactions",
        ["user_id", "category_id", "date"],
    )
    op.create_index(
        "ix_transactions_user_id_account_id_fingerprint",
        "transactions",
        ["user_id", "account_id", "fingerprint"],
    )
    op.create_index("ix_transactions_import_id", "transactions", ["import_id"])
    op.create_index(
        "uq_transactions_account_id_external_id",
        "transactions",
        ["account_id", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("transactions")
    op.drop_table("categories")
    op.drop_table("accounts")

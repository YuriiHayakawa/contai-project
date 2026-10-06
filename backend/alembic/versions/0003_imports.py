"""Importações, transações propostas, modelos de colunas e regras de categorização.

Revision ID: 0003_imports
Revises: 0002_finance
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_imports"
down_revision: str | None = "0002_finance"
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
        "import_templates",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("header_signature", sa.String(64), nullable=False),
        sa.Column("mapping", postgresql.JSONB(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_import_templates"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_import_templates_user_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "uq_import_templates_user_id_header_signature",
        "import_templates",
        ["user_id", "header_signature"],
        unique=True,
    )

    op.create_table(
        "imports",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("format", sa.String(10), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False),
        sa.Column("stored_filename", sa.String(64)),
        sa.Column("status", sa.String(20), server_default="queued", nullable=False),
        sa.Column("error_code", sa.String(50)),
        sa.Column("template_id", sa.Uuid()),
        sa.Column("mapping_preview", postgresql.JSONB()),
        sa.Column("document_total_cents", sa.BigInteger()),
        sa.Column("extracted_total_cents", sa.BigInteger()),
        sa.Column("bank_balance_cents", sa.BigInteger()),
        sa.Column("bank_balance_date", sa.Date()),
        sa.Column("item_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("imported_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("waiting_since", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("undone_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_imports"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_imports_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_imports_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["import_templates.id"],
            name="fk_imports_template_id_import_templates",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint("kind IN ('statement', 'receipt')", name=op.f("ck_imports_kind_valid")),
        sa.CheckConstraint(
            "format IN ('ofx', 'csv', 'xlsx', 'pdf', 'image')",
            name=op.f("ck_imports_format_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'processing', 'awaiting_mapping', 'awaiting_review', "
            "'completed', 'undone', 'failed')",
            name=op.f("ck_imports_status_valid"),
        ),
    )
    op.create_index("ix_imports_user_id_created_at", "imports", ["user_id", "created_at"])
    op.create_index("ix_imports_user_id_file_hash", "imports", ["user_id", "file_hash"])
    op.create_index("ix_imports_account_id", "imports", ["account_id"])

    op.create_table(
        "import_items",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("transfer_direction", sa.String(3)),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("description_normalized", sa.String(200), nullable=False),
        sa.Column("suggested_category_id", sa.Uuid()),
        sa.Column("category_source", sa.String(10)),
        sa.Column("suggested_counter_account_id", sa.Uuid()),
        sa.Column("external_id", sa.String(255)),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("duplicate_status", sa.String(10), server_default="none", nullable=False),
        sa.Column("duplicate_of_id", sa.Uuid()),
        sa.Column(
            "selected_by_default", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_items"),
        sa.ForeignKeyConstraint(
            ["import_id"],
            ["imports.id"],
            name="fk_import_items_import_id_imports",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_import_items_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["suggested_category_id"],
            ["categories.id"],
            name="fk_import_items_suggested_category_id_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["suggested_counter_account_id"],
            ["accounts.id"],
            name="fk_import_items_suggested_counter_account_id_accounts",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_id"],
            ["transactions.id"],
            name="fk_import_items_duplicate_of_id_transactions",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "type IN ('expense', 'income', 'transfer')", name=op.f("ck_import_items_type_valid")
        ),
        sa.CheckConstraint(
            "transfer_direction IS NULL OR transfer_direction IN ('out', 'in')",
            name=op.f("ck_import_items_transfer_direction_valid"),
        ),
        sa.CheckConstraint("amount_cents > 0", name=op.f("ck_import_items_amount_positive")),
        sa.CheckConstraint(
            "duplicate_status IN ('none', 'exact', 'probable')",
            name=op.f("ck_import_items_duplicate_status_valid"),
        ),
        sa.CheckConstraint(
            "category_source IS NULL OR category_source IN ('user_rule', 'ai', 'fallback')",
            name=op.f("ck_import_items_category_source_valid"),
        ),
    )
    op.create_index(
        "ix_import_items_import_id_row_index", "import_items", ["import_id", "row_index"]
    )
    op.create_index("ix_import_items_user_id", "import_items", ["user_id"])

    op.create_table(
        "categorization_rules",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("description_normalized", sa.String(200), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_categorization_rules"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_categorization_rules_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_categorization_rules_category_id_categories",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "source IN ('user', 'ai')", name=op.f("ck_categorization_rules_source_valid")
        ),
    )
    op.create_index(
        "uq_categorization_rules_user_id_description_normalized",
        "categorization_rules",
        ["user_id", "description_normalized"],
        unique=True,
    )
    op.create_index("ix_categorization_rules_category_id", "categorization_rules", ["category_id"])

    # A coluna existe desde a migração das transações; a chave entra agora, com a tabela.
    op.create_foreign_key(
        "fk_transactions_import_id_imports",
        "transactions",
        "imports",
        ["import_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_transactions_import_id_imports", "transactions", type_="foreignkey")
    op.drop_table("categorization_rules")
    op.drop_table("import_items")
    op.drop_table("imports")
    op.drop_table("import_templates")

"""O que o usuário decidiu em cada linha da revisão de uma importação.

As correções passam a ser gravadas a cada alteração, para a revisão poder ser retomada: a
marcação, a categoria e a outra conta escolhidas ganham colunas próprias, que começam iguais à
sugestão.

Revision ID: 0004_import_item_decisions
Revises: 0003_imports
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_import_item_decisions"
down_revision: str | None = "0003_imports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "import_items",
        sa.Column("selected", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column("import_items", sa.Column("category_id", sa.Uuid()))
    op.add_column("import_items", sa.Column("counter_account_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_import_items_category_id_categories",
        "import_items",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_import_items_counter_account_id_accounts",
        "import_items",
        "accounts",
        ["counter_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # As revisões já abertas continuam como estavam: do jeito que foram sugeridas.
    op.execute(
        "UPDATE import_items SET selected = selected_by_default, "
        "category_id = suggested_category_id, "
        "counter_account_id = suggested_counter_account_id"
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_import_items_counter_account_id_accounts", "import_items", type_="foreignkey"
    )
    op.drop_constraint("fk_import_items_category_id_categories", "import_items", type_="foreignkey")
    op.drop_column("import_items", "counter_account_id")
    op.drop_column("import_items", "category_id")
    op.drop_column("import_items", "selected")

"""Observação nas linhas da revisão de uma importação.

A linha em revisão passa a aceitar a mesma observação opcional de um lançamento feito à mão;
na confirmação, ela vai para a transação.

Revision ID: 0006_import_item_notes
Revises: 0005_assistant
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_import_item_notes"
down_revision: str | None = "0005_assistant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("import_items", sa.Column("notes", sa.Text()))


def downgrade() -> None:
    op.drop_column("import_items", "notes")

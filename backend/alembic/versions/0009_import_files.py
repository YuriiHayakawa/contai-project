"""Arquivos enviados no banco (ADR 0011).

Cria `import_files`, que guarda o conteúdo do arquivo enviado só até o processamento, e tira
`imports.stored_filename`, o nome do arquivo no volume privado que deixou de existir. O serviço
da API em produção não tem disco permanente. Uma importação do ambiente local que estava na
fila com o arquivo no volume falha com `file_missing` ao ser processada.

Revision ID: 0009_import_files
Revises: 0008_two_factor
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_import_files"
down_revision: str | None = "0008_two_factor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_files",
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("import_id", name=op.f("pk_import_files")),
        sa.ForeignKeyConstraint(
            ["import_id"],
            ["imports.id"],
            name=op.f("fk_import_files_import_id_imports"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_import_files_user_id_users"),
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_import_files_user_id", "import_files", ["user_id"])
    op.drop_column("imports", "stored_filename")


def downgrade() -> None:
    op.add_column("imports", sa.Column("stored_filename", sa.String(64)))
    op.drop_index("ix_import_files_user_id", table_name="import_files")
    op.drop_table("import_files")

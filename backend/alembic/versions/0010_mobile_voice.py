"""App mobile e lançamento por voz pela Siri (feature 002, ADR 0012).

- `sessions.client`: separa as sessões do site (`web`) das do app (`mobile`). As que já existem
  ficam `web`.
- `personal_tokens`: os tokens pessoais da Siri. O banco guarda só o SHA-256 do segredo.
- `transactions`: a origem ganha `voice`, e a frase entendida fica em `voice_phrase`, que só
  existe nos lançamentos por voz.
- `ai_usage`: a tarefa `voice_entry`, contada no limite diário de perguntas.

O caminho de volta não apaga lançamentos: os que eram por voz passam a ser do assistente, e o uso
de IA da voz passa a contar como lançamento por texto. A frase entendida se perde.

Revision ID: 0010_mobile_voice
Revises: 0009_import_files
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_mobile_voice"
down_revision: str | None = "0009_import_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOURCE_BEFORE = "source IN ('manual', 'import', 'assistant')"
_SOURCE_AFTER = "source IN ('manual', 'import', 'assistant', 'voice')"

_TASK_BEFORE = (
    "task IN ('chat', 'text_entry', 'categorization', 'statement_extraction', 'receipt_extraction')"
)
_TASK_AFTER = (
    "task IN ('chat', 'text_entry', 'categorization', 'statement_extraction', "
    "'receipt_extraction', 'voice_entry')"
)

_VOICE_PHRASE_CONSTRAINTS = {
    "ck_transactions_voice_phrase_only_for_voice": "voice_phrase IS NULL OR source = 'voice'",
    "ck_transactions_voice_entry_has_phrase": "source <> 'voice' OR voice_phrase IS NOT NULL",
    "ck_transactions_voice_phrase_length": (
        "voice_phrase IS NULL OR char_length(voice_phrase) <= 300"
    ),
}


def _replace_check(table: str, name: str, condition: str) -> None:
    op.drop_constraint(op.f(name), table, type_="check")
    op.create_check_constraint(op.f(name), table, condition)


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("client", sa.String(10), server_default="web", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_sessions_client_valid"), "sessions", "client IN ('web', 'mobile')"
    )

    op.create_table(
        "personal_tokens",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("secret_hash", sa.CHAR(64), nullable=False),
        sa.Column("default_account_id", sa.Uuid()),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_reason", sa.String(30)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_personal_tokens")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_personal_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["default_account_id"],
            ["accounts.id"],
            name=op.f("fk_personal_tokens_default_account_id_accounts"),
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "revoked_reason IS NULL OR revoked_reason IN ('user_revoked', 'password_changed', "
            "'password_reset')",
            name=op.f("ck_personal_tokens_revoked_reason_valid"),
        ),
    )
    op.create_index(
        "ix_personal_tokens_user_active",
        "personal_tokens",
        ["user_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    _replace_check("transactions", "ck_transactions_source_valid", _SOURCE_AFTER)
    op.add_column("transactions", sa.Column("voice_phrase", sa.Text()))
    for name, condition in _VOICE_PHRASE_CONSTRAINTS.items():
        op.create_check_constraint(op.f(name), "transactions", condition)

    _replace_check("ai_usage", "ck_ai_usage_task_valid", _TASK_AFTER)


def downgrade() -> None:
    op.execute("UPDATE ai_usage SET task = 'text_entry' WHERE task = 'voice_entry'")
    _replace_check("ai_usage", "ck_ai_usage_task_valid", _TASK_BEFORE)

    for name in _VOICE_PHRASE_CONSTRAINTS:
        op.drop_constraint(op.f(name), "transactions", type_="check")
    op.drop_column("transactions", "voice_phrase")
    op.execute("UPDATE transactions SET source = 'assistant' WHERE source = 'voice'")
    _replace_check("transactions", "ck_transactions_source_valid", _SOURCE_BEFORE)

    op.drop_index("ix_personal_tokens_user_active", table_name="personal_tokens")
    op.drop_table("personal_tokens")

    op.drop_constraint(op.f("ck_sessions_client_valid"), "sessions", type_="check")
    op.drop_column("sessions", "client")

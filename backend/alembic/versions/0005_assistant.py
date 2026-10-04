"""Conversas e mensagens do assistente.

Revision ID: 0005_assistant
Revises: 0004_import_item_decisions
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_assistant"
down_revision: str | None = "0004_import_item_decisions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID_DEFAULT = sa.text("gen_random_uuid()")
_NOW = sa.func.now()
_EMPTY_LIST = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(80), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_conversations"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_conversations_user_id_users", ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_conversations_user_id_updated_at", "conversations", ["user_id", "updated_at"]
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(25), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("highlight", sa.String(40)),
        sa.Column(
            "transaction_ids", postgresql.JSONB(), server_default=_EMPTY_LIST, nullable=False
        ),
        sa.Column(
            "transactions_total_count", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("tool_calls", postgresql.JSONB(), server_default=_EMPTY_LIST, nullable=False),
        sa.Column("proposal", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_chat_messages"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name="fk_chat_messages_conversation_id_conversations",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_chat_messages_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant')", name=op.f("ck_chat_messages_role_valid")
        ),
        sa.CheckConstraint(
            "kind IN ('text', 'answer', 'clarification', 'refusal', 'transaction_proposal', "
            "'error')",
            name=op.f("ck_chat_messages_kind_valid"),
        ),
    )
    op.create_index(
        "uq_chat_messages_conversation_id_position",
        "chat_messages",
        ["conversation_id", "position"],
        unique=True,
    )
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("conversations")

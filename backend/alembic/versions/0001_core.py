"""Tabelas de base: usuários, sessões, tokens de e-mail, fila de jobs e uso de IA.

Revision ID: 0001_core
Revises:
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_core"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID_DEFAULT = sa.text("gen_random_uuid()")
_NOW = sa.func.now()


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("deletion_requested_at", sa.DateTime(timezone=True)),
        sa.Column("deletion_scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("totp_secret_encrypted", sa.String(255)),
        sa.Column("totp_enabled_at", sa.DateTime(timezone=True)),
        sa.Column("totp_last_used_step", sa.Integer()),
        sa.Column("failed_login_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("privacy_policy_version", sa.String(20), nullable=False),
        sa.Column("privacy_policy_accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ai_documents_consent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="ck_users_name_length"),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
        sa.CheckConstraint(
            "status IN ('active', 'pending_deletion')", name="ck_users_status_valid"
        ),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("refresh_token_hash", sa.String(64), nullable=False),
        sa.Column("user_agent", sa.String(255), server_default="", nullable=False),
        sa.Column("ip", sa.String(45), server_default="", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_reason", sa.String(30)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_sessions_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "revoked_reason IS NULL OR revoked_reason IN ('logout', 'user_revoked', "
            "'password_changed', 'password_reset', 'token_reuse', 'two_factor_reset', "
            "'account_deletion')",
            name="ck_sessions_revoked_reason_valid",
        ),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "email_tokens",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_email_tokens"),
        sa.UniqueConstraint("token_hash", name="uq_email_tokens_token_hash"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_email_tokens_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "type IN ('email_verification', 'password_reset', 'two_factor_reset_confirm', "
            "'two_factor_reset_cancel')",
            name="ck_email_tokens_type_valid",
        ),
    )
    op.create_index("ix_email_tokens_user_id_type", "email_tokens", ["user_id", "type"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column(
            "payload", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column("status", sa.String(20), server_default="queued", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default=sa.text("5"), nullable=False),
        sa.Column("run_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_code", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_jobs_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint("type IN ('process_import', 'send_email')", name="ck_jobs_type_valid"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_jobs_status_valid"
        ),
    )
    op.create_index(
        "ix_jobs_run_at_queued", "jobs", ["run_at"], postgresql_where=sa.text("status = 'queued'")
    )
    op.create_index("ix_jobs_user_id", "jobs", ["user_id"])

    op.create_table(
        "worker_heartbeats",
        sa.Column("worker_id", sa.String(100), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("worker_id", name="pk_worker_heartbeats"),
    )

    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("input_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "counts_toward_limit", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ai_usage"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_ai_usage_user_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "task IN ('chat', 'text_entry', 'categorization', 'statement_extraction', "
            "'receipt_extraction')",
            name="ck_ai_usage_task_valid",
        ),
    )
    op.create_index("ix_ai_usage_user_id_usage_date", "ai_usage", ["user_id", "usage_date"])


def downgrade() -> None:
    op.drop_table("ai_usage")
    op.drop_table("worker_heartbeats")
    op.drop_table("jobs")
    op.drop_table("email_tokens")
    op.drop_table("sessions")
    op.drop_table("users")

"""Modelos do assistente: conversas e mensagens.

A mensagem do assistente guarda o texto exibido e o que o sustenta: os ids das transações que
compõem a resposta, vindos das ferramentas e nunca do texto do modelo (FR-063), e as chamadas
de ferramenta, sem os resultados, para dar contexto às perguntas de continuação (FR-064).
"""

import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAt, Timestamps, UUIDPrimaryKey


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class MessageKind(StrEnum):
    # A pergunta do usuário.
    TEXT = "text"
    ANSWER = "answer"
    CLARIFICATION = "clarification"
    REFUSAL = "refusal"
    TRANSACTION_PROPOSAL = "transaction_proposal"
    ERROR = "error"


def _in_list(column: str, values: type[StrEnum]) -> str:
    return f"{column} IN ({', '.join(repr(item.value) for item in values)})"


class Conversation(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user_id_updated_at", "user_id", "updated_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Começo da primeira pergunta, truncado; vazio enquanto a conversa não tem pergunta.
    title: Mapped[str] = mapped_column(String(80), server_default="")


class ChatMessage(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(_in_list("role", MessageRole), name="role_valid"),
        CheckConstraint(_in_list("kind", MessageKind), name="kind_valid"),
        Index(
            "uq_chat_messages_conversation_id_position",
            "conversation_id",
            "position",
            unique=True,
        ),
        Index("ix_chat_messages_user_id", "user_id"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Ordem na conversa, a partir de zero: a pergunta e a resposta nascem na mesma transação de
    # banco, e o instante de criação delas é o mesmo.
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[MessageRole] = mapped_column(String(10))
    kind: Mapped[MessageKind] = mapped_column(String(25))
    # Texto exibido.
    content: Mapped[str] = mapped_column(Text)
    # Valor principal da resposta, já formatado, vindo dos resultados das ferramentas.
    highlight: Mapped[str | None] = mapped_column(String(40))
    # Ids das transações que compõem a resposta (até 50) e quantas são ao todo.
    transaction_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    transactions_total_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    # Nome e parâmetros das ferramentas chamadas; sem os resultados.
    tool_calls: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    # Transação proposta no lançamento por texto (FR-066).
    proposal: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

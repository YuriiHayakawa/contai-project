"""Entradas e saídas das rotas do Assistente (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Annotated, Any

from pydantic import BaseModel, StringConstraints

from app.modules.assistant.models import MessageKind, MessageRole
from app.modules.transactions.models import TransactionType

MAX_QUESTION_LENGTH = 1_000


class SuggestionList(BaseModel):
    # Perguntas de exemplo para o chat vazio (FR-070). Texto fixo, sem IA.
    items: list[str]


class UsageRead(BaseModel):
    """Perguntas feitas hoje e o limite do dia, que zera à meia-noite de Brasília (FR-071)."""

    used: int
    limit: int
    remaining: int
    resets_at: dt.datetime


class ConversationRead(BaseModel):
    id: uuid.UUID
    # Começo da primeira pergunta; vazio enquanto a conversa não tem pergunta.
    title: str
    created_at: dt.datetime
    updated_at: dt.datetime


class ConversationPage(BaseModel):
    """Uma página do histórico, da conversa com atividade mais recente para a mais antiga."""

    items: list[ConversationRead]
    # Passe em `cursor` para buscar a página seguinte; `null` na última.
    next_cursor: str | None


class SourceTransaction(BaseModel):
    """Uma das transações que compõem o valor da resposta (FR-063)."""

    id: uuid.UUID
    type: TransactionType
    date: dt.date
    description: str
    amount_cents: int


class MessageRead(BaseModel):
    id: uuid.UUID
    role: MessageRole
    kind: MessageKind
    content: str
    # Valor principal da resposta, como está escrito nela; o frontend aplica o marca-texto à
    # primeira ocorrência. Nulo quando a resposta não tem um valor principal.
    highlight: str | None
    # Vêm das ferramentas, nunca do texto do modelo: até 50, das que ainda existem.
    transactions: list[SourceTransaction]
    transactions_total_count: int
    proposal: dict[str, Any] | None
    created_at: dt.datetime


class ConversationDetail(ConversationRead):
    # Da mensagem mais antiga para a mais nova.
    messages: list[MessageRead]


class MessageCreate(BaseModel):
    content: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_LENGTH)
    ]

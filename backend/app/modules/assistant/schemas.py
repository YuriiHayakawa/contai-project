"""Entradas e saídas das rotas do Assistente (contracts/rest-api.md)."""

import datetime as dt
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

from app.modules.assistant.models import MessageKind, MessageRole, ProposalStatus
from app.modules.transactions.models import TransactionType
from app.modules.transactions.schemas import EntryType

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
    # A conta do lançamento; em uma transferência, a conta de onde o dinheiro saiu.
    account_id: uuid.UUID
    # Só em transferência: a conta em que o dinheiro entrou.
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None


class ProposalRead(BaseModel):
    """A transação proposta no lançamento por texto (FR-066). Nada dela está salvo enquanto
    `status` é `pending`: o usuário confere no formulário e salva (FR-067)."""

    type: EntryType
    amount_cents: int
    date: dt.date
    description: str
    # Nulos quando a frase não deixou claro: o usuário escolhe ao ajustar.
    account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    # De onde veio a categoria: de uma regra que o usuário ensinou ou de uma sugestão da IA.
    category_source: Literal["user_rule", "ai"] | None
    status: ProposalStatus
    # O lançamento criado a partir da proposta; depois de salva, os campos acima são os dele.
    transaction_id: uuid.UUID | None


class ProposalSaved(BaseModel):
    # O lançamento que o usuário salvou a partir da proposta.
    transaction_id: uuid.UUID


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
    proposal: ProposalRead | None
    created_at: dt.datetime


class ConversationDetail(ConversationRead):
    # Da mensagem mais antiga para a mais nova.
    messages: list[MessageRead]


class MessageCreate(BaseModel):
    content: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_LENGTH)
    ]

"""Acesso ao banco para conversas e mensagens do assistente. Todo método exige `user_id`."""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assistant.models import ChatMessage, Conversation, MessageKind, MessageRole


class AssistantRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ---------- conversas

    async def create_conversation(self, user_id: uuid.UUID, *, now: dt.datetime) -> Conversation:
        conversation = Conversation(user_id=user_id, title="", created_at=now, updated_at=now)
        self._session.add(conversation)
        await self._session.flush()
        await self._session.refresh(conversation)
        return conversation

    async def get_conversation(
        self, user_id: uuid.UUID, conversation_id: uuid.UUID, *, for_update: bool = False
    ) -> Conversation | None:
        """`for_update` trava a conversa: duas perguntas ao mesmo tempo entram uma por vez."""
        statement = select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
        if for_update:
            statement = statement.with_for_update()
        return (await self._session.execute(statement)).scalar_one_or_none()

    async def list_conversations(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        after: tuple[dt.datetime, uuid.UUID] | None = None,
    ) -> list[Conversation]:
        """As conversas, da que teve atividade mais recente para a mais antiga."""
        order = (Conversation.updated_at, Conversation.id)
        statement = select(Conversation).where(Conversation.user_id == user_id)
        if after is not None:
            statement = statement.where(tuple_(*order) < tuple_(*after))
        statement = statement.order_by(*(column.desc() for column in order)).limit(limit)
        return list((await self._session.execute(statement)).scalars())

    async def list_all_conversations(self, user_id: uuid.UUID) -> list[Conversation]:
        """Todas as conversas do usuário, da mais antiga para a mais nova (exportação)."""
        statement = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.created_at, Conversation.id)
        )
        return list((await self._session.execute(statement)).scalars())

    async def save_conversation(self, user_id: uuid.UUID, conversation: Conversation) -> None:
        if conversation.user_id != user_id:
            raise ValueError("a conversa não é deste usuário")
        await self._session.flush()

    async def delete_conversation(self, user_id: uuid.UUID, conversation_id: uuid.UUID) -> None:
        """Apaga a conversa; as mensagens dela vão junto."""
        await self._session.execute(
            delete(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
        )

    async def delete_all_conversations(self, user_id: uuid.UUID) -> None:
        await self._session.execute(delete(Conversation).where(Conversation.user_id == user_id))

    # ---------- mensagens

    async def list_messages(
        self, user_id: uuid.UUID, conversation_id: uuid.UUID, *, last: int | None = None
    ) -> list[ChatMessage]:
        """As mensagens da conversa, da mais antiga para a mais nova; com `last`, só as últimas."""
        statement = select(ChatMessage).where(
            ChatMessage.conversation_id == conversation_id, ChatMessage.user_id == user_id
        )
        if last is None:
            return list(
                (await self._session.execute(statement.order_by(ChatMessage.position))).scalars()
            )
        newest = statement.order_by(ChatMessage.position.desc()).limit(last)
        return list(reversed((await self._session.execute(newest)).scalars().all()))

    async def get_message(
        self, user_id: uuid.UUID, message_id: uuid.UUID, *, for_update: bool = False
    ) -> ChatMessage | None:
        statement = select(ChatMessage).where(
            ChatMessage.id == message_id, ChatMessage.user_id == user_id
        )
        if for_update:
            statement = statement.with_for_update()
        return (await self._session.execute(statement)).scalar_one_or_none()

    async def save_message(self, user_id: uuid.UUID, message: ChatMessage) -> None:
        if message.user_id != user_id:
            raise ValueError("a mensagem não é deste usuário")
        await self._session.flush()

    async def next_position(self, user_id: uuid.UUID, conversation_id: uuid.UUID) -> int:
        result = await self._session.execute(
            select(func.coalesce(func.max(ChatMessage.position) + 1, 0)).where(
                ChatMessage.conversation_id == conversation_id, ChatMessage.user_id == user_id
            )
        )
        return int(result.scalar_one())

    async def add_message(
        self,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID,
        *,
        position: int,
        role: MessageRole,
        kind: MessageKind,
        content: str,
        now: dt.datetime,
        highlight: str | None = None,
        transaction_ids: list[str] | None = None,
        transactions_total_count: int = 0,
        tool_calls: list[dict[str, Any]] | None = None,
        proposal: dict[str, Any] | None = None,
    ) -> ChatMessage:
        message = ChatMessage(
            conversation_id=conversation_id,
            user_id=user_id,
            position=position,
            role=role,
            kind=kind,
            content=content,
            highlight=highlight,
            transaction_ids=transaction_ids or [],
            transactions_total_count=transactions_total_count,
            tool_calls=tool_calls or [],
            proposal=proposal,
            created_at=now,
        )
        self._session.add(message)
        await self._session.flush()
        await self._session.refresh(message)
        return message

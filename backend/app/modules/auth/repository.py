"""Acesso ao banco para sessões e tokens de e-mail.

Só as buscas por credencial (`get_session_by_id` no refresh e `get_email_token_by_hash` no link)
dispensam `user_id`, porque é a credencial que identifica o usuário. Todos os outros métodos o
exigem.
"""

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import EmailToken, EmailTokenType, Session, SessionRevokedReason


class AuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ---------- sessões

    async def create_session(
        self,
        *,
        user_id: uuid.UUID,
        refresh_token_hash: str,
        user_agent: str,
        ip: str,
        now: datetime,
        expires_at: datetime,
    ) -> Session:
        session = Session(
            user_id=user_id,
            refresh_token_hash=refresh_token_hash,
            user_agent=user_agent[:255],
            ip=ip[:45],
            last_used_at=now,
            expires_at=expires_at,
        )
        self._session.add(session)
        await self._session.flush()
        await self._session.refresh(session)
        return session

    async def get_session_by_id(self, session_id: uuid.UUID) -> Session | None:
        """Busca por credencial, usada no refresh: o token traz o id da sessão."""
        return await self._session.get(Session, session_id)

    async def get_session(self, user_id: uuid.UUID, session_id: uuid.UUID) -> Session | None:
        result = await self._session.execute(
            select(Session).where(Session.id == session_id, Session.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_active_sessions(self, user_id: uuid.UUID, now: datetime) -> list[Session]:
        result = await self._session.execute(
            select(Session)
            .where(
                Session.user_id == user_id,
                Session.revoked_at.is_(None),
                Session.expires_at > now,
            )
            .order_by(Session.last_used_at.desc())
        )
        return list(result.scalars())

    async def rotate_session(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        *,
        refresh_token_hash: str,
        ip: str,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        await self._session.execute(
            update(Session)
            .where(Session.id == session_id, Session.user_id == user_id)
            .values(
                refresh_token_hash=refresh_token_hash,
                ip=ip[:45],
                last_used_at=now,
                expires_at=expires_at,
            )
        )

    async def revoke_session(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        *,
        reason: SessionRevokedReason,
        now: datetime,
    ) -> bool:
        result = await self._session.execute(
            update(Session)
            .where(
                Session.id == session_id,
                Session.user_id == user_id,
                Session.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoked_reason=reason)
            .returning(Session.id)
        )
        return result.scalar_one_or_none() is not None

    async def revoke_all_sessions(
        self,
        user_id: uuid.UUID,
        *,
        reason: SessionRevokedReason,
        now: datetime,
        except_session_id: uuid.UUID | None = None,
    ) -> int:
        statement = (
            update(Session)
            .where(Session.user_id == user_id, Session.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason=reason)
            .returning(Session.id)
        )
        if except_session_id is not None:
            statement = statement.where(Session.id != except_session_id)
        result = await self._session.execute(statement)
        return len(result.scalars().all())

    # ---------- tokens de e-mail

    async def create_email_token(
        self,
        *,
        user_id: uuid.UUID,
        token_type: EmailTokenType,
        token_hash: str,
        expires_at: datetime,
    ) -> EmailToken:
        token = EmailToken(
            user_id=user_id, type=token_type, token_hash=token_hash, expires_at=expires_at
        )
        self._session.add(token)
        await self._session.flush()
        return token

    async def get_email_token_by_hash(self, token_hash: str) -> EmailToken | None:
        """Busca por credencial, usada quando o usuário abre o link recebido."""
        result = await self._session.execute(
            select(EmailToken).where(EmailToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def mark_email_token_used(
        self, user_id: uuid.UUID, token_id: uuid.UUID, now: datetime
    ) -> bool:
        """Marca o token como usado; devolve `False` se ele já tinha sido usado."""
        result = await self._session.execute(
            update(EmailToken)
            .where(
                EmailToken.id == token_id,
                EmailToken.user_id == user_id,
                EmailToken.used_at.is_(None),
            )
            .values(used_at=now)
            .returning(EmailToken.id)
        )
        return result.scalar_one_or_none() is not None

    async def invalidate_email_tokens(
        self, user_id: uuid.UUID, token_type: EmailTokenType, now: datetime
    ) -> None:
        """Invalida os tokens em aberto de um tipo, ao emitir um novo."""
        await self._session.execute(
            update(EmailToken)
            .where(
                EmailToken.user_id == user_id,
                EmailToken.type == token_type,
                EmailToken.used_at.is_(None),
            )
            .values(used_at=now)
        )

"""Acesso ao banco para sessões e tokens de e-mail.

Só as buscas por credencial (`get_session_by_id` no refresh e `get_email_token_by_hash` no link)
dispensam `user_id`, porque é a credencial que identifica o usuário. Todos os outros métodos o
exigem, com uma exceção: as tentativas de login, que são contadas pelo e-mail informado e
existem também para e-mails sem conta.
"""

import uuid
from datetime import datetime

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import (
    EmailToken,
    EmailTokenType,
    LoginAttempt,
    RecoveryCode,
    Session,
    SessionRevokedReason,
    TwoFactorResetRequest,
)


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

    async def get_session_by_id(
        self, session_id: uuid.UUID, *, for_update: bool = False
    ) -> Session | None:
        """Busca por credencial, usada no refresh: o token traz o id da sessão.

        Com `for_update`, a linha fica travada até o fim da transação: dois refreshes
        simultâneos da mesma sessão são atendidos um depois do outro.
        """
        return await self._session.get(Session, session_id, with_for_update=for_update)

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

    # ---------- códigos de recuperação da verificação em duas etapas

    async def replace_recovery_codes(self, user_id: uuid.UUID, code_hashes: list[str]) -> None:
        """Apaga os códigos do usuário e grava os novos: são sempre 10, gerados juntos."""
        await self.delete_recovery_codes(user_id)
        self._session.add_all(
            RecoveryCode(user_id=user_id, code_hash=code_hash) for code_hash in code_hashes
        )
        await self._session.flush()

    async def delete_recovery_codes(self, user_id: uuid.UUID) -> None:
        await self._session.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))

    async def use_recovery_code(self, user_id: uuid.UUID, code_hash: str, now: datetime) -> bool:
        """Marca como usado um código de recuperação ainda não usado; devolve se havia um."""
        result = await self._session.execute(
            update(RecoveryCode)
            .where(
                RecoveryCode.user_id == user_id,
                RecoveryCode.code_hash == code_hash,
                RecoveryCode.used_at.is_(None),
            )
            .values(used_at=now)
            .returning(RecoveryCode.id)
        )
        return result.scalar_one_or_none() is not None

    # ---------- pedido de desativação da verificação em duas etapas

    async def create_reset_request(
        self, *, user_id: uuid.UUID, requested_at: datetime, effective_at: datetime
    ) -> TwoFactorResetRequest:
        request = TwoFactorResetRequest(
            user_id=user_id, requested_at=requested_at, effective_at=effective_at
        )
        self._session.add(request)
        await self._session.flush()
        await self._session.refresh(request)
        return request

    async def get_open_reset_request(self, user_id: uuid.UUID) -> TwoFactorResetRequest | None:
        result = await self._session.execute(
            select(TwoFactorResetRequest).where(
                TwoFactorResetRequest.user_id == user_id,
                TwoFactorResetRequest.cancelled_at.is_(None),
                TwoFactorResetRequest.applied_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def cancel_open_reset_requests(self, user_id: uuid.UUID, now: datetime) -> int:
        """Cancela o pedido em aberto do usuário (pelo link ou por login com código válido)."""
        result = await self._session.execute(
            update(TwoFactorResetRequest)
            .where(
                TwoFactorResetRequest.user_id == user_id,
                TwoFactorResetRequest.cancelled_at.is_(None),
                TwoFactorResetRequest.applied_at.is_(None),
            )
            .values(cancelled_at=now)
            .returning(TwoFactorResetRequest.id)
        )
        return len(result.scalars().all())

    async def mark_reset_reminder_sent(self, request_id: uuid.UUID, now: datetime) -> None:
        await self._session.execute(
            update(TwoFactorResetRequest)
            .where(TwoFactorResetRequest.id == request_id)
            .values(reminder_sent_at=now)
        )

    async def mark_reset_applied(self, request_id: uuid.UUID, now: datetime) -> None:
        await self._session.execute(
            update(TwoFactorResetRequest)
            .where(TwoFactorResetRequest.id == request_id)
            .values(applied_at=now)
        )

    async def list_reset_requests_due(self, now: datetime) -> list[TwoFactorResetRequest]:
        """Pedidos em aberto cujo prazo de 72 horas já passou (varredura do worker)."""
        result = await self._session.execute(
            select(TwoFactorResetRequest).where(
                TwoFactorResetRequest.cancelled_at.is_(None),
                TwoFactorResetRequest.applied_at.is_(None),
                TwoFactorResetRequest.effective_at <= now,
            )
        )
        return list(result.scalars())

    async def list_reset_requests_needing_reminder(
        self, *, now: datetime, remind_at_or_before: datetime
    ) -> list[TwoFactorResetRequest]:
        """Pedidos em aberto ainda sem lembrete e a menos de 24 horas do prazo."""
        result = await self._session.execute(
            select(TwoFactorResetRequest).where(
                TwoFactorResetRequest.cancelled_at.is_(None),
                TwoFactorResetRequest.applied_at.is_(None),
                TwoFactorResetRequest.reminder_sent_at.is_(None),
                TwoFactorResetRequest.effective_at > now,
                TwoFactorResetRequest.effective_at <= remind_at_or_before,
            )
        )
        return list(result.scalars())

    # ---------- tentativas de login (por e-mail informado, sem `user_id`)

    async def get_login_attempt(self, email_hash: str) -> LoginAttempt | None:
        return await self._session.get(LoginAttempt, email_hash, populate_existing=True)

    async def count_failed_login(self, email_hash: str, now: datetime) -> int:
        """Soma um erro à contagem do e-mail e devolve o total; cria a linha se não existir."""
        statement = (
            insert(LoginAttempt)
            .values(email_hash=email_hash, failed_count=1, last_failed_at=now)
            .on_conflict_do_update(
                index_elements=[LoginAttempt.email_hash],
                set_={"failed_count": LoginAttempt.failed_count + 1, "last_failed_at": now},
            )
            .returning(LoginAttempt.failed_count)
        )
        return (await self._session.execute(statement)).scalar_one()

    async def lock_login(self, email_hash: str, *, until: datetime) -> None:
        """Bloqueia o e-mail até `until`; a contagem recomeça do zero depois do bloqueio."""
        await self._session.execute(
            update(LoginAttempt)
            .where(LoginAttempt.email_hash == email_hash)
            .values(locked_until=until, failed_count=0)
        )

    async def clear_login_attempts(self, email_hash: str) -> None:
        await self._session.execute(
            delete(LoginAttempt).where(LoginAttempt.email_hash == email_hash)
        )

    async def purge_login_attempts(self, *, last_failed_before: datetime, now: datetime) -> int:
        """Apaga as contagens sem erro recente, menos as que ainda estão bloqueadas."""
        result = await self._session.execute(
            delete(LoginAttempt)
            .where(
                LoginAttempt.last_failed_at < last_failed_before,
                or_(LoginAttempt.locked_until.is_(None), LoginAttempt.locked_until <= now),
            )
            .returning(LoginAttempt.email_hash)
        )
        return len(result.scalars().all())

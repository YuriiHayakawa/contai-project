"""Tokens pessoais da Siri (feature 002, ADR 0012).

O token tem a forma `ctp_<id>.<segredo>` e só serve para lançar por voz. O banco guarda o SHA-256
do segredo, e o token completo aparece uma única vez, na criação. Cada usuário tem no máximo 5
tokens ativos. A revogação não volta atrás, e a troca ou a redefinição da senha revoga todos.
"""

import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.security import hash_token
from app.modules.accounts.models import Account
from app.modules.accounts.repository import AccountRepository
from app.modules.auth.models import PersonalToken, PersonalTokenRevokedReason
from app.modules.users.models import User, UserStatus

TOKEN_PREFIX = "ctp_"  # noqa: S105 - prefixo do formato, não é segredo
MAX_ACTIVE_TOKENS = 5
# `last_used_at` muda no máximo uma vez por minuto: cada frase não precisa de uma escrita a mais.
LAST_USED_RESOLUTION = timedelta(minutes=1)
# Um token revogado fica guardado por um tempo, para auditar o motivo, como as sessões.
REVOKED_TOKEN_RETENTION = timedelta(days=30)

DEFAULT_ACCOUNT_INVALID = "Escolha uma das suas contas ativas."


class PersonalTokenLimitReached(Conflict):
    code = "personal_token_limit"
    message = (
        f"Você já tem {MAX_ACTIVE_TOKENS} atalhos conectados à Siri. Desconecte um deles para "
        "criar outro."
    )


class PersonalTokenNotFound(NotFound):
    code = "personal_token_not_found"
    message = "Este token não existe mais. Atualize a lista e tente de novo."


def _invalid_default_account() -> ValidationFailed:
    return ValidationFailed(
        DEFAULT_ACCOUNT_INVALID,
        details={"fields": {"default_account_id": DEFAULT_ACCOUNT_INVALID}},
    )


@dataclass(frozen=True)
class AuthenticatedToken:
    """O token que chegou ao endpoint de voz, já conferido."""

    token_id: uuid.UUID
    user_id: uuid.UUID
    default_account_id: uuid.UUID | None


def split_token(raw: str) -> tuple[uuid.UUID, str] | None:
    """`ctp_<id>.<segredo>` em id e segredo; `None` se o formato não confere."""
    if not raw.startswith(TOKEN_PREFIX):
        return None
    token_id, separator, secret = raw[len(TOKEN_PREFIX) :].partition(".")
    if not separator or not secret:
        return None
    try:
        return uuid.UUID(token_id), secret
    except ValueError:
        return None


class PersonalTokenRepository:
    """Acesso ao banco dos tokens. Toda operação leva o `user_id`, menos a autenticação."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(
        self,
        user_id: uuid.UUID,
        *,
        token_id: uuid.UUID,
        name: str,
        secret_hash: str,
        default_account_id: uuid.UUID,
        now: datetime,
    ) -> PersonalToken:
        token = PersonalToken(
            id=token_id,
            user_id=user_id,
            name=name,
            secret_hash=secret_hash,
            default_account_id=default_account_id,
            created_at=now,
        )
        self._session.add(token)
        await self._session.flush()
        await self._session.refresh(token)
        return token

    async def count_active(self, user_id: uuid.UUID) -> int:
        result = await self._session.execute(
            select(func.count())
            .select_from(PersonalToken)
            .where(PersonalToken.user_id == user_id, PersonalToken.revoked_at.is_(None))
        )
        return int(result.scalar_one())

    async def list_active(self, user_id: uuid.UUID) -> list[PersonalToken]:
        result = await self._session.execute(
            select(PersonalToken)
            .where(PersonalToken.user_id == user_id, PersonalToken.revoked_at.is_(None))
            .order_by(PersonalToken.created_at.desc(), PersonalToken.id)
        )
        return list(result.scalars())

    async def list_all(self, user_id: uuid.UUID) -> list[PersonalToken]:
        """Ativos e revogados, do mais antigo para o mais novo: é a exportação dos dados."""
        result = await self._session.execute(
            select(PersonalToken)
            .where(PersonalToken.user_id == user_id)
            .order_by(PersonalToken.created_at, PersonalToken.id)
        )
        return list(result.scalars())

    async def get_active(self, user_id: uuid.UUID, token_id: uuid.UUID) -> PersonalToken | None:
        result = await self._session.execute(
            select(PersonalToken).where(
                PersonalToken.id == token_id,
                PersonalToken.user_id == user_id,
                PersonalToken.revoked_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_for_authentication(self, token_id: uuid.UUID) -> PersonalToken | None:
        """Busca pela credencial, como o refresh busca a sessão: o dono ainda não é conhecido."""
        return await self._session.get(PersonalToken, token_id)

    async def save(self, token: PersonalToken) -> None:
        await self._session.flush()

    async def revoke(
        self,
        user_id: uuid.UUID,
        token_id: uuid.UUID,
        *,
        reason: PersonalTokenRevokedReason,
        now: datetime,
    ) -> bool:
        result = await self._session.execute(
            update(PersonalToken)
            .where(
                PersonalToken.id == token_id,
                PersonalToken.user_id == user_id,
                PersonalToken.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoked_reason=reason)
            .returning(PersonalToken.id)
        )
        return result.scalar_one_or_none() is not None

    async def revoke_all(
        self, user_id: uuid.UUID, *, reason: PersonalTokenRevokedReason, now: datetime
    ) -> int:
        result = await self._session.execute(
            update(PersonalToken)
            .where(PersonalToken.user_id == user_id, PersonalToken.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason=reason)
            .returning(PersonalToken.id)
        )
        return len(result.scalars().all())

    async def touch(self, user_id: uuid.UUID, token_id: uuid.UUID, now: datetime) -> None:
        await self._session.execute(
            update(PersonalToken)
            .where(PersonalToken.id == token_id, PersonalToken.user_id == user_id)
            .values(last_used_at=now)
        )

    async def delete_revoked_before(self, cutoff: datetime) -> int:
        """Limpeza periódica, de todos os usuários: só tokens revogados há mais de 30 dias."""
        result = await self._session.execute(
            delete(PersonalToken)
            .where(PersonalToken.revoked_at < cutoff)
            .returning(PersonalToken.id)
        )
        return len(result.scalars().all())

    async def lock_user(self, user_id: uuid.UUID) -> None:
        """Trava a linha do usuário até o fim da transação: dois pedidos de criação simultâneos
        são atendidos um de cada vez, e a contagem do limite não falha."""
        await self._session.execute(select(User.id).where(User.id == user_id).with_for_update())


@dataclass(frozen=True)
class PersonalTokenView:
    """O que a tela mostra de um token: nunca o segredo nem o hash."""

    token: PersonalToken
    default_account: Account | None

    @property
    def needs_default_account(self) -> bool:
        return self.default_account is None or self.default_account.archived_at is not None


class PersonalTokenService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tokens = PersonalTokenRepository(session)
        self._accounts = AccountRepository(session)

    async def _active_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
        account = await self._accounts.get(user_id, account_id)
        if account is None or account.archived_at is not None:
            raise _invalid_default_account()
        return account

    async def _view(self, user_id: uuid.UUID, token: PersonalToken) -> PersonalTokenView:
        account = (
            await self._accounts.get(user_id, token.default_account_id)
            if token.default_account_id
            else None
        )
        return PersonalTokenView(token=token, default_account=account)

    async def create(
        self, user_id: uuid.UUID, *, name: str, default_account_id: uuid.UUID
    ) -> tuple[PersonalTokenView, str]:
        """Cria um token e devolve o token completo, que não volta a aparecer."""
        await self._tokens.lock_user(user_id)
        if await self._tokens.count_active(user_id) >= MAX_ACTIVE_TOKENS:
            raise PersonalTokenLimitReached()
        account = await self._active_account(user_id, default_account_id)

        token_id = uuid.uuid4()
        secret = secrets.token_urlsafe(32)
        token = await self._tokens.add(
            user_id,
            token_id=token_id,
            name=name,
            secret_hash=hash_token(secret),
            default_account_id=account.id,
            now=clock.utcnow(),
        )
        return PersonalTokenView(token=token, default_account=account), (
            f"{TOKEN_PREFIX}{token_id}.{secret}"
        )

    async def list_active(self, user_id: uuid.UUID) -> list[PersonalTokenView]:
        return [
            await self._view(user_id, token) for token in await self._tokens.list_active(user_id)
        ]

    async def set_default_account(
        self, user_id: uuid.UUID, token_id: uuid.UUID, account_id: uuid.UUID
    ) -> PersonalTokenView:
        token = await self._tokens.get_active(user_id, token_id)
        if token is None:
            raise PersonalTokenNotFound()
        account = await self._active_account(user_id, account_id)
        token.default_account_id = account.id
        await self._tokens.save(token)
        return PersonalTokenView(token=token, default_account=account)

    async def revoke(self, user_id: uuid.UUID, token_id: uuid.UUID) -> None:
        revoked = await self._tokens.revoke(
            user_id,
            token_id,
            reason=PersonalTokenRevokedReason.USER_REVOKED,
            now=clock.utcnow(),
        )
        if not revoked:
            raise PersonalTokenNotFound()

    async def revoke_all(self, user_id: uuid.UUID, reason: PersonalTokenRevokedReason) -> int:
        return await self._tokens.revoke_all(user_id, reason=reason, now=clock.utcnow())

    async def purge_revoked(self) -> int:
        return await self._tokens.delete_revoked_before(clock.utcnow() - REVOKED_TOKEN_RETENTION)

    async def authenticate(self, raw: str) -> AuthenticatedToken | None:
        """Confere um token. `None` em qualquer falha, sem dizer qual foi.

        Falha o token malformado, inexistente, revogado, com o segredo errado ou de uma conta
        excluída ou com a exclusão agendada.
        """
        parts = split_token(raw)
        if parts is None:
            return None
        token_id, secret = parts
        token = await self._tokens.get_for_authentication(token_id)
        if token is None or token.revoked_at is not None:
            return None
        if not hmac.compare_digest(token.secret_hash, hash_token(secret)):
            return None
        user = await self._session.get(User, token.user_id)
        if user is None or user.status != UserStatus.ACTIVE or user.email_verified_at is None:
            return None

        now = clock.utcnow()
        if token.last_used_at is None or now - token.last_used_at >= LAST_USED_RESOLUTION:
            await self._tokens.touch(token.user_id, token.id, now)
        return AuthenticatedToken(
            token_id=token.id, user_id=token.user_id, default_account_id=token.default_account_id
        )

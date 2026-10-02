"""Regras de autenticação: cadastro, confirmação de e-mail, login, refresh, logout e senha.

Nenhuma resposta daqui revela se um e-mail tem conta (FR-008): cadastro, reenvio e recuperação
respondem igual nos dois casos, e o login trata um e-mail sem conta como uma conta com a senha
errada, inclusive na contagem de erros e no bloqueio.
"""

import hmac
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Unauthenticated, ValidationFailed
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_token,
    password_needs_rehash,
    validate_password,
    verify_password,
)
from app.modules.auth import emails
from app.modules.auth.errors import (
    AccountLocked,
    EmailNotVerified,
    InvalidCredentials,
    InvalidOrExpiredToken,
)
from app.modules.auth.models import EmailToken, EmailTokenType, Session, SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.worker.jobs.send_email import enqueue_email

# Versão da política aceita no cadastro. Muda junto com o texto da política, que fica em
# frontend/src/features/auth/privacy-policy.ts.
PRIVACY_POLICY_VERSION = "1"

MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)
# Uma contagem sem erro novo por este tempo é apagada: os erros deixam de ser "seguidos".
LOGIN_ATTEMPT_RETENTION = timedelta(hours=24)
SESSION_TTL = timedelta(days=30)

PRIVACY_POLICY_REQUIRED_MESSAGE = "Para criar a conta, é preciso aceitar a política de privacidade."


@dataclass(frozen=True)
class IssuedTokens:
    """O que o login e o refresh entregam: o access token e o refresh token do cookie."""

    access_token: str
    refresh_token: str


@lru_cache
def _dummy_password_hash() -> str:
    """Hash usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos."""
    return hash_password(new_token())


def _login_attempt_key(email: str) -> str:
    """Chave da contagem de erros de login: o SHA-256 do e-mail normalizado.

    A contagem existe também para e-mails sem conta; guardar só o hash evita manter no banco
    endereços de quem não é usuário.
    """
    return hash_token(email.strip().lower())


def _split_refresh_token(refresh_token: str) -> tuple[uuid.UUID, str]:
    """O refresh token tem o formato `<id da sessão>.<segredo>`."""
    session_id, separator, secret = refresh_token.partition(".")
    if not separator or not secret:
        raise Unauthenticated()
    try:
        return uuid.UUID(session_id), secret
    except ValueError as exc:
        raise Unauthenticated() from exc


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._auth = AuthRepository(session)
        self._users = UserRepository(session)

    # ---------- cadastro e confirmação de e-mail

    async def register(
        self, *, name: str, email: str, password: str, accept_privacy_policy: bool
    ) -> None:
        if not accept_privacy_policy:
            raise ValidationFailed(
                PRIVACY_POLICY_REQUIRED_MESSAGE,
                details={"fields": {"accept_privacy_policy": PRIVACY_POLICY_REQUIRED_MESSAGE}},
            )
        validate_password(password)
        # O hash vem antes da busca: o pedido leva o mesmo tempo exista ou não o e-mail.
        password_hash = hash_password(password)

        created = await self._try_create_user(name, email, password_hash)
        if created is not None:
            await enqueue_email(self._session, user_id=created.id, email_type=emails.VERIFY_EMAIL)
            return
        existing = await self._users.get_by_email(email)
        if existing is not None:
            await self._notify_existing_account(existing)

    async def _try_create_user(self, name: str, email: str, password_hash: str) -> User | None:
        """Cria a conta; devolve `None` se o e-mail já tem conta."""
        if await self._users.get_by_email(email) is not None:
            return None
        try:
            # Savepoint: se outro cadastro com o mesmo e-mail chegou primeiro, só este
            # trecho é desfeito, e o pedido segue como "e-mail já cadastrado".
            async with self._session.begin_nested():
                return await self._users.create(
                    name=name,
                    email=email,
                    password_hash=password_hash,
                    privacy_policy_version=PRIVACY_POLICY_VERSION,
                    privacy_policy_accepted_at=clock.utcnow(),
                )
        except IntegrityError:
            return None

    async def _notify_existing_account(self, user: User) -> None:
        """O e-mail já tem conta: nada muda nela, e o dono é avisado por e-mail."""
        email_type = (
            emails.VERIFY_EMAIL if user.email_verified_at is None else emails.ALREADY_REGISTERED
        )
        await enqueue_email(self._session, user_id=user.id, email_type=email_type)

    async def verify_email(self, token: str) -> None:
        email_token = await self._use_email_token(token, EmailTokenType.EMAIL_VERIFICATION)
        user = await self._users.get_by_id(email_token.user_id)
        if user is None:
            raise InvalidOrExpiredToken()
        self._mark_email_verified(user, clock.utcnow())
        await self._users.save(user)

    @staticmethod
    def _mark_email_verified(user: User, now: datetime) -> None:
        """Único ponto em que uma conta passa a ter o e-mail confirmado.

        É chamado pelo link de confirmação e pelo link de redefinição de senha. Uma conta já
        confirmada mantém a data original.
        """
        if user.email_verified_at is None:
            user.email_verified_at = now

    async def resend_verification(self, email: str) -> None:
        user = await self._users.get_by_email(email)
        if user is not None and user.email_verified_at is None:
            await enqueue_email(self._session, user_id=user.id, email_type=emails.VERIFY_EMAIL)

    # ---------- login, refresh e logout

    async def login(self, *, email: str, password: str, user_agent: str, ip: str) -> IssuedTokens:
        """Entra com e-mail e senha.

        Um e-mail sem conta percorre exatamente o mesmo caminho de um com conta e senha errada:
        a mesma contagem de erros, o mesmo bloqueio, uma conferência de senha (contra um hash
        fictício) e as mesmas respostas. Assim nem a resposta nem o tempo revelam se o e-mail
        está cadastrado (FR-008).
        """
        now = clock.utcnow()
        email_key = _login_attempt_key(email)

        attempt = await self._auth.get_login_attempt(email_key)
        if attempt is not None and attempt.locked_until is not None and attempt.locked_until > now:
            # Bloqueado: nem a senha certa entra antes do prazo (FR-009).
            raise AccountLocked(math.ceil((attempt.locked_until - now).total_seconds()))

        user = await self._users.get_by_email(email)
        password_hash = user.password_hash if user is not None else _dummy_password_hash()
        password_matches = verify_password(password_hash, password)
        if user is None or not password_matches:
            await self._record_failed_login(email_key, now)
            raise InvalidCredentials()

        await self._auth.clear_login_attempts(email_key)
        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
            await self._users.save(user)

        if user.email_verified_at is None:
            # Só quem sabe a senha fica sabendo que falta confirmar o e-mail.
            await self._session.commit()
            raise EmailNotVerified()

        return await self._open_session(user, user_agent=user_agent, ip=ip, now=now)

    async def _record_failed_login(self, email_key: str, now: datetime) -> None:
        failures = await self._auth.count_failed_login(email_key, now)
        if failures >= MAX_FAILED_LOGINS:
            await self._auth.lock_login(email_key, until=now + LOCK_DURATION)
        # O erro que vem a seguir desfaz a transação da requisição; a contagem precisa ficar.
        await self._session.commit()

    async def purge_stale_login_attempts(self) -> int:
        """Apaga contagens sem erro recente e sem bloqueio em curso; devolve quantas apagou."""
        now = clock.utcnow()
        return await self._auth.purge_login_attempts(
            last_failed_before=now - LOGIN_ATTEMPT_RETENTION, now=now
        )

    async def _open_session(
        self, user: User, *, user_agent: str, ip: str, now: datetime
    ) -> IssuedTokens:
        secret = new_token()
        auth_session = await self._auth.create_session(
            user_id=user.id,
            refresh_token_hash=hash_token(secret),
            user_agent=user_agent,
            ip=ip,
            now=now,
            expires_at=now + SESSION_TTL,
        )
        return self._issue(auth_session, secret)

    @staticmethod
    def _issue(auth_session: Session, secret: str) -> IssuedTokens:
        return IssuedTokens(
            access_token=create_access_token(auth_session.user_id, auth_session.id),
            refresh_token=f"{auth_session.id}.{secret}",
        )

    async def refresh(self, *, refresh_token: str, ip: str) -> IssuedTokens:
        """Troca o refresh token por um novo. Um token antigo reapresentado revoga a sessão."""
        session_id, secret = _split_refresh_token(refresh_token)
        now = clock.utcnow()
        auth_session = await self._auth.get_session_by_id(session_id, for_update=True)
        if (
            auth_session is None
            or auth_session.revoked_at is not None
            or auth_session.expires_at <= now
        ):
            raise Unauthenticated()

        if not hmac.compare_digest(auth_session.refresh_token_hash, hash_token(secret)):
            # Só o último token emitido vale. Outro segredo para a mesma sessão é um token
            # antigo sendo reutilizado, talvez roubado: a sessão inteira cai.
            await self._auth.revoke_session(
                auth_session.user_id,
                auth_session.id,
                reason=SessionRevokedReason.TOKEN_REUSE,
                now=now,
            )
            await self._session.commit()
            raise Unauthenticated()

        new_secret = new_token()
        await self._auth.rotate_session(
            auth_session.user_id,
            auth_session.id,
            refresh_token_hash=hash_token(new_secret),
            ip=ip,
            now=now,
            expires_at=now + SESSION_TTL,
        )
        return self._issue(auth_session, new_secret)

    async def logout(self, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
        await self._auth.revoke_session(
            user_id, session_id, reason=SessionRevokedReason.LOGOUT, now=clock.utcnow()
        )

    # ---------- recuperação de senha

    async def request_password_reset(self, email: str) -> None:
        user = await self._users.get_by_email(email)
        if user is not None:
            await enqueue_email(self._session, user_id=user.id, email_type=emails.PASSWORD_RESET)

    async def reset_password(self, *, token: str, new_password: str) -> None:
        now = clock.utcnow()
        email_token = await self._find_valid_email_token(token, EmailTokenType.PASSWORD_RESET, now)
        # A senha é conferida antes de gastar o link: uma senha recusada não o invalida.
        validate_password(new_password, field="new_password")
        if not await self._auth.mark_email_token_used(email_token.user_id, email_token.id, now):
            raise InvalidOrExpiredToken()

        user = await self._users.get_by_id(email_token.user_id)
        if user is None:
            raise InvalidOrExpiredToken()
        user.password_hash = hash_password(new_password)
        # O link chegou à caixa de e-mail: usá-lo prova a posse dela, como o link de confirmação.
        self._mark_email_verified(user, now)
        await self._users.save(user)
        # A senha nova também desfaz um bloqueio por tentativas erradas.
        await self._auth.clear_login_attempts(_login_attempt_key(user.email))
        await self._auth.revoke_all_sessions(
            user.id, reason=SessionRevokedReason.PASSWORD_RESET, now=now
        )

    # ---------- tokens enviados por e-mail

    async def _find_valid_email_token(
        self, token: str, token_type: EmailTokenType, now: datetime
    ) -> EmailToken:
        email_token = await self._auth.get_email_token_by_hash(hash_token(token))
        if (
            email_token is None
            or email_token.type != token_type
            or email_token.used_at is not None
            or email_token.expires_at <= now
        ):
            raise InvalidOrExpiredToken()
        return email_token

    async def _use_email_token(self, token: str, token_type: EmailTokenType) -> EmailToken:
        """Confere o token e o marca como usado; o uso é único mesmo com dois cliques juntos."""
        now = clock.utcnow()
        email_token = await self._find_valid_email_token(token, token_type, now)
        if not await self._auth.mark_email_token_used(email_token.user_id, email_token.id, now):
            raise InvalidOrExpiredToken()
        return email_token

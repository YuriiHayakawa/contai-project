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
    create_challenge_token,
    decode_challenge_token,
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
    InvalidTwoFactorCode,
)
from app.modules.auth.models import EmailToken, EmailTokenType, Session, SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.auth.two_factor import verify_second_factor
from app.modules.categories.service import CategoryService
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.worker.jobs.send_email import enqueue_email

# Versão da política aceita no cadastro. Muda junto com o texto da política, que fica em
# frontend/src/features/auth/privacy-policy.ts.
PRIVACY_POLICY_VERSION = "2"

MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)
# Uma contagem sem erro novo por este tempo é apagada: os erros deixam de ser "seguidos".
LOGIN_ATTEMPT_RETENTION = timedelta(hours=24)
SESSION_TTL = timedelta(days=30)
# Uma sessão revogada ainda serve por um tempo para auditar o motivo; depois disso, sai.
REVOKED_SESSION_RETENTION = timedelta(days=30)
# A desativação da verificação em duas etapas só vale 72 horas após o pedido (FR-013), com um
# lembrete por e-mail 24 horas antes.
TWO_FACTOR_RESET_DELAY = timedelta(hours=72)
TWO_FACTOR_RESET_REMINDER_LEAD = timedelta(hours=24)

PRIVACY_POLICY_REQUIRED_MESSAGE = "Para criar a conta, é preciso aceitar a política de privacidade."


@dataclass(frozen=True)
class IssuedTokens:
    """O que o login e o refresh entregam: o access token e o refresh token do cookie."""

    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class TwoFactorChallenge:
    """Login com e-mail e senha corretos, faltando a segunda etapa (FR-012)."""

    challenge_token: str


# O que o login devolve: as credenciais, ou o desafio da segunda etapa.
LoginOutcome = IssuedTokens | TwoFactorChallenge


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
        await self._mark_email_verified(user, clock.utcnow())
        await self._users.save(user)

    async def _mark_email_verified(self, user: User, now: datetime) -> None:
        """Único ponto em que uma conta passa a ter o e-mail confirmado.

        É chamado pelo link de confirmação e pelo link de redefinição de senha. Uma conta já
        confirmada mantém a data original. Na mesma transação, a conta recebe as categorias
        prontas (FR-024).
        """
        if user.email_verified_at is None:
            user.email_verified_at = now
            await CategoryService(self._session).create_defaults(user.id)

    async def resend_verification(self, email: str) -> None:
        user = await self._users.get_by_email(email)
        if user is not None and user.email_verified_at is None:
            await enqueue_email(self._session, user_id=user.id, email_type=emails.VERIFY_EMAIL)

    # ---------- login, refresh e logout

    async def login(self, *, email: str, password: str, user_agent: str, ip: str) -> LoginOutcome:
        """Entra com e-mail e senha.

        Um e-mail sem conta percorre exatamente o mesmo caminho de um com conta e senha errada:
        a mesma contagem de erros, o mesmo bloqueio, uma conferência de senha (contra um hash
        fictício) e as mesmas respostas. Assim nem a resposta nem o tempo revelam se o e-mail
        está cadastrado (FR-008).

        Com a verificação em duas etapas ativa, a senha correta não dá acesso: devolve um desafio
        para a segunda etapa (FR-012).
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

        if user.totp_enabled_at is not None:
            return TwoFactorChallenge(challenge_token=create_challenge_token(user.id))

        return await self._open_session(user, user_agent=user_agent, ip=ip, now=now)

    async def complete_two_factor_login(
        self,
        *,
        challenge_token: str,
        code: str | None,
        recovery_code: str | None,
        user_agent: str,
        ip: str,
    ) -> IssuedTokens:
        """Segunda etapa do login: confere o código do app ou um de recuperação (FR-012).

        Um código errado conta para o mesmo bloqueio do login. Entrar com um código válido
        cancela um pedido de desativação da verificação em duas etapas que esteja em aberto.
        """
        user_id = decode_challenge_token(challenge_token)
        now = clock.utcnow()
        user = await self._users.get_by_id(user_id)
        if user is None or user.totp_enabled_at is None:
            raise Unauthenticated()

        email_key = _login_attempt_key(user.email)
        attempt = await self._auth.get_login_attempt(email_key)
        if attempt is not None and attempt.locked_until is not None and attempt.locked_until > now:
            raise AccountLocked(math.ceil((attempt.locked_until - now).total_seconds()))

        verified = await verify_second_factor(
            self._auth, user, code=code, recovery_code=recovery_code, now=now
        )
        if not verified:
            await self._record_failed_login(email_key, now)
            raise InvalidTwoFactorCode()

        await self._auth.clear_login_attempts(email_key)
        await self._auth.cancel_open_reset_requests(user.id, now)
        await self._users.save(user)
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

    async def purge_expired_auth_data(self) -> int:
        """Apaga tokens de e-mail vencidos e sessões expiradas ou revogadas há mais de 30 dias.

        Devolve o total de linhas apagadas, só para o log do worker.
        """
        now = clock.utcnow()
        tokens = await self._auth.delete_expired_email_tokens(now)
        sessions = await self._auth.delete_stale_sessions(
            now=now, revoked_before=now - REVOKED_SESSION_RETENTION
        )
        return tokens + sessions

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
        await self._mark_email_verified(user, now)
        await self._users.save(user)
        # A senha nova também desfaz um bloqueio por tentativas erradas.
        await self._auth.clear_login_attempts(_login_attempt_key(user.email))
        await self._auth.revoke_all_sessions(
            user.id, reason=SessionRevokedReason.PASSWORD_RESET, now=now
        )

    # ---------- desativação da verificação em duas etapas (recuperação, FR-013)

    async def request_two_factor_reset(self, challenge_token: str) -> None:
        """Quem perdeu o celular e os códigos pede, após a senha, o link de desativação.

        O `challenge_token` prova que a senha já foi conferida. A resposta é a mesma com ou sem
        pedido de verdade: nada aqui revela o estado da conta.
        """
        user_id = decode_challenge_token(challenge_token)
        user = await self._users.get_by_id(user_id)
        if user is not None and user.totp_enabled_at is not None:
            await enqueue_email(
                self._session, user_id=user.id, email_type=emails.TWO_FACTOR_RESET_LINK
            )

    async def confirm_two_factor_reset(self, token: str) -> datetime:
        """Abre a contagem de 72 horas e avisa o usuário, com um link para cancelar (FR-013)."""
        email_token = await self._use_email_token(token, EmailTokenType.TWO_FACTOR_RESET_CONFIRM)
        user = await self._users.get_by_id(email_token.user_id)
        if user is None or user.totp_enabled_at is None:
            raise InvalidOrExpiredToken()

        now = clock.utcnow()
        existing = await self._auth.get_open_reset_request(user.id)
        if existing is not None:
            # Um pedido já estava em aberto: mantém a data em vez de reiniciar a contagem.
            return existing.effective_at

        effective_at = now + TWO_FACTOR_RESET_DELAY
        await self._auth.create_reset_request(
            user_id=user.id, requested_at=now, effective_at=effective_at
        )
        await enqueue_email(
            self._session,
            user_id=user.id,
            email_type=emails.TWO_FACTOR_RESET_NOTICE,
            context={"effective_at": clock.format_datetime(effective_at)},
        )
        return effective_at

    async def cancel_two_factor_reset(self, token: str) -> None:
        email_token = await self._use_email_token(token, EmailTokenType.TWO_FACTOR_RESET_CANCEL)
        await self._auth.cancel_open_reset_requests(email_token.user_id, clock.utcnow())

    async def send_two_factor_reset_reminders(self) -> int:
        """Envia o lembrete 24 horas antes de a desativação valer; devolve quantos saíram."""
        now = clock.utcnow()
        due = await self._auth.list_reset_requests_needing_reminder(
            now=now, remind_at_or_before=now + TWO_FACTOR_RESET_REMINDER_LEAD
        )
        for request in due:
            await enqueue_email(
                self._session,
                user_id=request.user_id,
                email_type=emails.TWO_FACTOR_RESET_REMINDER,
                context={"effective_at": clock.format_datetime(request.effective_at)},
            )
            await self._auth.mark_reset_reminder_sent(request.id, now)
        return len(due)

    async def apply_due_two_factor_resets(self) -> int:
        """Aplica os pedidos vencidos: desativa a verificação e encerra todas as sessões."""
        now = clock.utcnow()
        due = await self._auth.list_reset_requests_due(now)
        for request in due:
            user = await self._users.get_by_id(request.user_id)
            if user is not None and user.totp_enabled_at is not None:
                user.totp_secret_encrypted = None
                user.totp_enabled_at = None
                user.totp_last_used_step = None
                await self._auth.delete_recovery_codes(user.id)
                await self._auth.revoke_all_sessions(
                    user.id, reason=SessionRevokedReason.TWO_FACTOR_RESET, now=now
                )
                await self._users.save(user)
                await enqueue_email(
                    self._session, user_id=user.id, email_type=emails.TWO_FACTOR_RESET_APPLIED
                )
            await self._auth.mark_reset_applied(request.id, now)
        return len(due)

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

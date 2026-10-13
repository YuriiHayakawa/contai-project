"""Regras do usuário sobre a própria conta: perfil, senha, sessões e verificação em duas etapas."""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import NotFound
from app.core.security import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_password,
    hash_recovery_code,
    totp_provisioning_uri,
    validate_password,
    verify_password,
    verify_totp,
)
from app.modules.auth.errors import (
    IncorrectPassword,
    InvalidTwoFactorCode,
    TwoFactorAlreadyEnabled,
    TwoFactorNotEnabled,
    TwoFactorSetupRequired,
)
from app.modules.auth.models import SessionRevokedReason
from app.modules.auth.repository import AuthRepository
from app.modules.auth.two_factor import verify_second_factor
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import (
    RecoveryCodesResponse,
    SessionRead,
    TwoFactorSetupResponse,
    UserRead,
)


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._users = UserRepository(session)
        self._auth = AuthRepository(session)

    async def _require(self, user_id: uuid.UUID) -> User:
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise NotFound()
        return user

    # ---------- perfil

    async def get_profile(self, user_id: uuid.UUID) -> UserRead:
        return UserRead.from_user(await self._require(user_id))

    async def update_name(self, user_id: uuid.UUID, name: str) -> UserRead:
        user = await self._require(user_id)
        user.name = name
        await self._users.save(user)
        return UserRead.from_user(user)

    async def change_password(
        self,
        user_id: uuid.UUID,
        *,
        current_password: str,
        new_password: str,
        current_session_id: uuid.UUID,
    ) -> None:
        """Troca a senha; exige a senha atual e encerra as outras sessões (FR-015)."""
        user = await self._require(user_id)
        if not verify_password(user.password_hash, current_password):
            raise IncorrectPassword()
        validate_password(new_password, field="new_password")
        user.password_hash = hash_password(new_password)
        await self._users.save(user)
        await self._auth.revoke_all_sessions(
            user_id,
            reason=SessionRevokedReason.PASSWORD_CHANGED,
            now=clock.utcnow(),
            except_session_id=current_session_id,
        )

    async def accept_ai_documents(self, user_id: uuid.UUID) -> None:
        """Registra o aceite do aviso que antecede o primeiro envio de PDF ou imagem (FR-044).

        Vale a data do primeiro aceite: aceitar de novo não a muda.
        """
        user = await self._require(user_id)
        if user.ai_documents_consent_at is None:
            user.ai_documents_consent_at = clock.utcnow()
            await self._users.save(user)

    # ---------- sessões (FR-014)

    async def list_sessions(
        self, user_id: uuid.UUID, current_session_id: uuid.UUID
    ) -> list[SessionRead]:
        sessions = await self._auth.list_active_sessions(user_id, clock.utcnow())
        return [
            SessionRead.from_session(session, is_current=session.id == current_session_id)
            for session in sessions
        ]

    async def end_session(self, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
        ended = await self._auth.revoke_session(
            user_id, session_id, reason=SessionRevokedReason.USER_REVOKED, now=clock.utcnow()
        )
        if not ended:
            raise NotFound()

    async def end_other_sessions(self, user_id: uuid.UUID, current_session_id: uuid.UUID) -> None:
        await self._auth.revoke_all_sessions(
            user_id,
            reason=SessionRevokedReason.USER_REVOKED,
            now=clock.utcnow(),
            except_session_id=current_session_id,
        )

    # ---------- verificação em duas etapas (FR-011, FR-013)

    async def start_two_factor_setup(self, user_id: uuid.UUID) -> TwoFactorSetupResponse:
        """Gera e guarda (cifrado) um segredo novo; a ativação só vale depois de confirmar."""
        user = await self._require(user_id)
        if user.totp_enabled_at is not None:
            raise TwoFactorAlreadyEnabled()
        secret = generate_totp_secret()
        user.totp_secret_encrypted = encrypt_totp_secret(secret)
        user.totp_last_used_step = None
        await self._users.save(user)
        return TwoFactorSetupResponse(
            otpauth_uri=totp_provisioning_uri(secret, user.email), secret=secret
        )

    async def enable_two_factor(self, user_id: uuid.UUID, code: str) -> RecoveryCodesResponse:
        """Confirma o código, ativa a verificação e entrega os 10 códigos de recuperação."""
        user = await self._require(user_id)
        if user.totp_enabled_at is not None:
            raise TwoFactorAlreadyEnabled()
        if user.totp_secret_encrypted is None:
            raise TwoFactorSetupRequired()
        now = clock.utcnow()
        step = verify_totp(
            decrypt_totp_secret(user.totp_secret_encrypted), code, last_used_step=None, now=now
        )
        if step is None:
            raise InvalidTwoFactorCode()
        user.totp_enabled_at = now
        user.totp_last_used_step = step
        codes = await self._issue_recovery_codes(user_id)
        await self._users.save(user)
        return codes

    async def disable_two_factor(self, user_id: uuid.UUID, *, password: str, code: str) -> None:
        """Desativa a verificação; exige a senha e um código do app (FR-013)."""
        user = await self._require(user_id)
        if user.totp_enabled_at is None:
            raise TwoFactorNotEnabled()
        now = clock.utcnow()
        self._require_password(user, password)
        await self._require_code(user, code, now)
        user.totp_secret_encrypted = None
        user.totp_enabled_at = None
        user.totp_last_used_step = None
        await self._auth.delete_recovery_codes(user_id)
        await self._auth.cancel_open_reset_requests(user_id, now)
        await self._users.save(user)

    async def regenerate_recovery_codes(
        self, user_id: uuid.UUID, *, password: str, code: str
    ) -> RecoveryCodesResponse:
        """Gera 10 códigos novos e invalida os anteriores; exige a senha e um código (FR-011)."""
        user = await self._require(user_id)
        if user.totp_enabled_at is None:
            raise TwoFactorNotEnabled()
        now = clock.utcnow()
        self._require_password(user, password)
        await self._require_code(user, code, now)
        codes = await self._issue_recovery_codes(user_id)
        await self._users.save(user)
        return codes

    def _require_password(self, user: User, password: str) -> None:
        if not verify_password(user.password_hash, password):
            raise IncorrectPassword(field="password")

    async def _require_code(self, user: User, code: str, now: datetime) -> None:
        verified = await verify_second_factor(
            self._auth, user, code=code, recovery_code=None, now=now
        )
        if not verified:
            raise InvalidTwoFactorCode()

    async def _issue_recovery_codes(self, user_id: uuid.UUID) -> RecoveryCodesResponse:
        codes = generate_recovery_codes()
        await self._auth.replace_recovery_codes(user_id, [hash_recovery_code(c) for c in codes])
        return RecoveryCodesResponse(recovery_codes=codes)

"""Regras do usuário sobre a própria conta."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import NotFound
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import UserRead


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self._users = UserRepository(session)

    async def get_profile(self, user_id: uuid.UUID) -> UserRead:
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise NotFound()
        return UserRead.from_user(user)

    async def accept_ai_documents(self, user_id: uuid.UUID) -> None:
        """Registra o aceite do aviso que antecede o primeiro envio de PDF ou imagem (FR-044).

        Vale a data do primeiro aceite: aceitar de novo não a muda.
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise NotFound()
        if user.ai_documents_consent_at is None:
            user.ai_documents_consent_at = clock.utcnow()
            await self._users.save(user)

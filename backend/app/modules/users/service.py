"""Regras do usuário sobre a própria conta."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

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

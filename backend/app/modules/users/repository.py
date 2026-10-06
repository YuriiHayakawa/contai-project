"""Acesso ao banco para usuários."""

import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self._session.get(User, user_id)

    async def get_by_email(self, email: str) -> User | None:
        """Busca por credencial: é como o login e o cadastro encontram a conta."""
        result = await self._session.execute(select(User).where(User.email == email.lower()))
        return result.scalar_one_or_none()

    async def create(
        self,
        *,
        name: str,
        email: str,
        password_hash: str,
        privacy_policy_version: str,
        privacy_policy_accepted_at: datetime,
    ) -> User:
        user = User(
            name=name,
            email=email.lower(),
            password_hash=password_hash,
            privacy_policy_version=privacy_policy_version,
            privacy_policy_accepted_at=privacy_policy_accepted_at,
        )
        self._session.add(user)
        await self._session.flush()
        await self._session.refresh(user)
        return user

    async def save(self, user: User) -> User:
        """Grava as alterações feitas em um usuário já carregado."""
        await self._session.flush()
        return user

    async def delete(self, user_id: uuid.UUID) -> None:
        """Apaga o usuário; o banco apaga em cascata todos os dados dele."""
        await self._session.execute(delete(User).where(User.id == user_id))

"""Tarefa periódica da exclusão definitiva de contas (FR-017).

Só chama o serviço do usuário; nenhuma consulta ao banco diretamente.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.service import UserService

logger = logging.getLogger("contai.worker")


async def purge_due_account_deletions(session: AsyncSession) -> None:
    purged = await UserService(session).purge_due_account_deletions()
    if purged:
        logger.info("account deletions applied", extra={"count": purged})

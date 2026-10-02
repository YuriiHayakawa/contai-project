"""Tarefa periódica: apaga as contagens de erros de login que já não valem.

Só chama o serviço de autenticação; não consulta o banco.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.service import AuthService

logger = logging.getLogger("contai.worker")


async def purge_login_attempts(session: AsyncSession) -> None:
    purged = await AuthService(session).purge_stale_login_attempts()
    if purged:
        logger.info("stale login attempts purged", extra={"count": purged})

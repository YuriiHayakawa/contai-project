"""Tarefa periódica: expira as importações que esperaram demais e apaga os arquivos que
sobraram (FR-083).

Só chama o serviço de importações; não consulta o banco.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.imports.service import ImportService

logger = logging.getLogger("contai.worker")


async def cleanup_imports(session: AsyncSession) -> None:
    expired = await ImportService(session).expire_stale()
    if expired:
        logger.info("stale imports expired", extra={"count": expired})

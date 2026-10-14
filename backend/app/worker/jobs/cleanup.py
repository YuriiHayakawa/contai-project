"""Tarefas periódicas de limpeza.

- `cleanup_imports`: expira as importações que esperaram demais e apaga os arquivos que sobraram
  (FR-083).
- `cleanup_expired_auth_and_jobs`: apaga tokens de e-mail vencidos, sessões expiradas ou revogadas
  há mais de 30 dias e jobs concluídos antigos.

Cada tarefa só chama serviços dos módulos e a fila; nenhuma consulta o banco diretamente.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.service import AuthService
from app.modules.imports.service import ImportService
from app.worker import queue

logger = logging.getLogger("contai.worker")


async def cleanup_imports(session: AsyncSession) -> None:
    expired = await ImportService(session).expire_stale()
    if expired:
        logger.info("stale imports expired", extra={"count": expired})


async def cleanup_expired_auth_and_jobs(session: AsyncSession) -> None:
    auth_rows = await AuthService(session).purge_expired_auth_data()
    jobs = await queue.purge_finished(session)
    if auth_rows or jobs:
        logger.info("expired data purged", extra={"count": auth_rows + jobs})

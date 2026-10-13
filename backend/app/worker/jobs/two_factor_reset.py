"""Tarefas periódicas da desativação da verificação em duas etapas (FR-013).

Só chamam o serviço de autenticação; nenhuma consulta o banco diretamente.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.service import AuthService

logger = logging.getLogger("contai.worker")


async def send_two_factor_reset_reminders(session: AsyncSession) -> None:
    sent = await AuthService(session).send_two_factor_reset_reminders()
    if sent:
        logger.info("two-factor reset reminders sent", extra={"count": sent})


async def apply_due_two_factor_resets(session: AsyncSession) -> None:
    applied = await AuthService(session).apply_due_two_factor_resets()
    if applied:
        logger.info("two-factor resets applied", extra={"count": applied})

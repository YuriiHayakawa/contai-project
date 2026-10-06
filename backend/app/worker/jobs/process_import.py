"""Job de processamento de uma importação.

O payload traz só o id da importação. A leitura do arquivo e a preparação da revisão ficam no
serviço de importações; aqui não há consulta ao banco.
"""

import uuid
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import LLMRateLimited, LLMUnavailable
from app.modules.imports.service import ImportService
from app.worker import queue
from app.worker.models import Job

AI_RATE_LIMITED = "ai_rate_limited"
AI_UNAVAILABLE = "ai_unavailable"


def _target(job: Job) -> tuple[uuid.UUID, uuid.UUID]:
    """O usuário e a importação de que o job trata."""
    try:
        import_id = uuid.UUID(str(job.payload.get("import_id")))
    except ValueError as exc:
        raise queue.PermanentJobError("invalid_payload") from exc
    if job.user_id is None:
        raise queue.PermanentJobError("invalid_payload")
    return job.user_id, import_id


async def handle_process_import(session: AsyncSession, job: Job) -> None:
    user_id, import_id = _target(job)
    # Um arquivo que não pôde ser lido não é falha do job: a importação fica como `failed`,
    # com o motivo, e o job termina. O mesmo vale para a cota do dia do serviço de IA, que
    # não adianta repetir hoje.
    try:
        await ImportService(session).process(user_id, import_id)
    except LLMRateLimited as error:
        # O serviço de IA pediu para esperar: o job volta para a fila, e o arquivo continua
        # guardado (FR-072). Quando o provedor diz quanto esperar, vale a espera dele.
        delay = timedelta(seconds=error.retry_after) if error.retry_after else None
        raise queue.RetryableJobError(AI_RATE_LIMITED, delay) from error
    except LLMUnavailable as error:
        raise queue.RetryableJobError(AI_UNAVAILABLE) from error


async def handle_import_given_up(session: AsyncSession, job: Job) -> None:
    """As tentativas acabaram: a importação vai para erro, em vez de ficar presa na fila."""
    try:
        user_id, import_id = _target(job)
    except queue.PermanentJobError:
        # Um job que não diz de qual importação trata não deixou nenhuma presa.
        return
    await ImportService(session).fail_abandoned(user_id, import_id)

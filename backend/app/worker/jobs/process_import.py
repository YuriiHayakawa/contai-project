"""Job de processamento de uma importação.

O payload traz só o id da importação. A leitura do arquivo e a preparação da revisão ficam no
serviço de importações; aqui não há consulta ao banco.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.imports.service import ImportService
from app.worker import queue
from app.worker.models import Job


async def handle_process_import(session: AsyncSession, job: Job) -> None:
    try:
        import_id = uuid.UUID(str(job.payload.get("import_id")))
    except ValueError as exc:
        raise queue.PermanentJobError("invalid_payload") from exc
    if job.user_id is None:
        raise queue.PermanentJobError("invalid_payload")
    # Um arquivo que não pôde ser lido não é falha do job: a importação fica como `failed`,
    # com o motivo, e o job termina.
    await ImportService(session).process(job.user_id, import_id)

"""Worker embutido: o laço da fila como tarefa de fundo dentro do processo da API.

No Render gratuito não há processo de worker separado (ADR 0010), e o ambiente local segue o
mesmo desenho. O laço começa quando a API sobe e para quando ela desliga: o job em andamento
termina, dentro de um prazo; o que passar dele é interrompido e volta para a fila pela
recuperação de jobs travados.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.worker.main import Worker

# O Render espera 30 segundos entre o pedido de parada e o fim forçado do processo.
SHUTDOWN_GRACE_SECONDS = 20.0

logger = logging.getLogger("contai.worker")


@asynccontextmanager
async def embedded_worker(worker: Worker) -> AsyncIterator[None]:
    stop = asyncio.Event()
    task = asyncio.create_task(worker.run(stop), name="embedded-worker")
    try:
        yield
    finally:
        stop.set()
        try:
            await asyncio.wait_for(task, SHUTDOWN_GRACE_SECONDS)
        except TimeoutError:
            # O `wait_for` cancela a tarefa; o job interrompido volta para a fila depois.
            logger.warning("embedded worker stopped before finishing its job")

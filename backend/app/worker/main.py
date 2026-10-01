"""Processo worker.

Esqueleto da fase Setup: mantém o processo vivo e registra o batimento em arquivo. O consumo da
fila, as tarefas periódicas e o batimento no banco entram na T030.
"""

import asyncio
import logging
import signal
from pathlib import Path

HEARTBEAT_FILE = Path("/tmp/contai-worker-heartbeat")  # noqa: S108 - provisório até a T030
HEARTBEAT_INTERVAL_SECONDS = 15

logger = logging.getLogger("contai.worker")


async def run(stop: asyncio.Event) -> None:
    while not stop.is_set():
        await asyncio.to_thread(HEARTBEAT_FILE.touch)
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL_SECONDS)
        except TimeoutError:
            continue


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    logger.info("worker started")
    await run(stop)
    logger.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(main())

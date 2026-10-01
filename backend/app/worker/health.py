"""Checagem de saúde do worker, usada pelo healthcheck do contêiner.

Esqueleto da fase Setup: lê o batimento em arquivo. A leitura pelo repositório do worker entra
na T030.
"""

import sys
import time

from app.worker.main import HEARTBEAT_FILE

MAX_AGE_SECONDS = 60


def is_healthy() -> bool:
    try:
        age = time.time() - HEARTBEAT_FILE.stat().st_mtime
    except FileNotFoundError:
        return False
    return age < MAX_AGE_SECONDS


if __name__ == "__main__":
    sys.exit(0 if is_healthy() else 1)

#!/bin/sh
# Aplica as migrações antes de iniciar a API. O worker usa a mesma imagem com
# RUN_MIGRATIONS=0, para que só um processo migre o banco.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    if [ -f alembic.ini ]; then
        alembic upgrade head
    else
        # O Alembic é configurado na T013; até lá não há o que migrar.
        echo "alembic.ini não encontrado: migrações ignoradas"
    fi
fi

exec "$@"

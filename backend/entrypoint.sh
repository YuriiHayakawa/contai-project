#!/bin/sh
# Aplica as migrações antes de iniciar a API. O worker, quando roda à parte com a mesma imagem,
# usa RUN_MIGRATIONS=0, para que só um processo migre o banco.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    alembic upgrade head
fi

exec "$@"

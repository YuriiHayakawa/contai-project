# Imagem do backend: a API, que roda também o worker da fila (WORKER_EMBEDDED); o worker pode
# rodar sozinho com `python -m app.worker.main`.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /bin/uv

# Usuário sem privilégios.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /opt/venv \
    && chown -R app:app /opt/venv

WORKDIR /app
COPY --chown=app:app pyproject.toml uv.lock ./
COPY --chmod=755 entrypoint.sh /entrypoint.sh

USER app
ENTRYPOINT ["/entrypoint.sh"]
# O Render informa a porta em PORT; fora dele vale a 8000.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]

# Desenvolvimento: inclui as ferramentas de lint, tipos e testes; o código vem por volume.
FROM base AS dev
RUN uv sync --frozen
COPY --chown=app:app . .

# Produção: só as dependências de execução.
FROM base AS prod
RUN uv sync --frozen --no-dev
COPY --chown=app:app . .

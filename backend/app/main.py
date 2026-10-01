"""Ponto de entrada da API.

Esqueleto da fase Setup: só o necessário para o ambiente subir. A fábrica do app, com
middlewares, cabeçalhos de segurança, tratamento de erros e routers, entra na T032.
"""

from fastapi import FastAPI

app = FastAPI(
    title="Contaí",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

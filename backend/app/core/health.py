"""Endpoints de saúde da API e do worker. São públicos e não devolvem nenhum dado."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session, ping
from app.worker import health as worker_health

router = APIRouter(prefix="/api/v1/health", tags=["health"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _status(healthy: bool) -> JSONResponse:
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "unavailable"},
    )


@router.get("", summary="Saúde da API e do banco")
async def api_health(session: SessionDep) -> JSONResponse:
    return _status(await ping(session))


@router.get("/worker", summary="Saúde do worker")
async def worker_health_check(session: SessionDep) -> JSONResponse:
    return _status(await worker_health.is_healthy(session))

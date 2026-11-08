"""Endpoint interno: o disparo externo das tarefas agendadas (ADR 0010).

O serviço da API dorme sem acessos, e o laço do worker dorme junto; as tarefas com prazo
(exclusão de conta, desativação das duas etapas e seus avisos, limpezas) não podem depender de
alguém usar o app. O workflow `scheduled-tasks.yml` chama esta rota a cada 3 horas, com o token
de `SCHEDULER_TOKEN`. Ela não usa o login de usuário nem lida com os dados de um usuário
específico. Enquanto os Actions da conta estiverem bloqueados (ADR 0010), quem acorda a API é o
cron-job.org, pelo health check, e o laço do worker roda as tarefas ao começar.
"""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.database import SessionFactory, get_session_factory
from app.core.errors import NotFound, Unauthenticated
from app.core.rate_limit import limiter
from app.worker.main import build_worker
from app.worker.schemas import ScheduledTaskRead, ScheduledTasksRead

SCHEDULER_RATE_LIMIT = "10/hour"
INVALID_TOKEN_MESSAGE = "Token do disparo das tarefas agendadas ausente ou inválido."  # noqa: S105 - mensagem de erro, não é segredo

router = APIRouter(prefix="/api/v1/internal", tags=["interno"])


def _require_scheduler_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().scheduler_token.get_secret_value()
    if not expected:
        # Sem token configurado, o endpoint não existe.
        raise NotFound()
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), expected.encode()):
        raise Unauthenticated(INVALID_TOKEN_MESSAGE)


@router.post(
    "/scheduled-tasks",
    summary="Rodar as tarefas agendadas (disparo externo)",
    description=(
        "Exige `Authorization: Bearer <SCHEDULER_TOKEN>`. Roda cada tarefa periódica uma vez, "
        "sob a trava dela, e diz como foi cada uma: `ok`, `skipped` (a trava estava com o laço "
        "do worker) ou `failed`. Responde `503`, com o mesmo corpo, se alguma falhou."
    ),
    response_model=ScheduledTasksRead,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ScheduledTasksRead}},
    dependencies=[Depends(_require_scheduler_token)],
)
@limiter.limit(SCHEDULER_RATE_LIMIT)
async def run_scheduled_tasks(
    request: Request,
    session_factory: Annotated[SessionFactory, Depends(get_session_factory)],
) -> JSONResponse:
    results = await build_worker(session_factory).run_scheduled_tasks()
    body = ScheduledTasksRead(
        tasks=[ScheduledTaskRead(name=result.name, status=result.status) for result in results]
    )
    failed = any(result.status == "failed" for result in results)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE if failed else status.HTTP_200_OK,
        content=body.model_dump(mode="json"),
    )

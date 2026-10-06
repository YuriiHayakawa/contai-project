"""Logs estruturados em JSON, com id da requisição e sem dados sensíveis.

A regra é uma lista do que PODE ser registrado. Mensagens são textos fixos; dados variáveis vão
em `extra`, e só as chaves de `ALLOWED_FIELDS` chegam à saída. De uma exceção registram-se o
tipo e a pilha de chamadas, nunca a mensagem nem os valores das variáveis.
"""

import json
import logging
import sys
import time
import traceback
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"

ALLOWED_FIELDS = frozenset(
    {
        "method",
        "route",
        "status",
        "duration_ms",
        "user_id",
        "session_id",
        "job_id",
        "job_type",
        "import_id",
        "email_type",
        "error_code",
        "attempt",
        "worker_id",
        "count",
    }
)

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

logger = logging.getLogger("contai.http")


def get_request_id() -> str | None:
    return _request_id.get()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = get_request_id()
        if request_id:
            payload["request_id"] = request_id
        for key in ALLOWED_FIELDS:
            if key in record.__dict__:
                payload[key] = record.__dict__[key]
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc_type"] = record.exc_info[0].__name__
            payload["stack"] = [
                f"{frame.filename}:{frame.lineno} in {frame.name}"
                for frame in traceback.extract_tb(record.exc_info[2])
            ]
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # O log de acesso do uvicorn traz a URL com a query; o middleware abaixo o substitui.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True


class RequestIdMiddleware:
    """Gera o id da requisição, devolve-o no cabeçalho e registra uma linha por requisição."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex
        token = _request_id.set(request_id)
        started = time.perf_counter()
        status = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.lower().encode(), request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            route = scope.get("route")
            logger.info(
                "request completed",
                extra={
                    "method": scope["method"],
                    # O modelo da rota, e não o caminho real, para não registrar a query.
                    "route": getattr(route, "path", None),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
            _request_id.reset(token)

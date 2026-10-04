"""Exceções de domínio e sua conversão, em um único ponto, em respostas HTTP padronizadas.

Formato da resposta de erro (contracts/rest-api.md):

    {"error": {"code": "...", "message": "...", "details": {...}}, "request_id": "..."}

As mensagens são em português do Brasil e dizem o que o usuário pode fazer.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_request_id

logger = logging.getLogger("contai.errors")


class DomainError(Exception):
    status_code = 400
    code = "bad_request"
    message = "Não foi possível concluir o pedido. Confira os dados e tente de novo."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message or self.message)
        if message is not None:
            self.message = message
        if code is not None:
            self.code = code
        self.details = details or {}
        self.headers = headers or {}


class NotFound(DomainError):
    status_code = 404
    code = "not_found"
    message = "Não encontramos o que você procura."


class Conflict(DomainError):
    status_code = 409
    code = "conflict"
    message = "Essa ação não pode ser feita agora. Atualize a página e tente de novo."


class ValidationFailed(DomainError):
    status_code = 422
    code = "validation_error"
    message = "Confira os campos destacados."


class Unauthenticated(DomainError):
    status_code = 401
    code = "unauthenticated"
    message = "Sua sessão expirou. Entre de novo para continuar."


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"
    message = "Você não tem acesso a isso."


class RateLimited(DomainError):
    status_code = 429
    code = "rate_limited"
    message = "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo."

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(
            details={"retry_after": retry_after_seconds},
            headers={"Retry-After": str(retry_after_seconds)},
        )


class PayloadTooLarge(DomainError):
    status_code = 413
    code = "payload_too_large"
    message = "O arquivo é grande demais. Envie um arquivo de até 10 MB."


class AiLimitReached(DomainError):
    status_code = 429
    code = "ai_limit_reached"
    message = "Você atingiu o limite de uso do assistente por hoje. Ele volta amanhã."


class AiQuotaExhausted(DomainError):
    """A cota do dia no serviço de IA acabou para o app inteiro, e não só para este usuário."""

    status_code = 429
    code = "ai_quota_exhausted"
    message = (
        "O limite de hoje do serviço de IA foi atingido. Ele volta a funcionar amanhã; o "
        "restante do Contaí continua funcionando normalmente."
    )


class AiUnavailable(DomainError):
    status_code = 503
    code = "ai_unavailable"
    message = "O assistente está indisponível no momento. Tente de novo em alguns minutos."


_HTTP_STATUS_ERRORS: dict[int, tuple[str, str]] = {
    401: (Unauthenticated.code, Unauthenticated.message),
    403: (Forbidden.code, Forbidden.message),
    404: (NotFound.code, NotFound.message),
    405: ("method_not_allowed", "Essa ação não está disponível."),
    413: (PayloadTooLarge.code, PayloadTooLarge.message),
}

INTERNAL_ERROR_MESSAGE = "Algo deu errado do nosso lado. Tente de novo em alguns instantes."
INVALID_FIELD_MESSAGE = "Valor inválido."


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code, "message": message, "details": details or {}},
            "request_id": get_request_id(),
        },
        headers=headers,
    )


async def _handle_domain_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DomainError)  # noqa: S101 - garantido pelo registro do handler
    return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101 - garantido pelo registro
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = [str(part) for part in error["loc"] if part not in ("body", "query", "path")]
        fields[".".join(location) or "body"] = INVALID_FIELD_MESSAGE
    return error_response(
        ValidationFailed.status_code,
        ValidationFailed.code,
        ValidationFailed.message,
        {"fields": fields},
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101 - garantido pelo registro
    code, message = _HTTP_STATUS_ERRORS.get(
        exc.status_code, (DomainError.code, DomainError.message)
    )
    return error_response(exc.status_code, code, message)


class UnexpectedErrorMiddleware:
    """Converte qualquer erro inesperado em uma resposta 500 padronizada e o registra.

    É um middleware, e não um handler de exceção, para que a resposta ainda passe pelos
    middlewares de id da requisição e de cabeçalhos de segurança.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("unexpected error")
            if response_started:
                raise
            response = error_response(500, "internal_error", INTERNAL_ERROR_MESSAGE)
            await response(scope, receive, send)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_domain_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)

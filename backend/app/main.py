"""Fábrica do app: middlewares, cabeçalhos de segurança, tratamento de erros e routers."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core import health
from app.core.config import Settings, get_settings
from app.core.database import get_engine
from app.core.errors import UnexpectedErrorMiddleware, register_error_handlers
from app.core.logging import RequestIdMiddleware, configure_logging
from app.core.rate_limit import register_rate_limiter
from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router

DOCS_PATHS = ("/api/docs", "/api/openapi.json")

# A API só devolve JSON: nada nela pode ser carregado, embutido ou executado por um navegador.
API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'"
HSTS_VALUE = "max-age=31536000; includeSubDomains"


class SecurityHeadersMiddleware:
    """Acrescenta os cabeçalhos de segurança a todas as respostas da API."""

    def __init__(self, app: ASGIApp, *, production: bool) -> None:
        self.app = app
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_docs = scope["path"].startswith(DOCS_PATHS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-content-type-options", b"nosniff"))
                headers.append((b"referrer-policy", b"no-referrer"))
                # A página de documentação carrega os próprios scripts; só existe fora de produção.
                if not is_docs:
                    headers.append(
                        (b"content-security-policy", API_CONTENT_SECURITY_POLICY.encode())
                    )
                if self.production:
                    headers.append((b"strict-transport-security", HSTS_VALUE.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await get_engine().dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()

    app = FastAPI(
        title="Contaí",
        # A documentação interativa fica disponível só fora de produção.
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
        lifespan=_lifespan,
    )

    # A ordem importa: o último middleware adicionado é o primeiro a receber a requisição.
    # De fora para dentro: cabeçalhos de segurança, id da requisição, CORS, erros inesperados.
    app.add_middleware(UnexpectedErrorMiddleware)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Contai-Client"],
        )
    app.add_middleware(SecurityHeadersMiddleware, production=settings.is_production)
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    register_rate_limiter(app)

    app.include_router(health.router)
    app.include_router(auth_router)
    app.include_router(users_router)
    return app


app = create_app()

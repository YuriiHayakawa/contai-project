"""Limite de frequência por IP e por usuário.

Os contadores ficam em memória: valem para a API em instância única e zeram quando ela
reinicia. O bloqueio por tentativas erradas de login, que precisa sobreviver a reinícios, não
fica aqui: fica no banco.
"""

import ipaddress
import math
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.core.errors import RateLimited, error_response
from app.core.proxy import PROXIED_CLIENT_IP

FORWARDED_FOR_HEADER = "x-forwarded-for"
DEFAULT_RETRY_AFTER_SECONDS = 60


# Redes de onde o proxy fala com a API: a própria máquina e as redes privadas do Docker.
_INTERNAL_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "::1/128",
        "fc00::/7",
    )
)


def _is_internal(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(address in network for network in _INTERNAL_NETWORKS)


def client_ip(request: Request) -> str:
    """IP do cliente.

    Em produção, vale o IP que a Vercel informou numa requisição com o segredo do proxy (ver
    `core/proxy.py`). Em desenvolvimento, o cabeçalho `X-Forwarded-For` só é aceito quando a
    conexão vem da rede interna, isto é, do Caddy. O Caddy acrescenta o IP real ao fim da lista,
    por isso vale a última entrada.
    """
    proxied: str | None = getattr(request.state, PROXIED_CLIENT_IP, None)
    if proxied:
        return proxied
    peer = request.client.host if request.client else ""
    forwarded = request.headers.get(FORWARDED_FOR_HEADER)
    if forwarded and _is_internal(peer):
        return forwarded.split(",")[-1].strip()
    return peer or "unknown"


def user_or_ip(request: Request) -> str:
    """Chave para rotas autenticadas: o usuário, quando conhecido; senão, o IP."""
    user_id = getattr(request.state, "user_id", None)
    return f"user:{user_id}" if user_id else client_ip(request)


limiter = Limiter(key_func=client_ip)


def _retry_after_seconds(request: Request) -> int:
    view_limit = getattr(request.state, "view_rate_limit", None)
    if view_limit is None:
        return DEFAULT_RETRY_AFTER_SECONDS
    item, keys = view_limit
    reset_at = limiter.limiter.get_window_stats(item, *keys).reset_time
    return max(1, math.ceil(reset_at - time.time()))


async def _handle_rate_limit(request: Request, exc: Exception) -> Response:
    error = RateLimited(_retry_after_seconds(request))
    response: JSONResponse = error_response(
        error.status_code, error.code, error.message, error.details, error.headers
    )
    return response


def register_rate_limiter(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _handle_rate_limit)

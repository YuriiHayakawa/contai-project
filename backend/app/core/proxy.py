"""Acesso só pelo proxy da Vercel: a API recusa o que chega direto ao Render.

A Vercel acrescenta a cada requisição que repassa um cabeçalho com um segredo compartilhado
(`frontend/vercel.json`). Uma requisição sem ele não passou pelo proxy e pode ter forjado os
cabeçalhos de IP: é recusada. O health check do Render chama a API direto e fica liberado; ele
não devolve dados.

Com o segredo, o IP do visitante é a primeira entrada do `X-Forwarded-For`. A Vercel substitui
esse cabeçalho pelo IP do visitante, descartando o que o cliente mandou, e a Cloudflare e o proxy
do Render só acrescentam entradas no fim. Na validação do deploy, os outros não serviram: o
`X-Vercel-Forwarded-For` deixou passar o valor do cliente em requisições POST, o `X-Real-IP` não
chega, e o `CF-Connecting-IP` e o `True-Client-IP` trazem o IP da própria Vercel.
"""

import hmac
import ipaddress

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import Forbidden, error_response

PROXY_SECRET_HEADER = "x-contai-proxy-secret"  # noqa: S105 - nome do cabeçalho, não é segredo
CLIENT_IP_HEADER = "x-forwarded-for"
# Chave em `request.state` com o IP do visitante informado pelo proxy.
PROXIED_CLIENT_IP = "proxied_client_ip"
UNPROXIED_PATHS = frozenset({"/api/v1/health", "/api/v1/health/worker"})


def _client_ip(value: str | None) -> str | None:
    """O IP do visitante: a primeira entrada da lista, se for um IP válido."""
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.split(",")[0].strip()))
    except ValueError:
        return None


class ProxySecretMiddleware:
    """Recusa as requisições sem o segredo do proxy e guarda o IP real das que o têm."""

    def __init__(self, app: ASGIApp, *, secret: str) -> None:
        self.app = app
        self.secret = secret.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in UNPROXIED_PATHS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        received = headers.get(PROXY_SECRET_HEADER, "").encode()
        if not hmac.compare_digest(received, self.secret):
            response = error_response(Forbidden.status_code, Forbidden.code, Forbidden.message)
            await response(scope, receive, send)
            return

        client_ip = _client_ip(headers.get(CLIENT_IP_HEADER))
        if client_ip:
            scope.setdefault("state", {})[PROXIED_CLIENT_IP] = client_ip
        await self.app(scope, receive, send)

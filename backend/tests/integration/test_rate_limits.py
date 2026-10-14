"""Limite de frequência nas rotas sensíveis (T214, FR-009).

Ao exceder o limite, a resposta é `429 rate_limited` com o cabeçalho `Retry-After`. Os limites
vêm das configurações; o teste manda uma requisição a mais que o limite padrão de cada rota.
"""

import uuid

from httpx import AsyncClient, Response


def _assert_rate_limited(response: Response) -> None:
    assert response.status_code == 429, response.status_code
    assert response.json()["error"]["code"] == "rate_limited"
    assert int(response.headers["retry-after"]) >= 1


async def test_login_is_rate_limited(client: AsyncClient) -> None:
    # rate_limit_login padrão: 10/minuto.
    last: Response | None = None
    for _ in range(11):
        last = await client.post(
            "/api/v1/auth/login", json={"email": "alguem@exemplo.test", "password": "senha-errada"}
        )
    assert last is not None
    _assert_rate_limited(last)


async def test_register_is_rate_limited(client: AsyncClient) -> None:
    # rate_limit_register padrão: 5/hora.
    body = {
        "name": "Pessoa",
        "email": "cadastro@exemplo.test",
        "password": "uma senha boa de teste",
        "accept_privacy_policy": True,
    }
    last: Response | None = None
    for _ in range(6):
        last = await client.post("/api/v1/auth/register", json=body)
    assert last is not None
    _assert_rate_limited(last)


async def test_resend_verification_is_rate_limited(client: AsyncClient) -> None:
    # rate_limit_email_requests padrão: 5/hora.
    last: Response | None = None
    for _ in range(6):
        last = await client.post(
            "/api/v1/auth/resend-verification", json={"email": "alguem@exemplo.test"}
        )
    assert last is not None
    _assert_rate_limited(last)


async def test_password_forgot_is_rate_limited(client: AsyncClient) -> None:
    last: Response | None = None
    for _ in range(6):
        last = await client.post(
            "/api/v1/auth/password/forgot", json={"email": "alguem@exemplo.test"}
        )
    assert last is not None
    _assert_rate_limited(last)


async def test_upload_is_rate_limited(client_a: AsyncClient) -> None:
    # rate_limit_upload padrão: 20/hora. O arquivo e a conta não precisam ser válidos: o limite
    # é conferido depois da autenticação e da leitura dos campos, antes do processamento.
    last: Response | None = None
    for _ in range(21):
        last = await client_a.post(
            "/api/v1/imports",
            files={"file": ("a.txt", b"x", "text/plain")},
            data={"account_id": str(uuid.uuid4())},
        )
    assert last is not None
    _assert_rate_limited(last)


async def test_assistant_is_rate_limited(client_a: AsyncClient) -> None:
    # rate_limit_assistant padrão: 10/minuto. A conversa não existe (404), mas conta para o limite.
    path = f"/api/v1/assistant/conversations/{uuid.uuid4()}/messages"
    last: Response | None = None
    for _ in range(11):
        last = await client_a.post(path, json={"content": "oi"})
    assert last is not None
    _assert_rate_limited(last)

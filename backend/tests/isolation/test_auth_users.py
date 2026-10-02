"""Isolamento das rotas autenticadas de auth e de usuários.

Estas rotas não recebem id nenhum: agem sobre o usuário e a sessão do próprio token. Os casos
conferem que o token de um usuário nunca alcança o perfil nem a sessão de outro.
"""

from tests.isolation.registry import IsolationContext, isolation_case


@isolation_case("GET", "/api/v1/users/me")
async def profile_is_always_the_callers_own(context: IsolationContext) -> None:
    seen_by_b = await context.client_b.get("/api/v1/users/me")

    assert seen_by_b.status_code == 200
    assert seen_by_b.json()["email"] == context.user_b.email
    assert context.user_a.email not in seen_by_b.text
    assert context.user_a.name not in seen_by_b.text


@isolation_case("POST", "/api/v1/auth/logout")
async def logout_ends_only_the_callers_session(context: IsolationContext) -> None:
    logout_of_b = await context.client_b.post("/api/v1/auth/logout")

    assert logout_of_b.status_code == 204
    assert (await context.client_b.get("/api/v1/users/me")).status_code == 401
    # A sessão do usuário A continua valendo.
    assert (await context.client_a.get("/api/v1/users/me")).status_code == 200

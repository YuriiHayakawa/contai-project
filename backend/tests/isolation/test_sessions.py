"""Isolamento das rotas de sessões (dispositivos conectados, FR-014).

Listar e encerrar sessões vale só para as do próprio token; o id de uma sessão de outro usuário
não é alcançável.
"""

from tests.isolation.registry import IsolationContext, exempt, isolation_case

exempt("GET", "/api/v1/users/me/sessions", "lista só as sessões do próprio usuário")
exempt("DELETE", "/api/v1/users/me/sessions", "encerra só as outras sessões do próprio usuário")


@isolation_case("DELETE", "/api/v1/users/me/sessions/{session_id}")
async def cannot_end_another_users_session(context: IsolationContext) -> None:
    sessions_of_a = (await context.client_a.get("/api/v1/users/me/sessions")).json()
    session_id_of_a = sessions_of_a[0]["id"]

    ended_by_b = await context.client_b.delete(f"/api/v1/users/me/sessions/{session_id_of_a}")

    assert ended_by_b.status_code == 404
    # A sessão de A continua valendo.
    assert (await context.client_a.get("/api/v1/users/me")).status_code == 200

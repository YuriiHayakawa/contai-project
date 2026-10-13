"""Isolamento das rotas autenticadas de auth e de usuários.

Estas rotas não recebem id nenhum: agem sobre o usuário e a sessão do próprio token. Os casos
conferem que o token de um usuário nunca alcança o perfil nem a sessão de outro.
"""

from tests.isolation.registry import IsolationContext, exempt, isolation_case

# Rotas que agem só sobre a conta do próprio token: não recebem id de outro usuário para
# alcançar. As sessões ficam em test_sessions.py.
exempt("PATCH", "/api/v1/users/me", "altera o nome do próprio usuário do token")
exempt("POST", "/api/v1/users/me/password", "troca a senha do próprio usuário do token")
exempt("POST", "/api/v1/users/me/2fa/setup", "configura a verificação do próprio usuário")
exempt("POST", "/api/v1/users/me/2fa/enable", "ativa a verificação do próprio usuário")
exempt("POST", "/api/v1/users/me/2fa/disable", "desativa a verificação do próprio usuário")
exempt(
    "POST",
    "/api/v1/users/me/2fa/recovery-codes",
    "gera códigos de recuperação do próprio usuário",
)


@isolation_case("GET", "/api/v1/users/me")
async def profile_is_always_the_callers_own(context: IsolationContext) -> None:
    seen_by_b = await context.client_b.get("/api/v1/users/me")

    assert seen_by_b.status_code == 200
    assert seen_by_b.json()["email"] == context.user_b.email
    assert context.user_a.email not in seen_by_b.text
    assert context.user_a.name not in seen_by_b.text


@isolation_case("POST", "/api/v1/users/me/consents/ai-documents")
async def consent_is_recorded_only_for_the_caller(context: IsolationContext) -> None:
    accepted_by_b = await context.client_b.post("/api/v1/users/me/consents/ai-documents")

    assert accepted_by_b.status_code == 204
    assert (await context.client_b.get("/api/v1/users/me")).json()["ai_documents_consent"] is True
    # O aceite de B não vale para A.
    assert (await context.client_a.get("/api/v1/users/me")).json()["ai_documents_consent"] is False


@isolation_case("POST", "/api/v1/auth/logout")
async def logout_ends_only_the_callers_session(context: IsolationContext) -> None:
    logout_of_b = await context.client_b.post("/api/v1/auth/logout")

    assert logout_of_b.status_code == 204
    assert (await context.client_b.get("/api/v1/users/me")).status_code == 401
    # A sessão do usuário A continua valendo.
    assert (await context.client_a.get("/api/v1/users/me")).status_code == 200

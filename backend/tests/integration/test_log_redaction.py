"""Os logs nunca carregam dados sensíveis (T213, FR observabilidade).

O formato de log é uma lista do que PODE ser registrado (`ALLOWED_FIELDS`): senha, token,
descrição, valor e conteúdo de documento nunca saem. Este teste exercita rotas com esses dados
no corpo e confere que nenhum deles aparece na saída de log.
"""

import io
import logging

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.logging import JsonFormatter
from app.modules.accounts.models import AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import CategoryColor, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.users.models import User
from tests.conftest import TEST_PASSWORD

SECRET_DESCRIPTION = "padaria secreta do teste xyz"
SECRET_NOTES = "anotacao confidencial do teste 123"
SECRET_AMOUNT = "7654321"


async def test_logs_never_carry_sensitive_data(
    client: AsyncClient,
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    frozen_time: object,
) -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        login = await client.post(
            "/api/v1/auth/login", json={"email": user_a.email, "password": TEST_PASSWORD}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]

        account = await AccountRepository(session).create(
            user_a.id,
            name="Conta",
            account_type=AccountType.CHECKING,
            institution=None,
            initial_balance_cents=0,
            initial_balance_date=clock.today(),
            closing_day=None,
            due_day=None,
        )
        category = await CategoryRepository(session).create(
            user_a.id,
            name="Mercado",
            kind=CategoryKind.EXPENSE,
            parent_id=None,
            icon="cart",
            color=CategoryColor.PISCINA,
        )
        created = await client_a.post(
            "/api/v1/transactions",
            json={
                "type": "expense",
                "amount_cents": int(SECRET_AMOUNT),
                "date": clock.today().isoformat(),
                "description": SECRET_DESCRIPTION,
                "account_id": str(account.id),
                "category_id": str(category.id),
                "notes": SECRET_NOTES,
            },
        )
        assert created.status_code in (200, 201)
    finally:
        root.removeHandler(handler)

    logs = stream.getvalue()
    # A redação não é só silêncio: as requisições foram, sim, registradas.
    assert "request completed" in logs
    for secret in (TEST_PASSWORD, token, SECRET_DESCRIPTION, SECRET_NOTES, SECRET_AMOUNT):
        assert secret not in logs

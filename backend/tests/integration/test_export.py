"""Exportação dos dados da conta (T204, FR-016).

O ZIP traz perfil, contas, categorias, lançamentos, importações, regras e conversas do próprio
usuário, e nada de outro usuário.
"""

import io
import zipfile
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.assistant.models import MessageKind, MessageRole
from app.modules.assistant.repository import AssistantRepository
from app.modules.categories.models import CategoryColor, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.transactions.models import TransactionType
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.models import User

EXPORT = "/api/v1/users/me/export"

EXPECTED_FILES = {
    "README.txt",
    "perfil.json",
    "contas.csv",
    "categorias.csv",
    "lancamentos.csv",
    "importacoes.csv",
    "regras-de-categoria.csv",
    "conversas.json",
}


async def _seed(session: AsyncSession, user: User, *, marker: str, when: datetime) -> None:
    """Cria uma conta, uma categoria, um lançamento e uma conversa, todos com `marker`."""
    accounts = AccountRepository(session)
    categories = CategoryRepository(session)
    transactions = TransactionRepository(session)
    assistant = AssistantRepository(session)

    account = await accounts.create(
        user.id,
        name=f"Conta {marker}",
        account_type=AccountType.CHECKING,
        institution=None,
        initial_balance_cents=10000,
        initial_balance_date=when.date(),
        closing_day=None,
        due_day=None,
    )
    category = await categories.create(
        user.id,
        name=f"Categoria {marker}",
        kind=CategoryKind.EXPENSE,
        parent_id=None,
        icon="cart",
        color=CategoryColor.PISCINA,
    )
    await transactions.create(
        user.id,
        account_id=account.id,
        transaction_type=TransactionType.EXPENSE,
        amount_cents=2550,
        date=when.date(),
        description=f"Lançamento {marker}",
        description_normalized=f"lancamento {marker}".lower(),
        fingerprint=marker,
        created_at=when,
        category_id=category.id,
    )
    conversation = await assistant.create_conversation(user.id, now=when)
    conversation.title = f"Conversa {marker}"
    await assistant.add_message(
        user.id,
        conversation.id,
        position=0,
        role=MessageRole.USER,
        kind=MessageKind.TEXT,
        content=f"Mensagem {marker}",
        now=when,
    )


def _open_zip(content: bytes) -> dict[str, str]:
    archive = zipfile.ZipFile(io.BytesIO(content))
    return {name: archive.read(name).decode("utf-8") for name in archive.namelist()}


async def test_export_has_every_section(
    client_a: AsyncClient, session: AsyncSession, user_a: User, frozen_time: datetime
) -> None:
    await _seed(session, user_a, marker="AAA", when=frozen_time)

    response = await client_a.get(EXPORT)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]

    files = _open_zip(response.content)
    assert set(files) == EXPECTED_FILES

    assert user_a.email in files["perfil.json"]
    assert "Conta AAA" in files["contas.csv"]
    assert "Categoria AAA" in files["categorias.csv"]
    assert "Lançamento AAA" in files["lancamentos.csv"]
    # O valor sai em reais, com o ponto separando os centavos.
    assert "25.50" in files["lancamentos.csv"]
    assert "Conversa AAA" in files["conversas.json"]
    assert "Mensagem AAA" in files["conversas.json"]


async def test_export_only_includes_the_requesting_user(
    client_a: AsyncClient,
    session: AsyncSession,
    user_a: User,
    user_b: User,
    frozen_time: datetime,
) -> None:
    await _seed(session, user_a, marker="MINE", when=frozen_time)
    await _seed(session, user_b, marker="ALHEIO", when=frozen_time)

    response = await client_a.get(EXPORT)
    assert response.status_code == 200

    everything = "\n".join(_open_zip(response.content).values())
    assert "MINE" in everything
    assert "ALHEIO" not in everything
    assert user_b.email not in everything

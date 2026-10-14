"""Dados de demonstração para desenvolvimento local (T221).

Gera um usuário de demonstração com 4 contas e 5.000 lançamentos fictícios ao longo de 24 meses,
pelas camadas dos módulos (repositórios e serviços), sem SQL avulso. Serve para conferir o
desempenho do painel e da lista (SC-013) e para ter um ambiente cheio ao desenvolver.

NUNCA roda em produção: recusa-se a executar com `ENVIRONMENT=production`. Rode à mão, uma vez:

    docker compose run --rm api python -m scripts.seed_demo

A pasta `scripts/` não entra na imagem de produção (`backend/.dockerignore`), e nada automático
(entrypoint, worker, deploy) o chama.
"""

import asyncio
import random
import uuid
from datetime import timedelta

import app.main  # noqa: F401 - registra todos os modelos no metadata (FKs entre tabelas)
from app.core import clock
from app.core.config import get_settings
from app.core.database import session_scope
from app.core.security import hash_password
from app.modules.accounts.models import AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.models import CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categories.service import CategoryService
from app.modules.transactions.models import TransactionType
from app.modules.transactions.repository import TransactionRepository
from app.modules.users.repository import UserRepository

DEMO_EMAIL = "demo@contai.local"
DEMO_PASSWORD = "conta demonstracao 2026"  # noqa: S105 - senha de demonstração local
TRANSACTION_COUNT = 5000
MONTHS_BACK = 24

DESCRIPTIONS = [
    "Mercado",
    "Padaria",
    "Farmácia",
    "Restaurante",
    "Posto de combustível",
    "Assinatura de streaming",
    "Conta de luz",
    "Conta de água",
    "Internet",
    "Transporte por aplicativo",
    "Salário",
    "Freelancer",
    "Presente recebido",
]


class SeedRefusedInProduction(RuntimeError):
    """O seed de demonstração não pode rodar em produção."""


def ensure_not_production() -> None:
    """Barra a execução em produção; é o guardião coberto por `tests/unit/test_seed_guard.py`."""
    if get_settings().is_production:
        raise SeedRefusedInProduction(
            "O seed de demonstração não roda em produção (ENVIRONMENT=production)."
        )


async def seed() -> None:
    rng = random.Random(42)  # noqa: S311 - dados fictícios de demonstração, não é uso criptográfico
    today = clock.today()

    async with session_scope() as session:
        users = UserRepository(session)
        if await users.get_by_email(DEMO_EMAIL) is not None:
            print(f"O usuário de demonstração já existe ({DEMO_EMAIL}). Nada a fazer.")
            return

        user = await users.create(
            name="Pessoa Demonstração",
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            privacy_policy_version="1",
            privacy_policy_accepted_at=clock.utcnow(),
        )
        user.email_verified_at = clock.utcnow()
        await CategoryService(session).create_defaults(user.id)

        accounts_repo = AccountRepository(session)
        accounts = []
        for name, account_type in (
            ("Conta Corrente", AccountType.CHECKING),
            ("Poupança", AccountType.SAVINGS),
            ("Carteira", AccountType.CASH),
            ("Cartão Nubank", AccountType.CREDIT_CARD),
        ):
            is_card = account_type == AccountType.CREDIT_CARD
            accounts.append(
                await accounts_repo.create(
                    user.id,
                    name=name,
                    account_type=account_type,
                    institution=None,
                    # O saldo inicial de um cartão é dívida (nunca positivo).
                    initial_balance_cents=0 if is_card else rng.randint(0, 500000),
                    initial_balance_date=clock.add_months(today, -MONTHS_BACK),
                    closing_day=10 if is_card else None,
                    due_day=20 if is_card else None,
                    credit_limit_cents=1000000 if is_card else None,
                )
            )

        categories = await CategoryRepository(session).list_all(user.id)
        expense_categories = [c for c in categories if c.kind == CategoryKind.EXPENSE]
        income_categories = [c for c in categories if c.kind == CategoryKind.INCOME]

        transactions = TransactionRepository(session)
        now = clock.utcnow()
        for index in range(TRANSACTION_COUNT):
            is_income = rng.random() < 0.15
            kind = TransactionType.INCOME if is_income else TransactionType.EXPENSE
            category = rng.choice(income_categories if is_income else expense_categories)
            days_ago = rng.randint(0, MONTHS_BACK * 30)
            amount = rng.randint(500, 800000) if is_income else rng.randint(300, 40000)
            await transactions.create(
                user.id,
                account_id=rng.choice(accounts).id,
                transaction_type=kind,
                amount_cents=amount,
                date=today - timedelta(days=days_ago),
                description=rng.choice(DESCRIPTIONS),
                description_normalized=rng.choice(DESCRIPTIONS).lower(),
                fingerprint=uuid.uuid4().hex,
                created_at=now,
                category_id=category.id,
            )
            if (index + 1) % 1000 == 0:
                print(f"  {index + 1}/{TRANSACTION_COUNT} lançamentos…")

    print("Pronto.")
    print(f"E-mail: {DEMO_EMAIL}")
    print(f"Senha : {DEMO_PASSWORD}")


async def main() -> None:
    ensure_not_production()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())

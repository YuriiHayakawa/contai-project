"""Base dos testes.

Os testes de integração usam um PostgreSQL real (banco de `TEST_DATABASE_URL`), com o esquema
criado pelas migrações. Cada teste roda dentro de uma transação que é desfeita ao final.
"""

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path

# As configurações precisam existir antes de qualquer import da aplicação.
_DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://contai:contai_dev@127.0.0.1:5433/contai_test"
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _DEFAULT_TEST_DATABASE_URL
if not TEST_DATABASE_URL.rsplit("/", 1)[-1].endswith("_test"):
    raise RuntimeError("TEST_DATABASE_URL precisa apontar para um banco terminado em _test")

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["ENVIRONMENT"] = "development"
# A IA dos testes não depende do `.env` de quem os roda: provedor simulado, sem chave, sem
# modelo reserva e com os limites diários padrão.
os.environ["AI_PROVIDER"] = "fake"
for _name in (
    "AI_API_KEY",
    "AI_MODEL_CHAT",
    "AI_MODEL_EXTRACTION",
    "AI_MODEL_CHAT_FALLBACK",
    "AI_MODEL_EXTRACTION_FALLBACK",
):
    os.environ[_name] = ""
os.environ["AI_DAILY_QUESTION_LIMIT"] = "30"
os.environ["AI_DAILY_EXTRACTION_LIMIT"] = "10"
os.environ.setdefault("APP_ORIGIN", "http://localhost:8080")
os.environ["JWT_SECRET"] = "segredo-apenas-para-testes-com-mais-de-32-caracteres"
os.environ.setdefault("TOTP_ENCRYPTION_KEY", "")
os.environ.setdefault("SMTP_HOST", "smtp.test")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_USE_TLS", "false")
os.environ.setdefault("EMAIL_FROM", "Contaí <nao-responda@contai.test>")
# Nenhum teste grava no volume de uploads de verdade.
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="contai-test-uploads-")

import pytest  # noqa: E402 - depende das variáveis acima
import pytest_asyncio  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from app.core import clock  # noqa: E402
from app.core.database import SessionFactory  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent
FROZEN_NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)  # meio-dia em Brasília


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    # Mantém o log configurado pelo app: o do alembic.ini poria a raiz em WARNING, e os testes
    # que leem o log passariam a depender da ordem em que rodam.
    config.attributes["configure_logger"] = False
    return config


async def _reset_schema() -> None:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


@pytest.fixture(scope="session")
def database_schema() -> None:
    """Recria o esquema do banco de testes com as migrações, uma vez por execução."""
    asyncio.run(_reset_schema())
    command.upgrade(alembic_config(), "head")


@pytest_asyncio.fixture(scope="session")
async def engine(database_schema: None) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """Conexão com uma transação aberta, desfeita ao fim do teste."""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


@pytest.fixture
def session_factory(connection: AsyncConnection) -> SessionFactory:
    """Fábrica de sessões presas à transação do teste.

    Um `commit` do código testado só fecha um savepoint; nada sai da transação do teste.
    """

    @asynccontextmanager
    async def factory() -> AsyncIterator[AsyncSession]:
        session = AsyncSession(
            bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
        finally:
            await session.close()

    return factory


@pytest_asyncio.fixture
async def session(session_factory: SessionFactory) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest.fixture
def frozen_time() -> Iterator[datetime]:
    """Fixa o relógio da aplicação; o teste pode movê-lo com `clock.set_fixed_time`."""
    clock.set_fixed_time(FROZEN_NOW)
    yield FROZEN_NOW
    clock.set_fixed_time(None)


class FakeSMTP:
    """Substituto de `smtplib.SMTP` que captura as mensagens em vez de enviá-las."""

    outbox: list[EmailMessage] = []  # noqa: RUF012 - estado de classe, zerado pela fixture
    fail_next: int = 0

    def __init__(self, host: str, port: int, timeout: float | None = None) -> None:
        self.host = host
        self.port = port

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def starttls(self, context: object | None = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        return None

    def send_message(self, message: EmailMessage) -> None:
        if FakeSMTP.fail_next > 0:
            FakeSMTP.fail_next -= 1
            raise OSError("smtp indisponível (simulado)")
        FakeSMTP.outbox.append(message)


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch) -> Iterator[type[FakeSMTP]]:
    """Servidor SMTP falso: as mensagens enviadas ficam em `smtp.outbox`."""
    FakeSMTP.outbox = []
    FakeSMTP.fail_next = 0
    monkeypatch.setattr("smtplib.SMTP", FakeSMTP)
    yield FakeSMTP
    FakeSMTP.outbox = []
    FakeSMTP.fail_next = 0


# ---------------------------------------------------------------------------
# Segunda parte: cliente HTTP, usuários, autenticação, IA falsa e e-mails
# ---------------------------------------------------------------------------

import re  # noqa: E402
import uuid  # noqa: E402
from collections.abc import Awaitable, Callable  # noqa: E402
from datetime import timedelta  # noqa: E402
from urllib.parse import parse_qs, urlparse  # noqa: E402

from httpx import ASGITransport, AsyncClient, Response  # noqa: E402

from app.ai import factory as ai_factory  # noqa: E402
from app.ai.fake import FakeLLMProvider  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.database import get_session  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.core.security import (  # noqa: E402
    create_access_token,
    hash_password,
    hash_token,
    new_token,
)
from app.main import app  # noqa: E402
from app.modules.auth.repository import AuthRepository  # noqa: E402
from app.modules.users.models import User, UserStatus  # noqa: E402
from app.modules.users.repository import UserRepository  # noqa: E402
from app.worker.main import build_worker  # noqa: E402

TEST_PASSWORD = "uma frase só de teste"
# HTTPS, como em produção: o cookie de refresh é `Secure` e só volta em conexão segura.
TEST_BASE_URL = "https://test"
_LINK_PATTERN = re.compile(r"https?://\S+")

UserFactory = Callable[..., Awaitable[User]]
ClientFactory = Callable[[User], Awaitable[AsyncClient]]


@pytest.fixture(scope="session")
def password_hash() -> str:
    """O hash Argon2 é caro de propósito; os testes calculam um só."""
    return hash_password(TEST_PASSWORD)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    limiter.reset()


@pytest_asyncio.fixture
async def client(session_factory: SessionFactory) -> AsyncIterator[AsyncClient]:
    """Cliente HTTP contra o app, com as sessões presas à transação do teste."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL) as client:
        yield client
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def make_user(session: AsyncSession, password_hash: str) -> UserFactory:
    """Cria usuários; por padrão, com o e-mail confirmado e a senha `TEST_PASSWORD`."""

    async def factory(
        *,
        email: str | None = None,
        name: str = "Pessoa de Teste",
        verified: bool = True,
        status: UserStatus = UserStatus.ACTIVE,
    ) -> User:
        user = await UserRepository(session).create(
            name=name,
            email=email or f"{uuid.uuid4().hex[:12]}@exemplo.test",
            password_hash=password_hash,
            privacy_policy_version="1",
            privacy_policy_accepted_at=clock.utcnow(),
        )
        if verified:
            user.email_verified_at = clock.utcnow()
        user.status = status
        await session.flush()
        return user

    return factory


@pytest_asyncio.fixture
async def client_for(
    session: AsyncSession, session_factory: SessionFactory
) -> AsyncIterator[ClientFactory]:
    """Devolve um cliente HTTP já autenticado como o usuário informado."""
    clients: list[AsyncClient] = []

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as request_session:
            yield request_session

    app.dependency_overrides[get_session] = override_get_session

    async def factory(user: User) -> AsyncClient:
        now = clock.utcnow()
        auth_session = await AuthRepository(session).create_session(
            user_id=user.id,
            refresh_token_hash=hash_token(new_token()),
            user_agent="pytest",
            ip="127.0.0.1",
            now=now,
            expires_at=now + timedelta(days=30),
        )
        token = create_access_token(user.id, auth_session.id)
        authenticated = AsyncClient(
            transport=ASGITransport(app=app),
            base_url=TEST_BASE_URL,
            headers={"Authorization": f"Bearer {token}"},
        )
        clients.append(authenticated)
        return authenticated

    yield factory
    for authenticated in clients:
        await authenticated.aclose()
    app.dependency_overrides.pop(get_session, None)


@pytest_asyncio.fixture
async def user_a(make_user: UserFactory) -> User:
    return await make_user(email="ana@exemplo.test", name="Ana")


@pytest_asyncio.fixture
async def user_b(make_user: UserFactory) -> User:
    return await make_user(email="bruno@exemplo.test", name="Bruno")


@pytest_asyncio.fixture
async def client_a(client_for: ClientFactory, user_a: User) -> AsyncClient:
    return await client_for(user_a)


@pytest_asyncio.fixture
async def client_b(client_for: ClientFactory, user_b: User) -> AsyncClient:
    return await client_for(user_b)


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> FakeLLMProvider:
    """Provedor de IA falso no lugar do real; nenhum teste acessa a rede."""
    provider = FakeLLMProvider()
    monkeypatch.setattr(ai_factory, "get_provider", lambda: provider)
    return provider


def extract_link(message: EmailMessage) -> str:
    """O primeiro link do corpo de um e-mail capturado."""
    match = _LINK_PATTERN.search(message.get_content())
    if match is None:
        raise AssertionError("o e-mail não tem link")
    return match.group(0)


def extract_token(message: EmailMessage) -> str:
    """O token do link de um e-mail capturado."""
    [token] = parse_qs(urlparse(extract_link(message)).query)["token"]
    return token


def refresh_headers() -> dict[str, str]:
    """O que o frontend envia no refresh: o cabeçalho próprio e a origem do app."""
    return {"X-Contai-Client": "web", "Origin": get_settings().app_origin}


def without_request_id(response: Response) -> dict[str, object]:
    """Corpo de uma resposta sem o id da requisição, para comparar duas respostas."""
    body: dict[str, object] = response.json()
    body.pop("request_id", None)
    return body


@pytest.fixture
def upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Pasta de uploads só deste teste, para conferir o que ficou guardado nela."""
    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    return tmp_path


JobRunner = Callable[[], Awaitable[int]]


@pytest.fixture
def run_jobs(session_factory: SessionFactory) -> JobRunner:
    """Executa os jobs pendentes, como o worker faria, e devolve quantos rodaram."""

    async def run() -> int:
        worker = build_worker(session_factory)
        count = 0
        while await worker.process_next_job():
            count += 1
        return count

    return run


EmailDelivery = Callable[[], Awaitable[list[EmailMessage]]]


@pytest.fixture
def deliver_emails(session_factory: SessionFactory, smtp: type[FakeSMTP]) -> EmailDelivery:
    """Executa os jobs pendentes contra o SMTP falso e devolve os e-mails enviados.

    O token de um link é gerado dentro do job; é assim que os testes obtêm o link.
    """

    async def deliver() -> list[EmailMessage]:
        already_sent = len(smtp.outbox)
        worker = build_worker(session_factory)
        while await worker.process_next_job():
            pass
        return smtp.outbox[already_sent:]

    return deliver

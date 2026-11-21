"""Lançamento por voz pela Siri (feature 002, US3; research, seções 1 e 7).

Uma frase gera no máximo um lançamento. A IA só diz o que entendeu (`parse_voice_entry`); o
backend converte o valor, resolve a data no fuso de Brasília, procura a conta e a categoria e
monta a fala. As regras da voz são mais rígidas que as do lançamento por texto: sem a
conferência do usuário, qualquer dúvida não grava nada.

O prazo (`deadline`) vem da função da Vercel: a Siri desiste em cerca de 10 s, e a função
responde "acordando" em 8 s. A API confere o prazo antes de chamar a IA e de novo antes de
gravar. Uma frase que chega tarde, como quando o servidor estava dormindo, é descartada sem
lançar nada; o usuário repete, e só um lançamento existe (FR-025).
"""

import datetime as dt
import logging
import time
import uuid
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from pathlib import Path
from typing import Literal

from limits import parse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import fallback as ai_calls
from app.ai import usage as ai_usage
from app.ai.models import AiTask
from app.ai.provider import LLMError, LLMQuotaExhausted, LLMUsage
from app.ai.usage import LimitKind
from app.core import clock
from app.core.errors import AiLimitReached
from app.core.rate_limit import limiter
from app.modules.accounts.models import Account
from app.modules.accounts.repository import AccountRepository
from app.modules.assistant import voice_speech as speech
from app.modules.assistant.tools.base import ToolError
from app.modules.assistant.tools.propose import (
    accounts_for_hint,
    amount_cents,
    category_by_hint,
    resolve_date,
)
from app.modules.auth.personal_tokens import AuthenticatedToken
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.service import CategorizationService, Line
from app.modules.transactions.models import TransactionSource, TransactionType
from app.modules.transactions.normalize import fingerprint, normalize_description
from app.modules.transactions.repository import TransactionRepository

logger = logging.getLogger("contai.voice")

PROMPT_FILE = Path(__file__).parent / "prompts" / "voice_entry.md"
MAX_PHRASE_LENGTH = 300
# Sem o cabeçalho do prazo, a frase tem 5,5 s a partir da chegada (research, seção 1).
DEFAULT_BUDGET = dt.timedelta(milliseconds=5500)
# Com menos que isso até o prazo, a IA não teria tempo de responder: nem chama.
MIN_TIME_FOR_AI = dt.timedelta(milliseconds=1500)
# 20 frases por hora por token, no mesmo armazenamento do limitador da API.
HOURLY_LIMIT = parse("20/hour")
# Uso registrado quando a IA não foi chamada ou não respondeu: a chamada conta mesmo assim.
NO_MODEL = "none"
DEFAULT_DESCRIPTIONS = {
    CategoryKind.EXPENSE: "Gasto por voz",
    CategoryKind.INCOME: "Entrada por voz",
}


class VoiceOutcome(StrEnum):
    SAVED = "saved"
    REPEAT = "repeat"
    UNSUPPORTED = "unsupported"
    LIMIT = "limit"
    UNAVAILABLE = "unavailable"
    DEADLINE = "deadline"
    UNAUTHORIZED = "unauthorized"


STATUS_BY_OUTCOME = {
    VoiceOutcome.SAVED: 201,
    VoiceOutcome.REPEAT: 422,
    VoiceOutcome.UNSUPPORTED: 422,
    VoiceOutcome.LIMIT: 429,
    VoiceOutcome.UNAVAILABLE: 503,
    VoiceOutcome.DEADLINE: 503,
    VoiceOutcome.UNAUTHORIZED: 401,
}


@dataclass(frozen=True)
class VoiceResult:
    outcome: VoiceOutcome
    speech: str
    transaction_id: uuid.UUID | None = None


class VoiceEntryParams(BaseModel):
    """`parse_voice_entry`: o que a IA entendeu da frase, sem nada calculado."""

    model_config = ConfigDict(extra="forbid")

    intent: Literal["entry", "multiple", "transfer", "installments", "question", "other"] = Field(
        description="O que a frase é: um lançamento, vários, transferência, parcelado, pergunta."
    )
    type: Literal["expense", "income"] = Field(
        default="expense",
        description="expense: gasto, compra ou pagamento; income: dinheiro recebido.",
    )
    amount: str | None = Field(
        default=None,
        max_length=30,
        description='O valor como foi dito, em algarismos: "45" ou "45,90". Sem valor, vazio.',
    )
    date_reference: str = Field(
        default="today",
        max_length=10,
        description="today, yesterday ou a data dita, AAAA-MM-DD. Sem data, today.",
    )
    description: str | None = Field(
        default=None, max_length=200, description="O que foi, em poucas palavras."
    )
    account_hint: str | None = Field(
        default=None, max_length=60, description="A conta como foi dita. Sem conta, vazio."
    )
    category_hint: str | None = Field(
        default=None, max_length=130, description="O assunto, em uma ou duas palavras."
    )


@cache
def voice_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


class _Rejected(Exception):
    def __init__(self, outcome: VoiceOutcome, message: str) -> None:
        super().__init__(message)
        self.result = VoiceResult(outcome, message)


def _repeat(message: str) -> _Rejected:
    return _Rejected(VoiceOutcome.REPEAT, message)


_UNSUPPORTED = {
    "multiple": speech.MULTIPLE_ENTRIES,
    "transfer": speech.TRANSFER_OR_INSTALLMENTS,
    "installments": speech.TRANSFER_OR_INSTALLMENTS,
    "question": speech.QUESTION,
    "other": speech.QUESTION,
}


def deadline_from_header(value: str | None, arrival: dt.datetime) -> dt.datetime:
    """O prazo absoluto do cabeçalho `X-Contai-Deadline` (milissegundos Unix), ou o padrão."""
    if value and value.strip().isdigit():
        return dt.datetime.fromtimestamp(int(value.strip()) / 1000, tz=dt.UTC)
    return arrival + DEFAULT_BUDGET


class VoiceEntryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._accounts = AccountRepository(session)
        self._categories = CategoryRepository(session)
        self._transactions = TransactionRepository(session)

    async def enter(
        self, token: AuthenticatedToken, phrase: str, deadline: dt.datetime
    ) -> VoiceResult:
        started = time.monotonic()
        result = await self._enter(token, " ".join(phrase.split()), deadline)
        # Só o resultado, a duração e o id do token: a frase e o token nunca vão para o log.
        logger.info(
            "voice entry",
            extra={
                "outcome": str(result.outcome),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "token_id": str(token.token_id),
            },
        )
        return result

    async def _enter(
        self, token: AuthenticatedToken, phrase: str, deadline: dt.datetime
    ) -> VoiceResult:
        if not phrase:
            return VoiceResult(VoiceOutcome.REPEAT, speech.EMPTY_PHRASE)
        if len(phrase) > MAX_PHRASE_LENGTH:
            return VoiceResult(VoiceOutcome.REPEAT, speech.PHRASE_TOO_LONG)
        if not limiter.limiter.hit(HOURLY_LIMIT, "voice", str(token.token_id)):
            return VoiceResult(VoiceOutcome.LIMIT, speech.HOURLY_LIMIT)
        try:
            await ai_usage.check_limit(self._session, token.user_id, LimitKind.QUESTION)
        except AiLimitReached:
            return VoiceResult(VoiceOutcome.LIMIT, speech.DAILY_LIMIT)

        # Daqui em diante, a chamada conta na cota, mesmo sem chamar a IA (Princípio XV).
        if deadline - clock.utcnow() < MIN_TIME_FOR_AI:
            await self._record(token, NO_MODEL, LLMUsage())
            return VoiceResult(VoiceOutcome.DEADLINE, speech.WAKING)
        try:
            answer = await ai_calls.generate_structured(
                ai_calls.chat_models(),
                system=voice_prompt(),
                prompt=f"<frase>\n{phrase}\n</frase>",
                schema=VoiceEntryParams,
            )
        except LLMQuotaExhausted:
            await self._record(token, NO_MODEL, LLMUsage())
            return VoiceResult(VoiceOutcome.LIMIT, speech.DAILY_LIMIT)
        except LLMError as error:
            logger.warning("voice ai unavailable", extra={"error_code": type(error).__name__})
            await self._record(token, NO_MODEL, LLMUsage())
            return VoiceResult(VoiceOutcome.UNAVAILABLE, speech.UNAVAILABLE)
        await self._record(token, answer.model, answer.usage)

        try:
            return await self._save(token, phrase, answer.value, deadline)
        except _Rejected as rejected:
            return rejected.result

    async def _record(self, token: AuthenticatedToken, model: str, usage: LLMUsage) -> None:
        await ai_usage.record_usage(
            self._session,
            token.user_id,
            task=AiTask.VOICE_ENTRY,
            model=model,
            usage=usage,
            counts_toward_limit=True,
        )

    async def _save(
        self,
        token: AuthenticatedToken,
        phrase: str,
        parsed: VoiceEntryParams,
        deadline: dt.datetime,
    ) -> VoiceResult:
        if parsed.intent != "entry":
            raise _Rejected(VoiceOutcome.UNSUPPORTED, _UNSUPPORTED[parsed.intent])
        cents = self._amount(parsed.amount)
        date = self._date(parsed.date_reference)
        transaction_type = TransactionType(parsed.type)
        kind = CategoryKind(parsed.type)
        description = (
            " ".join((parsed.description or "").split())[:200] or DEFAULT_DESCRIPTIONS[kind]
        )
        account = await self._account(token, parsed.account_hint, description)
        category = await self._category(token.user_id, description, parsed.category_hint, kind)

        # Segunda conferência do prazo, imediatamente antes de gravar.
        if clock.utcnow() > deadline:
            return VoiceResult(VoiceOutcome.DEADLINE, speech.WAKING)
        normalized = normalize_description(description)
        transaction = await self._transactions.create(
            token.user_id,
            account_id=account.id,
            transaction_type=transaction_type,
            amount_cents=cents,
            date=date,
            description=description,
            description_normalized=normalized,
            fingerprint=fingerprint(
                account_id=account.id,
                date=date,
                transaction_type=transaction_type,
                amount_cents=cents,
                description_normalized=normalized,
            ),
            created_at=clock.utcnow(),
            category_id=category.id,
            source=TransactionSource.VOICE,
            voice_phrase=phrase,
        )
        await self._session.commit()
        message = (
            speech.saved_income(cents, category=category.name, account=account.name)
            if kind == CategoryKind.INCOME
            else speech.saved_expense(cents, category=category.name, account=account.name)
        )
        return VoiceResult(VoiceOutcome.SAVED, message, transaction.id)

    @staticmethod
    def _amount(amount: str | None) -> int:
        if amount is None or not amount.strip():
            raise _repeat(speech.AMOUNT_NOT_UNDERSTOOD)
        try:
            return amount_cents(amount)
        except ToolError as error:
            raise _repeat(speech.AMOUNT_NOT_UNDERSTOOD) from error

    @staticmethod
    def _date(reference: str) -> dt.date:
        today = clock.today()
        try:
            date = resolve_date(reference, today)
        except ToolError as error:
            raise _repeat(speech.DATE_NOT_UNDERSTOOD) from error
        if date > today:
            raise _repeat(speech.FUTURE_DATE)
        return date

    async def _account(
        self, token: AuthenticatedToken, hint: str | None, description: str
    ) -> Account:
        """A conta citada; sem conta na frase, a conta padrão do token. Qualquer dúvida para."""
        accounts = await self._accounts.list_all(token.user_id)
        hint_words = normalize_description(hint or "").split()
        if hint_words:
            candidates = accounts_for_hint(accounts, hint or "")
            if len(candidates) == 1:
                return candidates[0]
            if candidates:
                raise _repeat(speech.ACCOUNT_AMBIGUOUS)
            # O modelo às vezes toma a loja pela conta ("de um freela"): uma dica que só repete
            # a descrição não citou conta nenhuma. Qualquer outra conta citada e não achada para.
            if not set(hint_words) <= set(normalize_description(description).split()):
                raise _repeat(speech.ACCOUNT_NOT_FOUND)
        default = next((a for a in accounts if a.id == token.default_account_id), None)
        if default is None:
            raise _repeat(speech.NO_ACCOUNT)
        return default

    async def _category(
        self, user_id: uuid.UUID, description: str, hint: str | None, kind: CategoryKind
    ) -> Category:
        """Primeiro a regra que o usuário já ensinou, depois a dica da IA, depois "Outros"."""
        categories = [
            category
            for category in await self._categories.list_all(user_id)
            if category.archived_at is None
        ]
        by_id = {category.id: category for category in categories}
        learned = await CategorizationService(self._session).learned(
            user_id, Line(description_normalized=normalize_description(description), kind=kind)
        )
        if learned is not None and learned.category_id in by_id:
            return by_id[learned.category_id]
        if hint:
            hinted = category_by_hint(categories, hint, kind)
            if hinted is not None:
                return hinted
        fallback = next((c for c in categories if c.is_fallback and c.kind == kind), None)
        if fallback is None:
            # Toda conta confirmada tem as duas "Outros" (FR-024 da spec 001).
            raise _repeat(speech.UNAVAILABLE)
        return fallback

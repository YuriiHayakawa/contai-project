"""O assistente: conversas e a resposta a uma pergunta (FR-061 a FR-072).

Uma pergunta vira um laço de até 5 rodadas de ferramentas. O modelo escolhe a ferramenta e os
parâmetros; quem executa é o backend, com o `user_id` da sessão. O texto final só é aceito se
todo valor em reais e todo percentual dele estiver nos resultados das ferramentas: se não
estiver, o backend pede a resposta de novo uma vez e, se falhar de novo, monta a resposta dos
próprios resultados. As transações exibidas com a resposta vêm das ferramentas, nunca do texto.

No lançamento por texto (FR-066), a proposta montada por `propose_transaction` já é a resposta:
o texto é fixo, o modelo não é chamado de novo e nada é gravado além da própria mensagem. O
lançamento só existe depois que o usuário confere a proposta no formulário e salva (FR-067).
"""

import base64
import binascii
import datetime as dt
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import fallback as ai_calls
from app.ai import usage as ai_usage
from app.ai.models import AiTask
from app.ai.provider import (
    LLMChatResult,
    LLMError,
    LLMMessage,
    LLMQuotaExhausted,
    LLMRole,
    ToolSpec,
)
from app.ai.usage import LimitKind
from app.core import clock
from app.core.errors import AiQuotaExhausted, AiUnavailable, NotFound, ValidationFailed
from app.modules.accounts.repository import AccountRepository
from app.modules.assistant import tools, validation
from app.modules.assistant.models import (
    ChatMessage,
    Conversation,
    MessageKind,
    MessageRole,
    ProposalStatus,
)
from app.modules.assistant.repository import AssistantRepository
from app.modules.assistant.schemas import (
    ConversationDetail,
    ConversationPage,
    ConversationRead,
    MessageRead,
    ProposalRead,
    SourceTransaction,
    SuggestionList,
    UsageRead,
)
from app.modules.assistant.tools.balances import ACCOUNT_TYPE_NAMES
from app.modules.assistant.tools.base import MAX_TRANSACTION_IDS, ToolContext, ToolResult
from app.modules.assistant.tools.propose import NAME as PROPOSE_TRANSACTION
from app.modules.categories.models import CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.service import category_paths
from app.modules.transactions.models import TransactionType
from app.modules.transactions.repository import TransactionFilters, TransactionRepository

logger = logging.getLogger("contai.assistant")

MAX_TOOL_ROUNDS = 5
HISTORY_MESSAGES = 20
TITLE_LENGTH = 80
INVALID_CURSOR = "Use o valor de next_cursor da página anterior."
TRANSACTION_NOT_FOUND = "Esse lançamento não existe. Salve o lançamento de novo."
_CURSOR_SEPARATOR = "|"
_PROMPTS = Path(__file__).parent / "prompts"
# A versão em uso do prompt de sistema; as anteriores ficam na pasta, como registro.
SYSTEM_PROMPT_FILE = "system_v4.md"
_WEEKDAYS = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira")
_WEEKEND = ("sábado", "domingo")
_MARKER = re.compile(r"^\s*\[(esclarecimento|recusa)\]\s*", re.IGNORECASE)
_KIND_OF_MARKER = {"esclarecimento": MessageKind.CLARIFICATION, "recusa": MessageKind.REFUSAL}
_KIND_NAMES = {CategoryKind.EXPENSE: "despesa", CategoryKind.INCOME: "receita"}

SUGGESTIONS = (
    "Quanto gastei com alimentação este mês?",
    "Em que gastei mais que no mês passado?",
    "Quais foram meus 5 maiores gastos do mês?",
    "Quanto recebi este ano?",
    "Quanto tenho em cada conta?",
    "Quanto ainda tenho de parcelas no cartão?",
)

_CORRECTION = (
    "Sua resposta citou valores que não estão nos resultados das ferramentas: {values}. "
    "Reescreva a resposta usando só valores que aparecem nos resultados, copiados como estão "
    "no campo formatted. Não calcule nem estime."
)


@cache
def system_prompt() -> str:
    """As instruções do assistente, versionadas em arquivo."""
    return (_PROMPTS / SYSTEM_PROMPT_FILE).read_text(encoding="utf-8")


def encode_cursor(conversation: Conversation) -> str:
    raw = _CURSOR_SEPARATOR.join([conversation.updated_at.isoformat(), str(conversation.id)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[dt.datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        updated_at, conversation_id = raw.split(_CURSOR_SEPARATOR)
        return dt.datetime.fromisoformat(updated_at), uuid.UUID(conversation_id)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise ValidationFailed(details={"fields": {"cursor": INVALID_CURSOR}}) from exc


def _weekday(day: dt.date) -> str:
    return (*_WEEKDAYS, *_WEEKEND)[day.weekday()]


def _history_text(message: ChatMessage) -> str:
    """A mensagem como entra no contexto. Na resposta do assistente vão também as consultas
    que ele fez, sem os resultados: é o que dá assunto a "e no mês anterior?" (FR-064)."""
    if message.role != MessageRole.ASSISTANT or not message.tool_calls:
        return message.content
    calls = "; ".join(
        f"{call.get('name')} {json.dumps(call.get('arguments', {}), ensure_ascii=False)}"
        for call in message.tool_calls
    )
    return f"{message.content}\n(Consultas feitas para esta resposta: {calls})"


@dataclass
class _Answer:
    """O que o laço de ferramentas produziu para uma pergunta."""

    text: str = ""
    kind: MessageKind = MessageKind.ANSWER
    results: list[ToolResult] = field(default_factory=list)
    tool_calls: list[dict[str, object]] = field(default_factory=list)
    # A transação proposta, quando a pergunta era um lançamento por texto.
    proposal: dict[str, Any] | None = None


class AssistantService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._assistant = AssistantRepository(session)
        self._accounts = AccountRepository(session)
        self._categories = CategoryRepository(session)
        self._transactions = TransactionRepository(session)

    # ---------- sugestões e uso

    @staticmethod
    def suggestions() -> SuggestionList:
        return SuggestionList(items=list(SUGGESTIONS))

    async def usage(self, user_id: uuid.UUID) -> UsageRead:
        status = await ai_usage.get_status(self._session, user_id, LimitKind.QUESTION)
        return UsageRead(
            used=status.used,
            limit=status.limit,
            remaining=status.remaining,
            resets_at=status.resets_at,
        )

    # ---------- conversas

    async def create_conversation(self, user_id: uuid.UUID) -> ConversationRead:
        conversation = await self._assistant.create_conversation(user_id, now=clock.utcnow())
        return self._conversation(conversation)

    async def list_conversations(
        self, user_id: uuid.UUID, *, limit: int = 50, cursor: str | None = None
    ) -> ConversationPage:
        after = decode_cursor(cursor) if cursor else None
        # Uma linha a mais só para saber se existe próxima página.
        rows = await self._assistant.list_conversations(user_id, limit=limit + 1, after=after)
        page, has_more = rows[:limit], len(rows) > limit
        return ConversationPage(
            items=[self._conversation(conversation) for conversation in page],
            next_cursor=encode_cursor(page[-1]) if has_more else None,
        )

    async def get_conversation(
        self, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> ConversationDetail:
        conversation = await self._load(user_id, conversation_id)
        messages = await self._assistant.list_messages(user_id, conversation.id)
        return ConversationDetail(
            **self._conversation(conversation).model_dump(),
            messages=await self._read_messages(user_id, messages),
        )

    async def delete_conversation(self, user_id: uuid.UUID, conversation_id: uuid.UUID) -> None:
        conversation = await self._load(user_id, conversation_id)
        await self._assistant.delete_conversation(user_id, conversation.id)

    async def delete_all_conversations(self, user_id: uuid.UUID) -> None:
        """Apaga todo o histórico de conversas do usuário (FR-069)."""
        await self._assistant.delete_all_conversations(user_id)

    async def _load(
        self, user_id: uuid.UUID, conversation_id: uuid.UUID, *, for_update: bool = False
    ) -> Conversation:
        conversation = await self._assistant.get_conversation(
            user_id, conversation_id, for_update=for_update
        )
        if conversation is None:
            raise NotFound()
        return conversation

    @staticmethod
    def _conversation(conversation: Conversation) -> ConversationRead:
        return ConversationRead(
            id=conversation.id,
            title=conversation.title,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )

    async def _read_messages(
        self, user_id: uuid.UUID, messages: list[ChatMessage]
    ) -> list[MessageRead]:
        """As mensagens com as transações de cada resposta, das que ainda existem."""
        wanted = {uuid.UUID(item) for message in messages for item in message.transaction_ids}
        found = {}
        if wanted:
            rows = await self._transactions.search(
                user_id, TransactionFilters(ids=list(wanted)), limit=len(wanted)
            )
            found = {str(row.id): row for row in rows}
        sides = await self._transactions.transfer_accounts(
            user_id, [row.transfer_group_id for row in found.values() if row.transfer_group_id]
        )

        def sources(message: ChatMessage) -> list[SourceTransaction]:
            """As transações da resposta que ainda existem. Uma transferência aparece uma vez,
            com as duas contas, mesmo que a resposta tenha guardado as duas linhas dela."""
            listed: list[SourceTransaction] = []
            shown: set[uuid.UUID] = set()
            for row in (found.get(item) for item in message.transaction_ids):
                if row is None or row.transfer_group_id in shown:
                    continue
                origin, destination = row.account_id, None
                if row.transfer_group_id is not None:
                    shown.add(row.transfer_group_id)
                    out, received = sides.get(row.transfer_group_id, (None, None))
                    origin, destination = out or row.account_id, received
                listed.append(
                    SourceTransaction(
                        id=row.id,
                        type=TransactionType(row.type),
                        date=row.date,
                        description=row.description,
                        amount_cents=row.amount_cents,
                        account_id=origin,
                        to_account_id=destination,
                        category_id=row.category_id,
                    )
                )
            return listed

        def total_count(message: ChatMessage) -> int:
            # Uma resposta antiga pode ter contado as duas linhas de uma transferência.
            groups = [
                row.transfer_group_id
                for row in (found.get(item) for item in message.transaction_ids)
                if row is not None and row.transfer_group_id is not None
            ]
            return message.transactions_total_count - (len(groups) - len(set(groups)))

        return [
            MessageRead(
                id=message.id,
                role=MessageRole(message.role),
                kind=MessageKind(message.kind),
                content=message.content,
                highlight=message.highlight,
                transactions=sources(message),
                transactions_total_count=total_count(message),
                proposal=(
                    ProposalRead.model_validate(message.proposal) if message.proposal else None
                ),
                created_at=message.created_at,
            )
            for message in messages
        ]

    # ---------- lançamento por texto

    async def _proposal_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> ChatMessage:
        message = await self._assistant.get_message(user_id, message_id, for_update=True)
        if (
            message is None
            or message.kind != MessageKind.TRANSACTION_PROPOSAL
            or message.proposal is None
        ):
            raise NotFound()
        return message

    async def mark_proposal_saved(
        self, user_id: uuid.UUID, message_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> None:
        """Guarda na proposta o lançamento que o usuário salvou a partir dela.

        Quem cria o lançamento é o próprio usuário, pelo formulário; aqui a proposta só passa a
        mostrar o que ficou salvo, com os ajustes que ele fez.
        """
        message = await self._proposal_message(user_id, message_id)
        transaction = await self._transactions.get(user_id, transaction_id)
        if transaction is None:
            raise ValidationFailed(details={"fields": {"transaction_id": TRANSACTION_NOT_FOUND}})
        saved: dict[str, Any] = {
            **(message.proposal or {}),
            "status": str(ProposalStatus.SAVED),
            "transaction_id": str(transaction.id),
        }
        if transaction.type != TransactionType.TRANSFER:
            saved |= {
                "type": str(transaction.type),
                "amount_cents": transaction.amount_cents,
                "date": transaction.date.isoformat(),
                "description": transaction.description,
                "account_id": str(transaction.account_id),
                "category_id": str(transaction.category_id) if transaction.category_id else None,
            }
        message.proposal = saved
        await self._assistant.save_message(user_id, message)

    async def discard_proposal(self, user_id: uuid.UUID, message_id: uuid.UUID) -> None:
        """Descarta a proposta. Uma proposta já salva continua salva: o lançamento existe."""
        message = await self._proposal_message(user_id, message_id)
        proposal = message.proposal or {}
        if proposal.get("status") != ProposalStatus.SAVED:
            message.proposal = {**proposal, "status": str(ProposalStatus.DISCARDED)}
            await self._assistant.save_message(user_id, message)

    # ---------- pergunta e resposta

    async def ask(
        self, user_id: uuid.UUID, conversation_id: uuid.UUID, content: str
    ) -> MessageRead:
        """Responde a uma pergunta e grava a pergunta e a resposta na conversa.

        Se o limite do dia já foi atingido, ou se o serviço de IA não responder, nada é
        gravado: o usuário vê a mensagem amigável e pode tentar de novo.
        """
        conversation = await self._load(user_id, conversation_id, for_update=True)
        await ai_usage.check_limit(self._session, user_id, LimitKind.QUESTION)

        history = await self._assistant.list_messages(
            user_id, conversation.id, last=HISTORY_MESSAGES
        )
        messages = [
            LLMMessage(
                role=LLMRole.ASSISTANT if message.role == MessageRole.ASSISTANT else LLMRole.USER,
                content=_history_text(message),
            )
            for message in history
        ]
        messages.append(LLMMessage(role=LLMRole.USER, content=content))
        answer = await self._answer(user_id, await self._system(user_id), messages)

        ids: list[str] = []
        for result in answer.results:
            ids.extend(str(item) for item in result.transaction_ids if str(item) not in ids)
        now = clock.utcnow()
        position = await self._assistant.next_position(user_id, conversation.id)
        await self._assistant.add_message(
            user_id,
            conversation.id,
            position=position,
            role=MessageRole.USER,
            kind=MessageKind.TEXT,
            content=content,
            now=now,
        )
        is_answer = answer.kind == MessageKind.ANSWER
        reply = await self._assistant.add_message(
            user_id,
            conversation.id,
            position=position + 1,
            role=MessageRole.ASSISTANT,
            kind=answer.kind,
            content=answer.text,
            now=now,
            highlight=validation.highlight_of(answer.text, answer.results) if is_answer else None,
            transaction_ids=ids[:MAX_TRANSACTION_IDS] if is_answer else [],
            transactions_total_count=(
                max(len(ids), sum(result.transaction_count for result in answer.results))
                if is_answer
                else 0
            ),
            tool_calls=answer.tool_calls,
            proposal=answer.proposal,
        )
        if not conversation.title:
            conversation.title = content[:TITLE_LENGTH]
        conversation.updated_at = now
        await self._assistant.save_conversation(user_id, conversation)
        [read] = await self._read_messages(user_id, [reply])
        return read

    async def _system(self, user_id: uuid.UUID) -> str:
        """As instruções, a data de hoje e as contas e categorias do usuário, só com nome e id.

        Os nomes foram escritos pelo usuário: entram como dados, em um bloco delimitado.
        """
        today = clock.today()
        accounts = await self._accounts.list_all(user_id)
        categories = category_paths(await self._categories.list_all(user_id))
        data = {
            "contas": [
                {
                    "id": str(account.id),
                    "nome": account.name,
                    "tipo": ACCOUNT_TYPE_NAMES[account.type],
                }
                for account in accounts
            ],
            "categorias": [
                {"id": str(category.id), "nome": name, "tipo": _KIND_NAMES[category.kind]}
                for category, name in categories
            ],
        }
        return (
            f"{system_prompt()}\n"
            f"## Hoje\n\nHoje é {_weekday(today)}, {today.isoformat()}, no fuso de Brasília.\n\n"
            f"<dados_do_usuario>\n{json.dumps(data, ensure_ascii=False)}\n</dados_do_usuario>\n"
        )

    async def _call(
        self,
        user_id: uuid.UUID,
        system: str,
        messages: list[LLMMessage],
        tool_specs: list[ToolSpec],
        *,
        counts: bool,
    ) -> LLMChatResult:
        """Uma chamada ao modelo, com o reserva, o registro de uso e a mensagem amigável."""
        try:
            result = await ai_calls.chat(
                ai_calls.chat_models(), system=system, messages=messages, tools=tool_specs
            )
        except LLMQuotaExhausted as error:
            # A cota do dia acabou no principal e no reserva: só amanhã.
            raise AiQuotaExhausted() from error
        except LLMError as error:
            logger.warning("assistant unavailable", extra={"error_code": type(error).__name__})
            raise AiUnavailable() from error
        # O lançamento por texto é uma tarefa própria, e conta no mesmo limite das perguntas.
        proposing = any(call.name == PROPOSE_TRANSACTION for call in result.tool_calls)
        await ai_usage.record_usage(
            self._session,
            user_id,
            task=AiTask.TEXT_ENTRY if proposing else AiTask.CHAT,
            model=result.model,
            usage=result.usage,
            # Uma pergunta conta uma vez no limite do dia, quantas chamadas ela precisar.
            counts_toward_limit=counts,
        )
        return result

    async def _answer(self, user_id: uuid.UUID, system: str, messages: list[LLMMessage]) -> _Answer:
        answer = _Answer()
        context = ToolContext(session=self._session, user_id=user_id, today=clock.today())
        tool_specs = tools.specs()

        reply = await self._call(user_id, system, messages, tool_specs, counts=True)
        rounds = 0
        while reply.tool_calls:
            rounds += 1
            messages.append(LLMMessage(role=LLMRole.ASSISTANT, tool_calls=reply.tool_calls))
            for call in reply.tool_calls:
                result = await tools.execute(context, call.name, call.arguments)
                answer.results.append(result)
                answer.tool_calls.append({"name": call.name, "arguments": call.arguments})
                if result.proposal is not None:
                    # A proposta já é a resposta: o texto é fixo, e o modelo não é chamado de
                    # novo. Nada foi gravado; o usuário confere e salva (FR-067).
                    answer.text = result.summary
                    answer.kind = MessageKind.TRANSACTION_PROPOSAL
                    answer.proposal = result.proposal
                    answer.results = []
                    return answer
                messages.append(
                    LLMMessage(
                        role=LLMRole.TOOL,
                        content=json.dumps(result.data, ensure_ascii=False),
                        tool_call_id=call.id,
                        tool_name=call.name,
                    )
                )
            # Na quinta rodada o modelo já não recebe ferramentas: precisa responder.
            remaining = tool_specs if rounds < MAX_TOOL_ROUNDS else []
            reply = await self._call(user_id, system, messages, remaining, counts=False)
            if rounds >= MAX_TOOL_ROUNDS:
                break

        usable = [result for result in answer.results if not result.is_error]
        text, kind = self._kind(reply.text, has_results=bool(usable))
        unsupported = validation.unsupported_values(text, usable) if text else []
        if unsupported:
            messages.append(LLMMessage(role=LLMRole.ASSISTANT, content=reply.text))
            messages.append(
                LLMMessage(
                    role=LLMRole.USER, content=_CORRECTION.format(values=", ".join(unsupported))
                )
            )
            retry = await self._call(user_id, system, messages, [], counts=False)
            text, kind = self._kind(retry.text, has_results=bool(usable))
            unsupported = validation.unsupported_values(text, usable) if text else []
        if not text or unsupported:
            # Duas respostas com números que não vieram das ferramentas, ou resposta vazia: o
            # texto sai dos próprios resultados.
            fixed = validation.fallback_answer(usable)
            text = fixed or validation.NOTHING_TO_SHOW
            kind = MessageKind.ANSWER if fixed else MessageKind.ERROR
        answer.text, answer.kind, answer.results = text, kind, usable
        return answer

    @staticmethod
    def _kind(text: str, *, has_results: bool) -> tuple[str, MessageKind]:
        """O texto sem a marca do tipo, e o tipo: o modelo marca o esclarecimento e a recusa."""
        text = text.strip()
        marker = _MARKER.match(text)
        if marker:
            return text[marker.end() :].strip(), _KIND_OF_MARKER[marker[1].lower()]
        # Sem consultar nada não há resposta com número: é um pedido de mais informação.
        return text, MessageKind.ANSWER if has_results else MessageKind.CLARIFICATION

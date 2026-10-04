"""Isolamento do assistente.

O usuário A tem uma conversa com uma pergunta e uma resposta. O usuário B não a vê na lista,
não a abre, não pergunta nela e não a apaga: pelo endereço, recebe 404, igual ao de uma conversa
que não existe. O uso do dia de A também não aparece para B.
"""

import uuid
from typing import Any

from httpx import AsyncClient, Response

from app.ai import usage as ai_usage
from app.ai.models import AiTask
from app.ai.provider import LLMUsage
from app.core import clock
from app.modules.assistant.models import MessageKind, MessageRole
from app.modules.assistant.repository import AssistantRepository
from tests.assistant import ASSISTANT, CONVERSATIONS
from tests.finance import create_account, create_category, create_transaction
from tests.isolation.registry import IsolationContext, exempt, isolation_case

Json = dict[str, Any]

QUESTION = "quanto gastei com comida esse mês?"
ANSWER = "Você gastou R$ 215,90 com Alimentação em outubro de 2026."

exempt(
    "GET",
    "/api/v1/assistant/suggestions",
    "texto fixo, igual para todos os usuários; não lê dado de ninguém",
)


async def _conversation_of_a(context: IsolationContext) -> Json:
    """Uma conversa de A com uma pergunta e uma resposta, como o assistente a deixaria."""
    assistant = AssistantRepository(context.session)
    now = clock.utcnow()
    conversation = await assistant.create_conversation(context.user_a.id, now=now)
    conversation.title = QUESTION
    for position, (role, kind, content) in enumerate(
        (
            (MessageRole.USER, MessageKind.TEXT, QUESTION),
            (MessageRole.ASSISTANT, MessageKind.ANSWER, ANSWER),
        )
    ):
        await assistant.add_message(
            context.user_a.id,
            conversation.id,
            position=position,
            role=role,
            kind=kind,
            content=content,
            now=now,
        )
    await context.session.commit()
    return await _detail(context.client_a, str(conversation.id))


async def _detail(client: AsyncClient, conversation_id: str) -> Json:
    response = await client.get(f"{CONVERSATIONS}/{conversation_id}")
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


async def _same_as_unknown(client: AsyncClient, method: str, url: str, **kwargs: Any) -> None:
    """A resposta para a conversa de outro usuário é a mesma de uma inexistente."""
    conversation_id = url.split("/")[5]
    of_other: Response = await client.request(method, url, **kwargs)
    unknown: Response = await client.request(
        method, url.replace(conversation_id, str(uuid.uuid4())), **kwargs
    )

    assert of_other.status_code == 404, of_other.text
    assert unknown.status_code == 404
    assert of_other.json()["error"] == unknown.json()["error"]


@isolation_case("GET", "/api/v1/assistant/conversations")
async def list_conversations(context: IsolationContext) -> None:
    conversation = await _conversation_of_a(context)

    seen_by_b = await context.client_b.get(CONVERSATIONS, params={"limit": "200"})

    assert seen_by_b.status_code == 200, seen_by_b.text
    assert conversation["id"] not in seen_by_b.text
    assert "comida" not in seen_by_b.text


@isolation_case("POST", "/api/v1/assistant/conversations")
async def create_conversation(context: IsolationContext) -> None:
    created = await context.client_b.post(CONVERSATIONS)

    assert created.status_code == 201, created.text
    # A conversa nasce de quem a criou: A não a vê nem a abre.
    seen_by_a = await context.client_a.get(CONVERSATIONS, params={"limit": "200"})
    assert created.json()["id"] not in seen_by_a.text
    await _same_as_unknown(context.client_a, "GET", f"{CONVERSATIONS}/{created.json()['id']}")


@isolation_case("GET", "/api/v1/assistant/conversations/{conversation_id}")
async def get_conversation_of_another_user(context: IsolationContext) -> None:
    conversation = await _conversation_of_a(context)

    await _same_as_unknown(context.client_b, "GET", f"{CONVERSATIONS}/{conversation['id']}")

    assert await _detail(context.client_a, conversation["id"]) == conversation


@isolation_case("POST", "/api/v1/assistant/conversations/{conversation_id}/messages")
async def ask_in_the_conversation_of_another_user(context: IsolationContext) -> None:
    conversation = await _conversation_of_a(context)

    await _same_as_unknown(
        context.client_b,
        "POST",
        f"{CONVERSATIONS}/{conversation['id']}/messages",
        json={"content": "e no mês anterior?"},
    )

    # A conversa de A continua com as duas mensagens dela, e B não gastou pergunta nenhuma.
    assert await _detail(context.client_a, conversation["id"]) == conversation
    assert (await context.client_b.get(f"{ASSISTANT}/usage")).json()["used"] == 0


@isolation_case("DELETE", "/api/v1/assistant/conversations/{conversation_id}")
async def delete_the_conversation_of_another_user(context: IsolationContext) -> None:
    conversation = await _conversation_of_a(context)

    await _same_as_unknown(context.client_b, "DELETE", f"{CONVERSATIONS}/{conversation['id']}")

    assert await _detail(context.client_a, conversation["id"]) == conversation


@isolation_case("DELETE", "/api/v1/assistant/conversations")
async def delete_all_conversations(context: IsolationContext) -> None:
    conversation = await _conversation_of_a(context)
    own = await context.client_b.post(CONVERSATIONS)

    deleted = await context.client_b.delete(CONVERSATIONS)

    # B apaga todo o histórico dele, e só o dele.
    assert deleted.status_code == 204, deleted.text
    assert (await context.client_b.get(f"{CONVERSATIONS}/{own.json()['id']}")).status_code == 404
    assert await _detail(context.client_a, conversation["id"]) == conversation


@isolation_case("GET", "/api/v1/assistant/usage")
async def get_usage(context: IsolationContext) -> None:
    await ai_usage.record_usage(
        context.session,
        context.user_a.id,
        task=AiTask.CHAT,
        model="modelo",
        usage=LLMUsage(input_tokens=10, output_tokens=5),
        counts_toward_limit=True,
    )
    await context.session.commit()

    seen_by_a = (await context.client_a.get(f"{ASSISTANT}/usage")).json()
    seen_by_b = (await context.client_b.get(f"{ASSISTANT}/usage")).json()

    # As perguntas de A não gastam o limite de B.
    assert seen_by_a["used"] >= 1
    assert (seen_by_b["used"], seen_by_b["remaining"]) == (0, seen_by_b["limit"])


# ---------- proposta de lançamento por texto

PROPOSAL = {
    "type": "expense",
    "amount_cents": 4_500,
    "date": "2026-09-30",
    "description": "iFood",
    "account_id": None,
    "category_id": None,
    "category_source": None,
    "status": "pending",
    "transaction_id": None,
}


async def _proposal_of(context: IsolationContext, owner: str) -> tuple[Json, str]:
    """Uma conversa do usuário com uma proposta à espera; devolve a conversa e a mensagem."""
    user, client = (
        (context.user_a, context.client_a) if owner == "a" else (context.user_b, context.client_b)
    )
    assistant = AssistantRepository(context.session)
    now = clock.utcnow()
    conversation = await assistant.create_conversation(user.id, now=now)
    message = await assistant.add_message(
        user.id,
        conversation.id,
        position=0,
        role=MessageRole.ASSISTANT,
        kind=MessageKind.TRANSACTION_PROPOSAL,
        content="Preparei o lançamento. Confira e salve.",
        now=now,
        proposal=dict(PROPOSAL),
    )
    await context.session.commit()
    return await _detail(client, str(conversation.id)), str(message.id)


async def _transaction_of(client: AsyncClient) -> Json:
    account = await create_account(client)
    category = await create_category(client)
    return await create_transaction(client, account, category, description="iFood")


@isolation_case("POST", "/api/v1/assistant/messages/{message_id}/proposal/saved")
async def mark_the_proposal_of_another_user_as_saved(context: IsolationContext) -> None:
    conversation, message_id = await _proposal_of(context, "a")
    own_transaction = await _transaction_of(context.client_b)

    # B não marca a proposta de A, nem com um lançamento dele mesmo.
    await _same_as_unknown(
        context.client_b,
        "POST",
        f"{ASSISTANT}/messages/{message_id}/proposal/saved",
        json={"transaction_id": own_transaction["id"]},
    )
    assert await _detail(context.client_a, conversation["id"]) == conversation

    # E um lançamento de A não serve para marcar uma proposta de B: é como se não existisse.
    of_a = await _transaction_of(context.client_a)
    own_conversation, own_message_id = await _proposal_of(context, "b")
    url = f"{ASSISTANT}/messages/{own_message_id}/proposal/saved"
    with_the_one_of_a = await context.client_b.post(url, json={"transaction_id": of_a["id"]})
    with_unknown = await context.client_b.post(url, json={"transaction_id": str(uuid.uuid4())})

    assert with_the_one_of_a.status_code == 422, with_the_one_of_a.text
    assert with_the_one_of_a.json()["error"] == with_unknown.json()["error"]
    assert await _detail(context.client_b, own_conversation["id"]) == own_conversation


@isolation_case("POST", "/api/v1/assistant/messages/{message_id}/proposal/discarded")
async def discard_the_proposal_of_another_user(context: IsolationContext) -> None:
    conversation, message_id = await _proposal_of(context, "a")

    await _same_as_unknown(
        context.client_b, "POST", f"{ASSISTANT}/messages/{message_id}/proposal/discarded"
    )

    assert await _detail(context.client_a, conversation["id"]) == conversation

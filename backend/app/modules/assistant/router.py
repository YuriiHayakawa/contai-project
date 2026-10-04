"""Rotas do assistente. Só validam a entrada, chamam o serviço e formatam a resposta."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_session
from app.core.rate_limit import limiter, user_or_ip
from app.modules.assistant.schemas import (
    ConversationDetail,
    ConversationPage,
    ConversationRead,
    MessageCreate,
    MessageRead,
    ProposalSaved,
    SuggestionList,
    UsageRead,
)
from app.modules.assistant.service import AssistantService
from app.modules.auth.dependencies import CurrentUserDep

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def get_assistant_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AssistantService:
    return AssistantService(session)


AssistantServiceDep = Annotated[AssistantService, Depends(get_assistant_service)]


def _question_limit() -> str:
    return get_settings().rate_limit_assistant


@router.get(
    "/suggestions",
    summary="Ver sugestões de perguntas",
    description="Perguntas de exemplo para o chat vazio. Texto fixo, sem uso de IA.",
)
async def list_suggestions(current: CurrentUserDep, service: AssistantServiceDep) -> SuggestionList:
    return service.suggestions()


@router.get(
    "/usage",
    summary="Ver o uso do assistente hoje",
    description="Quantas perguntas já foram feitas hoje, o limite do dia e quando ele zera.",
)
async def get_usage(current: CurrentUserDep, service: AssistantServiceDep) -> UsageRead:
    return await service.usage(current.id)


@router.get(
    "/conversations",
    summary="Ver o histórico de conversas",
    description="Da conversa com atividade mais recente para a mais antiga, sem as mensagens.",
)
async def list_conversations(
    current: CurrentUserDep,
    service: AssistantServiceDep,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> ConversationPage:
    return await service.list_conversations(current.id, limit=limit, cursor=cursor)


@router.post(
    "/conversations",
    status_code=status.HTTP_201_CREATED,
    summary="Começar uma conversa",
)
async def create_conversation(
    current: CurrentUserDep, service: AssistantServiceDep
) -> ConversationRead:
    return await service.create_conversation(current.id)


@router.delete(
    "/conversations",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Apagar todo o histórico de conversas",
)
async def delete_all_conversations(current: CurrentUserDep, service: AssistantServiceDep) -> None:
    await service.delete_all_conversations(current.id)


@router.get(
    "/conversations/{conversation_id}",
    summary="Ver uma conversa",
    description="A conversa com as mensagens, da mais antiga para a mais nova.",
)
async def get_conversation(
    conversation_id: uuid.UUID, current: CurrentUserDep, service: AssistantServiceDep
) -> ConversationDetail:
    return await service.get_conversation(current.id, conversation_id)


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Apagar uma conversa",
)
async def delete_conversation(
    conversation_id: uuid.UUID, current: CurrentUserDep, service: AssistantServiceDep
) -> None:
    await service.delete_conversation(current.id, conversation_id)


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Fazer uma pergunta ao assistente",
    description=(
        "Devolve a resposta do assistente, com o valor principal e as transações que a "
        "compõem. Com o limite do dia atingido responde `429 ai_limit_reached`, com "
        "`resets_at`; com a cota do dia do serviço de IA esgotada, `429 ai_quota_exhausted`; "
        "com o serviço de IA fora do ar, `503 ai_unavailable`. Nos três casos nada é gravado."
    ),
)
@limiter.limit(_question_limit, key_func=user_or_ip)
async def ask(
    request: Request,
    conversation_id: uuid.UUID,
    body: MessageCreate,
    current: CurrentUserDep,
    service: AssistantServiceDep,
) -> MessageRead:
    return await service.ask(current.id, conversation_id, body.content)


@router.post(
    "/messages/{message_id}/proposal/saved",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Marcar uma proposta de lançamento como salva",
    description=(
        "O lançamento é criado pelo próprio usuário, em `POST /transactions`, depois de conferir "
        "a proposta. Esta rota só guarda na proposta qual lançamento foi salvo a partir dela."
    ),
)
async def mark_proposal_saved(
    message_id: uuid.UUID,
    body: ProposalSaved,
    current: CurrentUserDep,
    service: AssistantServiceDep,
) -> None:
    await service.mark_proposal_saved(current.id, message_id, body.transaction_id)


@router.post(
    "/messages/{message_id}/proposal/discarded",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Descartar uma proposta de lançamento",
    description="Nada é salvo. Uma proposta que já virou lançamento continua como salva.",
)
async def discard_proposal(
    message_id: uuid.UUID, current: CurrentUserDep, service: AssistantServiceDep
) -> None:
    await service.discard_proposal(current.id, message_id)

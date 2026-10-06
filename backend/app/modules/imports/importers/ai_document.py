"""O que os dois importadores de IA têm em comum (research.md, seção 13).

O documento vai inteiro ao modelo de extração, em uma única chamada, como anexo: nunca uma
chamada por página (FR-041). O que volta é só texto, e quem converte datas e valores é este
módulo. O conteúdo do documento é tratado como dado: ele vai no anexo, nunca nas instruções, e
o prompt de sistema diz ao modelo para não seguir o que estiver escrito nele (FR-068).
"""

import datetime as dt
import re
from functools import cache
from pathlib import Path

from pydantic import BaseModel

from app.ai import fallback as ai_calls
from app.ai.models import AiTask
from app.ai.provider import Attachment, LLMInvalidResponse
from app.core import clock
from app.core.money import parse_brl
from app.modules.imports import storage
from app.modules.imports.importers.ai_schemas import Direction
from app.modules.imports.importers.base import (
    DOCUMENT_UNREADABLE,
    AiCall,
    ImportContext,
    ImportFailed,
    ProposedTransaction,
    clean_description,
)
from app.modules.imports.importers.ofx import parse_date
from app.modules.transactions.models import TransactionType

PROMPTS = Path(__file__).parent.parent / "prompts"

# O sentido vem em um campo próprio: um sinal ou parênteses no valor não mudam nada.
_SIGNS = re.compile(r"[+\-\N{MINUS SIGN}()]")


@cache
def system_prompt(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8")


def reference_day(context: ImportContext) -> dt.date:
    """O dia de hoje em Brasília: o ano de uma data sem ano e a data de um recibo sem data."""
    return context.today or clock.today()


def to_cents(text: str | None) -> int | None:
    """O valor escrito no documento, em centavos e sem sinal; `None` se não é um valor."""
    if text is None:
        return None
    try:
        return parse_brl(_SIGNS.sub("", text))
    except ValueError:
        return None


async def read_document[T: BaseModel](
    content: bytes, *, prompt: str, schema: type[T], task: AiTask, today: dt.date
) -> tuple[T, AiCall]:
    """Pede ao modelo de extração a leitura do documento, em uma chamada só.

    Devolve o que ele leu e a chamada feita, que o serviço grava em `ai_usage`. Modelo
    sobrecarregado, indisponível ou sem cota sobe como veio: quem decide tentar de novo é o
    job. Uma resposta que não respeita o schema é um documento que não pôde ser lido.
    """
    media_type = storage.media_type(content)
    if media_type is None:
        raise ImportFailed(DOCUMENT_UNREADABLE)
    try:
        result = await ai_calls.generate_structured(
            ai_calls.extraction_models(),
            system=system_prompt(prompt),
            prompt=f"Hoje é {today.isoformat()}. Leia o documento anexo.",
            schema=schema,
            attachments=[Attachment(mime_type=media_type, data=content)],
        )
    except LLMInvalidResponse as error:
        raise ImportFailed(DOCUMENT_UNREADABLE) from error
    return result.value, AiCall(task=task, model=result.model, usage=result.usage)


def to_proposed(
    *, date: dt.date | None, description: str, amount: str | None, direction: Direction
) -> ProposedTransaction | None:
    """Um lançamento lido pelo modelo, como transação proposta; `None` para valor zero.

    Data ou valor que não dá para converter recusa o documento inteiro: importar o resto
    deixaria o extrato incompleto sem aviso.
    """
    amount_cents = to_cents(amount)
    if date is None or amount_cents is None:
        raise ImportFailed(DOCUMENT_UNREADABLE)
    if amount_cents == 0:
        return None
    return ProposedTransaction(
        type=TransactionType.EXPENSE if direction == Direction.OUT else TransactionType.INCOME,
        amount_cents=amount_cents,
        date=date,
        description=clean_description(description),
    )


def to_date(text: str | None) -> dt.date | None:
    """A data escrita pelo modelo (`AAAA-MM-DD`; `DD/MM/AAAA` também é lida)."""
    return parse_date(text) if text else None

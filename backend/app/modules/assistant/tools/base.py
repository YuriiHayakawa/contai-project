"""Base das ferramentas do assistente (contracts/assistant-tools.md).

Toda ferramenta é somente leitura e chama o mesmo serviço de relatórios do painel. O `user_id`
nunca é parâmetro: vem do `ToolContext`, que o backend monta com o usuário da sessão. Os
parâmetros são validados por um schema Pydantic; um parâmetro inválido volta ao modelo como
erro descritivo, e não como exceção.

Todo valor volta em centavos e já formatado, e todo resultado ecoa o período resolvido. Os ids
das transações que compõem os valores ficam no resultado guardado pelo backend (até 50, mais a
contagem total); ao modelo vai só a contagem.
"""

import datetime as dt
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ToolSpec
from app.core.money import format_brl
from app.modules.accounts.repository import AccountRepository
from app.modules.categories.repository import CategoryRepository
from app.modules.dashboard.repository import ReportFilters

MAX_TRANSACTION_IDS = 50
NO_ENTRIES = "Não há lançamentos nesse período com esses filtros."


@dataclass(frozen=True)
class ToolContext:
    """De quem são os dados e que dia é hoje. Montado pelo backend, nunca pelo modelo."""

    session: AsyncSession
    user_id: uuid.UUID
    today: dt.date


@dataclass(frozen=True)
class ToolResult:
    """O que uma ferramenta devolve."""

    # O que o modelo recebe, em JSON.
    data: dict[str, Any]
    # Transações que compõem os valores (até 50) e quantas são ao todo (FR-063).
    transaction_ids: tuple[uuid.UUID, ...] = ()
    transaction_count: int = 0
    # Valor principal, já formatado, se a ferramenta tem um.
    highlight: str | None = None
    # Frase pronta com os números, para a resposta de reserva.
    summary: str = ""
    is_error: bool = False


class ToolError(Exception):
    """Um pedido que a ferramenta não pode atender; a mensagem volta ao modelo."""


def failure(message: str) -> ToolResult:
    return ToolResult(data={"error": message}, is_error=True)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    params: type[BaseModel]
    run: Callable[[ToolContext, Any], Awaitable[ToolResult]] = field(repr=False)


_REGISTRY: dict[str, Tool] = {}


def tool[P: BaseModel](
    *, name: str, description: str, params: type[P]
) -> Callable[
    [Callable[[ToolContext, P], Awaitable[ToolResult]]],
    Callable[[ToolContext, P], Awaitable[ToolResult]],
]:
    """Registra uma ferramenta com o nome, a descrição e o schema dos parâmetros dela."""

    def register(
        run: Callable[[ToolContext, P], Awaitable[ToolResult]],
    ) -> Callable[[ToolContext, P], Awaitable[ToolResult]]:
        _REGISTRY[name] = Tool(name=name, description=description, params=params, run=run)
        return run

    return register


def registered() -> dict[str, Tool]:
    return dict(_REGISTRY)


# ---------- schema dos parâmetros para o modelo


def _plain(schema: Any, definitions: dict[str, Any]) -> Any:
    """O JSON Schema sem referências, sem títulos e sem "ou nulo": o formato mais simples que
    os modelos aceitam. Um campo opcional é só um campo que não está em `required`."""
    if isinstance(schema, list):
        return [_plain(item, definitions) for item in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        return _plain(definitions[schema["$ref"].rsplit("/", 1)[-1]], definitions)
    options = schema.get("anyOf")
    if isinstance(options, list):
        chosen = [option for option in options if option != {"type": "null"}]
        if len(chosen) == 1:
            rest = {key: value for key, value in schema.items() if key != "anyOf"}
            return _plain({**chosen[0], **rest}, definitions)
    return {
        key: _plain(value, definitions)
        for key, value in schema.items()
        if key not in ("title", "$defs", "additionalProperties")
        and not (key == "default" and value is None)
    }


def specs() -> list[ToolSpec]:
    """As ferramentas como o provedor de IA as recebe. O `user_id` não aparece em nenhuma."""
    listed = []
    for item in _REGISTRY.values():
        schema = item.params.model_json_schema(by_alias=True)
        listed.append(
            ToolSpec(
                name=item.name,
                description=item.description,
                parameters=_plain(schema, schema.get("$defs", {})),
            )
        )
    return listed


# ---------- execução


def _describe(error: ValidationError) -> str:
    problems = [
        f"{'.'.join(str(part) for part in issue['loc']) or 'parâmetros'}: {issue['msg']}"
        for issue in error.errors()
    ]
    return "Parâmetros inválidos. Corrija e chame de novo. " + "; ".join(problems)


async def execute(context: ToolContext, name: str, arguments: dict[str, Any]) -> ToolResult:
    """Valida os parâmetros e roda a ferramenta para o usuário do contexto."""
    item = _REGISTRY.get(name)
    if item is None:
        return failure(f"A ferramenta {name} não existe. Use uma das ferramentas oferecidas.")
    try:
        params = item.params.model_validate(arguments)
    except ValidationError as error:
        return failure(_describe(error))
    try:
        return await item.run(context, params)
    except ToolError as error:
        return failure(str(error))


# ---------- formato comum dos resultados


def money(cents: int) -> dict[str, Any]:
    """Um valor em centavos e já formatado: o modelo copia `formatted`, sem fazer contas."""
    return {"cents": cents, "formatted": format_brl(cents)}


def percent(value: float | Decimal) -> str:
    """Um percentual com uma casa, como o painel o mostra: `32,5%`."""
    return f"{Decimal(str(value)):.1f}%".replace(".", ",")


def plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


# ---------- recortes


async def _known_categories(context: ToolContext, ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    """As categorias pedidas e as subcategorias delas. Uma categoria de outro usuário é
    tratada como uma que não existe."""
    categories = CategoryRepository(context.session)
    expanded: list[uuid.UUID] = []
    for category_id in ids:
        if await categories.get(context.user_id, category_id) is None:
            raise ToolError(
                f"A categoria {category_id} não existe. Use um id da lista de categorias do "
                "usuário."
            )
        expanded.extend(await categories.family_ids(context.user_id, category_id))
    return expanded


async def _known_accounts(context: ToolContext, ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    accounts = AccountRepository(context.session)
    for account_id in ids:
        if await accounts.get(context.user_id, account_id) is None:
            raise ToolError(
                f"A conta {account_id} não existe. Use um id da lista de contas do usuário."
            )
    return list(ids)


async def report_filters(
    context: ToolContext,
    *,
    category_ids: Sequence[uuid.UUID] = (),
    account_ids: Sequence[uuid.UUID] = (),
    text: str | None = None,
) -> ReportFilters:
    """O recorte pedido pelo modelo, só com contas e categorias do próprio usuário."""
    cleaned = text.strip() if text else ""
    return ReportFilters(
        account_ids=await _known_accounts(context, account_ids) if account_ids else None,
        category_ids=await _known_categories(context, category_ids) if category_ids else None,
        text=cleaned or None,
    )

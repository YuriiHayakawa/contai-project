"""`propose_transaction`: o lançamento por texto (FR-066, FR-067).

O modelo só diz o que entendeu da frase: o tipo, o valor como foi escrito, a data como
referência, uma descrição e dicas de conta e de categoria. Quem monta a proposta é o backend:
converte o valor com `Decimal`, resolve a data no fuso de Brasília e procura a conta e a
categoria entre as do usuário. A categoria vem primeiro das regras que ele já ensinou (FR-048);
a dica do modelo só vale quando não há regra. Sem conta na frase, vale a última conta usada.

A ferramenta não grava nada: nem lançamento, nem regra de categoria. A proposta só vira
lançamento quando o usuário a confere no formulário e salva.
"""

import datetime as dt
import re
import uuid
from collections.abc import Sequence
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.money import parse_brl
from app.modules.accounts.models import Account, AccountType
from app.modules.accounts.repository import AccountRepository
from app.modules.assistant.models import ProposalStatus
from app.modules.assistant.tools.base import ToolContext, ToolError, ToolResult, money, tool
from app.modules.categories.models import Category, CategoryKind
from app.modules.categories.repository import CategoryRepository
from app.modules.categorization.service import (
    CategorizationService,
    Line,
    SuggestionSource,
    category_fits,
    category_paths,
)
from app.modules.transactions.models import TransactionType
from app.modules.transactions.normalize import normalize_description
from app.modules.transactions.repository import TransactionRepository

NAME = "propose_transaction"
MAX_AMOUNT_CENTS = 9_999_999_999_99

MISSING_AMOUNT = (
    "Falta o valor do lançamento. Não chame a ferramenta de novo sem ele: pergunte à pessoa "
    "qual foi o valor, começando a resposta com [esclarecimento]."
)
INVALID_AMOUNT = (
    'Não entendi o valor "{amount}". Envie só os algarismos, como a pessoa escreveu: "45" ou '
    '"45,90". Se a frase não tem um valor claro, pergunte qual foi.'
)
INVALID_DATE = (
    'Não entendi a data "{reference}". Use today, yesterday ou uma data no formato AAAA-MM-DD.'
)

_DAY_MONTH = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{4}))?$")
_RELATIVE_DAYS = {"today": 0, "hoje": 0, "yesterday": 1, "ontem": 1}

# Como as pessoas chamam cada tipo de conta, já sem acentos. Da palavra mais específica para a
# mais genérica: "conta" sozinha só decide quando nenhuma outra apareceu.
_ACCOUNT_WORDS: tuple[tuple[AccountType, tuple[str, ...]], ...] = (
    (AccountType.CHECKING, ("debito", "corrente", "pix")),
    (AccountType.CREDIT_CARD, ("cartao", "credito")),
    (AccountType.SAVINGS, ("poupanca",)),
    (AccountType.CASH, ("dinheiro", "carteira", "especie")),
    (AccountType.INVESTMENT, ("investimento", "investimentos")),
)
_GENERIC_ACCOUNT_WORD = "conta"


class ProposeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["expense", "income"] = Field(
        description="expense: gasto, compra ou pagamento; income: dinheiro que a pessoa recebeu."
    )
    amount: str | None = Field(
        default=None,
        max_length=30,
        description=(
            'O valor como a pessoa escreveu, em texto: "45" ou "45,90". Não converta e não '
            "arredonde. Sem valor na frase, não envie este campo."
        ),
    )
    date_reference: str = Field(
        default="today",
        max_length=10,
        description=(
            "today, yesterday ou a data que a pessoa disse, no formato AAAA-MM-DD. Sem data na "
            "frase, today."
        ),
    )
    description: str = Field(
        min_length=1,
        max_length=200,
        description=(
            "O que foi, em poucas palavras: o nome da loja ou do serviço, ou do que se trata. "
            'Por exemplo: "iFood", "Almoço", "Freela".'
        ),
    )
    account_hint: str | None = Field(
        default=None,
        max_length=60,
        description=(
            'A conta como a pessoa a disse: "cartão", "nubank", "poupança", "dinheiro". A loja '
            "e quem pagou não são a conta. Se ela não disse a conta, não envie este campo."
        ),
    )
    category_hint: str | None = Field(
        default=None,
        max_length=130,
        description=(
            "O nome, copiado da lista de categorias do usuário, da categoria que combina com o "
            "lançamento."
        ),
    )


# ---------- valor e data


def amount_cents(amount: str) -> int:
    """O valor escrito na frase, em centavos. A conversão passa por `Decimal`, nunca por float."""
    try:
        cents = parse_brl(amount)
    except ValueError as error:
        raise ToolError(INVALID_AMOUNT.format(amount=amount)) from error
    if not 0 < cents <= MAX_AMOUNT_CENTS:
        raise ToolError(INVALID_AMOUNT.format(amount=amount))
    return cents


def resolve_date(reference: str, today: dt.date) -> dt.date:
    """`today`, `yesterday` ou uma data explícita, a partir do dia de hoje em Brasília."""
    cleaned = reference.strip().lower()
    if cleaned in _RELATIVE_DAYS:
        return today - dt.timedelta(days=_RELATIVE_DAYS[cleaned])
    try:
        return dt.date.fromisoformat(cleaned)
    except ValueError:
        pass
    written = _DAY_MONTH.match(cleaned)
    if written:
        # Dia e mês sem ano: o ano de hoje.
        try:
            return dt.date(int(written[3] or today.year), int(written[2]), int(written[1]))
        except ValueError:
            pass
    raise ToolError(INVALID_DATE.format(reference=reference))


# ---------- conta


def _words(text: str) -> list[str]:
    return normalize_description(text).split()


def _hinted_types(hint: Sequence[str]) -> set[AccountType]:
    """Os tipos de conta que a dica cita. "Cartão de débito" é a conta corrente."""
    for account_type, names in _ACCOUNT_WORDS:
        if any(name in hint for name in names):
            return {account_type}
    return {AccountType.CHECKING} if _GENERIC_ACCOUNT_WORD in hint else set()


def accounts_for_hint(accounts: Sequence[Account], hint: str) -> list[Account]:
    """As contas que a dica pode estar apontando.

    Vale o nome da conta ou da instituição ("nubank") e o tipo ("cartão", "poupança"). Uma só
    é a conta da proposta; duas, como dois cartões para "no cartão", deixam a conta em aberto.
    """
    hint_words = _words(hint)
    spoken = " ".join(hint_words)
    exact = [account for account in accounts if " ".join(_words(account.name)) == spoken]
    if len(exact) == 1:
        return exact

    def named(account: Account) -> bool:
        names = [_words(account.name), _words(account.institution or "")]
        return any(
            words and (set(hint_words) <= set(words) or set(words) <= set(hint_words))
            for words in names
        )

    candidates = [account for account in accounts if named(account)]
    types = _hinted_types(hint_words)
    if not candidates:
        candidates = [account for account in accounts if account.type in types]
    elif len(candidates) > 1 and types:
        # "No cartão do Nubank", com conta e cartão no mesmo banco: o tipo desempata.
        candidates = [account for account in candidates if account.type in types] or candidates
    return candidates


def _repeats(hint: str, description: str) -> bool:
    """A dica só repete palavras da descrição: o modelo tomou a loja, ou quem pagou, pela
    conta ("de um freela"). A frase não disse conta nenhuma."""
    return set(_words(hint)) <= set(_words(description))


async def _account(
    context: ToolContext, hint: str | None, description: str, transaction_type: TransactionType
) -> Account | None:
    accounts = await AccountRepository(context.session).list_all(context.user_id)
    if hint and _words(hint):
        candidates = accounts_for_hint(accounts, hint)
        if len(candidates) == 1:
            return candidates[0]
        # Duas contas servem, ou a frase citou uma conta que o usuário não tem: fica em aberto.
        if candidates or not _repeats(hint, description):
            return None
    # Sem conta na frase, vale a última usada. Um recebimento não entra em cartão de crédito:
    # para ele, vale a última conta usada que não é cartão.
    receives = transaction_type == TransactionType.INCOME
    usable = [
        account
        for account in accounts
        if not (receives and account.type == AccountType.CREDIT_CARD)
    ]
    last_used = await TransactionRepository(context.session).last_used_account_id(
        context.user_id, include_cards=not receives
    )
    for account in usable:
        if account.id == last_used:
            return account
    # Quem ainda não lançou nada e só tem uma conta: é ela.
    return usable[0] if len(usable) == 1 else None


# ---------- categoria


def category_by_hint(
    categories: Sequence[Category], hint: str, kind: CategoryKind
) -> Category | None:
    """A categoria que a dica nomeia: pelo nome completo, `Categoria > Subcategoria`, ou só
    pelo nome, quando ele é de uma categoria só. Vale a do tipo do lançamento; para um
    recebimento, também a de despesa, que é o estorno."""
    spoken = normalize_description(hint)
    if not spoken:
        return None
    named = [
        (category, normalize_description(path), normalize_description(category.name))
        for category, path in category_paths(categories)
        if category_fits(category, kind)
    ]
    for matches in (
        [category for category, path, _ in named if path == spoken],
        [category for category, _, name in named if name == spoken],
    ):
        same_kind = [category for category in matches if category.kind == kind]
        chosen = same_kind or matches
        if len(chosen) == 1:
            return chosen[0]
    return None


async def _category(
    context: ToolContext, description: str, hint: str | None, kind: CategoryKind
) -> tuple[Category | None, SuggestionSource | None]:
    categories = await CategoryRepository(context.session).list_all(context.user_id)
    # Primeiro o que o usuário já ensinou para esta descrição (FR-048); a IA só entra depois.
    learned = await CategorizationService(context.session).learned(
        context.user_id,
        Line(description_normalized=normalize_description(description), kind=kind),
    )
    if learned is not None:
        by_id = {category.id: category for category in categories}
        return by_id[learned.category_id], learned.source
    if hint:
        category = category_by_hint(categories, hint, kind)
        if category is not None:
            return category, SuggestionSource.AI
    return None, None


# ---------- a proposta


def _summary(missing: Sequence[str]) -> str:
    if not missing:
        return "Preparei o lançamento. Salve como está ou ajuste antes de salvar."
    what = {
        ("account",): "não sei em qual conta ele entra",
        ("category",): "não encontrei uma categoria para ele",
        ("account", "category"): "faltam a conta e a categoria",
    }[tuple(missing)]
    return f"Preparei o lançamento, mas {what}: você escolhe ao ajustar."


def _id(value: uuid.UUID | None) -> str | None:
    return str(value) if value is not None else None


@tool(
    name=NAME,
    description=(
        "Prepara um lançamento a partir de uma frase da pessoa, para ela conferir e salvar. Não "
        "grava nada. Use quando ela contar um gasto ou um recebimento que quer registrar, como "
        "gastei 45 no ifood ontem no cartão, recebi 200 de um freela hoje ou almoço 32,50. Não "
        "use para perguntas sobre o que já foi lançado."
    ),
    params=ProposeParams,
)
async def propose_transaction(context: ToolContext, params: ProposeParams) -> ToolResult:
    if params.amount is None or not params.amount.strip():
        return ToolResult(
            data={"missing": ["amount"], "error": MISSING_AMOUNT},
            summary="Falta o valor do lançamento.",
            is_error=True,
        )
    cents = amount_cents(params.amount)
    date = resolve_date(params.date_reference, context.today)
    transaction_type = TransactionType(params.type)
    kind = CategoryKind(params.type)
    description = " ".join(params.description.split())

    account = await _account(context, params.account_hint, description, transaction_type)
    category, source = await _category(context, description, params.category_hint, kind)
    missing = [
        name for name, found in (("account", account), ("category", category)) if found is None
    ]
    proposal: dict[str, Any] = {
        "type": params.type,
        "amount_cents": cents,
        "date": date.isoformat(),
        "description": description,
        "account_id": _id(account.id if account else None),
        "category_id": _id(category.id if category else None),
        # De onde veio a categoria: de uma regra do usuário ou de uma sugestão da IA.
        "category_source": str(source) if source else None,
        "status": str(ProposalStatus.PENDING),
        "transaction_id": None,
    }
    return ToolResult(
        data={
            "proposal": {
                "type": params.type,
                "amount": money(cents),
                "date": date.isoformat(),
                "description": description,
                "account": account.name if account else None,
                "category": category.name if category else None,
            },
            "missing": missing,
            "note": "Nada foi gravado: a pessoa confere a proposta e salva.",
        },
        summary=_summary(missing),
        proposal=proposal,
    )

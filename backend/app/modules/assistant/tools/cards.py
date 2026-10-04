"""`get_card_invoices`: por cartão, a fatura atual e as parcelas futuras, sobre o resumo de
cartões do painel."""

import datetime as dt
import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core import clock
from app.modules.assistant.tools.base import (
    MAX_TRANSACTION_IDS,
    ToolContext,
    ToolError,
    ToolResult,
    money,
    tool,
)
from app.modules.dashboard.schemas import CardSummary
from app.modules.dashboard.service import ReportingService


class CardsParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Ids de cartões do usuário; sem nenhum, todos os cartões ativos.",
    )


def _month(label: str) -> str:
    """`2026-11` como "novembro de 2026"."""
    year, month = label.split("-")
    return clock.month_name(dt.date(int(year), int(month), 1))


def _card(card: CardSummary) -> dict[str, Any]:
    invoice, payment = card.current_invoice, card.payment
    closed = payment.closed_invoice
    return {
        "name": card.name,
        "current_invoice": {
            "from": invoice.period_start.isoformat(),
            "to": invoice.period_end.isoformat(),
            "closing_date": invoice.closing_date.isoformat(),
            "due_date": invoice.due_date.isoformat(),
            "amount": money(invoice.amount_cents),
        },
        "future_installments": {
            "total": money(card.future_installments.total_cents),
            "months": [
                {"month": _month(item.month), "amount": money(item.amount_cents)}
                for item in card.future_installments.months
            ],
        },
        # O que falta pagar da última fatura fechada, se falta, e tudo o que se deve hoje.
        "closed_invoice_due": (
            {"due_date": closed.due_date.isoformat(), "amount": money(closed.amount_cents)}
            if closed
            else None
        ),
        "total_due": money(payment.total_due_cents),
    }


@tool(
    name="get_card_invoices",
    description=(
        "Por cartão de crédito ativo do usuário: a fatura atual (período, fechamento, "
        "vencimento e valor), as parcelas das faturas seguintes, por mês e no total, o que "
        "falta pagar da última fatura fechada e o total devido hoje. Use para perguntas como "
        "quanto ainda tenho de parcelas no cartão."
    ),
    params=CardsParams,
)
async def get_card_invoices(context: ToolContext, params: CardsParams) -> ToolResult:
    reports = ReportingService(context.session)
    cards = await reports.cards(context.user_id, reference=context.today)
    if params.account_ids:
        known = {card.account_id for card in cards}
        unknown = [account_id for account_id in params.account_ids if account_id not in known]
        if unknown:
            raise ToolError(
                f"O cartão {unknown[0]} não existe entre os cartões ativos. Use um id da lista "
                "de contas do usuário."
            )
        cards = [card for card in cards if card.account_id in params.account_ids]

    data: dict[str, Any] = {"cards": [_card(card) for card in cards]}
    if not cards:
        data["note"] = "O usuário não tem cartão de crédito ativo."
        return ToolResult(data=data, summary="Você não tem cartão de crédito cadastrado.")

    ids: list[uuid.UUID] = []
    count = 0
    for card in cards:
        card_ids, card_count = await reports.card_entry_ids(
            context.user_id, card, limit=MAX_TRANSACTION_IDS
        )
        ids.extend(card_ids)
        count += card_count
    summary = " ".join(
        f"{card.name}: fatura atual de {money(card.current_invoice.amount_cents)['formatted']} "
        f"e parcelas futuras de {money(card.future_installments.total_cents)['formatted']}."
        for card in cards
    )
    return ToolResult(
        data=data,
        transaction_ids=tuple(ids[:MAX_TRANSACTION_IDS]),
        transaction_count=count,
        summary=summary,
    )

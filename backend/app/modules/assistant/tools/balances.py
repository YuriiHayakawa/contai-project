"""`get_account_balances`: o saldo de hoje de cada conta ativa, como o painel o mostra."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.accounts.models import AccountType
from app.modules.assistant.tools.base import ToolContext, ToolError, ToolResult, money, tool
from app.modules.dashboard.service import ReportingService

ACCOUNT_TYPE_NAMES: dict[AccountType, str] = {
    AccountType.CHECKING: "conta corrente",
    AccountType.CREDIT_CARD: "cartão de crédito",
    AccountType.CASH: "dinheiro",
    AccountType.SAVINGS: "poupança",
    AccountType.INVESTMENT: "investimento",
}


class BalancesParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Ids de contas do usuário; sem nenhum, todas as contas ativas.",
    )


@tool(
    name="get_account_balances",
    description=(
        "O saldo de hoje de cada conta ativa do usuário. Em cartão de crédito, o saldo negativo "
        "é o que se deve. Use para perguntas como quanto tenho na poupança."
    ),
    params=BalancesParams,
)
async def get_account_balances(context: ToolContext, params: BalancesParams) -> ToolResult:
    balances = await ReportingService(context.session).account_balances(context.user_id)
    if params.account_ids:
        active = {balance.id for balance in balances}
        unknown = [account_id for account_id in params.account_ids if account_id not in active]
        if unknown:
            # Uma conta de outro usuário, arquivada ou inexistente: para o modelo, não existe.
            raise ToolError(
                f"A conta {unknown[0]} não existe entre as contas ativas. Use um id da lista "
                "de contas do usuário."
            )
        balances = [balance for balance in balances if balance.id in params.account_ids]

    accounts: list[dict[str, Any]] = [
        {
            "name": balance.name,
            "type": ACCOUNT_TYPE_NAMES[AccountType(balance.type)],
            "balance": money(balance.balance_cents),
        }
        for balance in balances
    ]
    data: dict[str, Any] = {"accounts": accounts}
    if not accounts:
        data["note"] = "O usuário não tem contas ativas."
        return ToolResult(data=data, summary="Você não tem contas ativas cadastradas.")
    listed = "; ".join(f"{item['name']}: {item['balance']['formatted']}" for item in accounts)
    return ToolResult(
        data=data,
        highlight=accounts[0]["balance"]["formatted"] if len(accounts) == 1 else None,
        summary=f"Saldo de hoje: {listed}.",
    )

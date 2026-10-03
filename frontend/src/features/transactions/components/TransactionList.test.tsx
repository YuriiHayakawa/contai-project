import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { today } from "../../../lib/dates";
import type { Account } from "../../accounts/types";
import type { Transaction } from "../types";
import { TransactionList, type TransactionListProps } from "./TransactionList";

function account(id: string, name: string): Account {
  return {
    id,
    type: "checking",
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: null,
    due_day: null,
    archived: false,
    balance_cents: 0,
  };
}

function transferSide(id: string, direction: "out" | "in", accountId: string): Transaction {
  return {
    id,
    type: "transfer",
    transfer_direction: direction,
    amount_cents: 50_000,
    date: today(),
    description: "Resgate",
    notes: null,
    account_id: accountId,
    category_id: null,
    transfer_group_id: "grupo",
    installment_group_id: null,
    installment_number: null,
    installment_count: null,
    source: "manual",
    created_at: "2026-10-02T12:00:00Z",
  };
}

const accounts = new Map([
  ["acc-invest", account("acc-invest", "Investimento")],
  ["acc-inter", account("acc-inter", "Conta Principal (Inter)")],
]);

const out = transferSide("tx-out", "out", "acc-invest");
const received = transferSide("tx-in", "in", "acc-inter");

function renderList(transactions: Transaction[], overrides: Partial<TransactionListProps> = {}) {
  const onSelect = vi.fn();
  render(
    <TransactionList
      label="Lançamentos"
      transactions={transactions}
      totalCount={transactions.length}
      accounts={accounts}
      categories={new Map()}
      onRetry={vi.fn()}
      empty={<p>Nada por aqui</p>}
      onSelect={onSelect}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      {...overrides}
    />,
  );
  return { user: userEvent.setup(), onSelect };
}

const rows = () => within(screen.getByRole("region", { name: "Hoje" })).getAllByRole("button");

describe("TransactionList: transferência", () => {
  it("com os dois lados na tela, vira uma linha só, com o que saiu e o que entrou", () => {
    renderList([received, out]);

    expect(rows()).toHaveLength(1);
    const row = rows()[0] as HTMLElement;
    expect(row).toHaveTextContent(
      "Transferência: Resgate" +
        "Saiu de Investimento−R$ 500,00" +
        "Entrou em Conta Principal (Inter)+R$ 500,00",
    );
  });

  it("a linha abre o detalhe da transferência", async () => {
    const { user, onSelect } = renderList([received, out]);

    await user.click(rows()[0] as HTMLElement);

    expect(onSelect).toHaveBeenCalledWith(out);
  });

  it("com um lado só na tela, mostra o que aconteceu naquela conta, com sinal", () => {
    renderList([out]);

    expect(rows()[0]).toHaveTextContent("Transferência · saiu de Investimento");
    expect(rows()[0]).toHaveTextContent("−R$ 500,00");
  });

  it("o lado que entra leva +", () => {
    renderList([received]);

    expect(rows()[0]).toHaveTextContent("Transferência · entrou em Conta Principal (Inter)");
    expect(rows()[0]).toHaveTextContent("+R$ 500,00");
  });

  it("transferência não muda o total do dia", () => {
    renderList([received, out]);

    expect(screen.getByText("Total do dia:").parentElement).toHaveTextContent(
      "Total do dia: R$ 0,00",
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";

import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import type { Category } from "../../categories/types";
import type { ChatMessage, SourceTransaction } from "../types";
import { AssistantMessage } from "./AssistantMessage";

vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");

function account(id: string, name: string, type: Account["type"]): Account {
  return {
    id,
    type,
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: null,
    due_day: null,
    credit_limit_cents: null,
    archived: false,
    balance_cents: 0,
  };
}

function category(id: string, name: string, children: Category[] = []): Category {
  return {
    id,
    name,
    kind: "expense",
    parent_id: null,
    icon: "utensils",
    color: "caqui",
    is_fallback: false,
    archived: false,
    children,
  };
}

/** O bloco das transações lê as contas e as categorias do usuário, para dar nome a elas. */
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderBare(ui, { wrapper });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountsService.listAccounts).mockResolvedValue([
    account("acc-checking", "Conta corrente", "checking"),
    account("acc-savings", "Poupança", "savings"),
  ]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue({
    expense: [category("cat-food", "Alimentação", [category("cat-market", "Mercado")])],
    income: [],
  });
});

function expense(index: number, overrides: Partial<SourceTransaction> = {}): SourceTransaction {
  return {
    id: `tx-${index}`,
    type: "expense",
    date: "2026-10-03",
    description: `Mercado ${index}`,
    amount_cents: 4_590,
    account_id: "acc-checking",
    to_account_id: null,
    category_id: "cat-market",
    ...overrides,
  };
}

function answer(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    kind: "answer",
    content: "Você gastou R$ 842,30 com Alimentação em outubro de 2026.",
    highlight: "R$ 842,30",
    transactions: [],
    transactions_total_count: 0,
    proposal: null,
    created_at: "2026-10-04T12:00:00Z",
    ...overrides,
  };
}

const marks = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(".marca-texto"));

describe("AssistantMessage", () => {
  it("o marca-texto fica só no valor principal; os demais valores usam a classe money", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          content:
            "Você gastou R$ 842,30 com Alimentação em outubro de 2026, contra R$ 790,10 em setembro.",
        })}
      />,
    );

    const [mark, ...others] = marks(container);
    expect(mark).toHaveTextContent("R$ 842,30");
    expect(mark).toHaveClass("money", "font-bold");
    expect(others).toHaveLength(0);

    const other = screen.getByText("R$ 790,10");
    expect(other).toHaveClass("money");
    expect(other).not.toHaveClass("marca-texto");
  });

  it("valor principal repetido no texto: só a primeira ocorrência é destacada", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          content: "Foram R$ 50,00 no mercado e R$ 50,00 na farmácia.",
          highlight: "R$ 50,00",
        })}
      />,
    );

    expect(marks(container)).toHaveLength(1);
    expect(screen.getAllByText("R$ 50,00")).toHaveLength(2);
    expect(container).toHaveTextContent("Foram R$ 50,00 no mercado e R$ 50,00 na farmácia.");
  });

  it("o sinal de menos entra no destaque junto com o valor", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({ content: "O saldo de outubro é −R$ 45,90.", highlight: "R$ 45,90" })}
      />,
    );

    expect(marks(container)[0]).toHaveTextContent("−R$ 45,90");
  });

  it("resposta sem valor principal não tem destaque", () => {
    const { container } = render(
      <AssistantMessage
        message={answer({
          kind: "clarification",
          content: "Não encontrei a categoria Viagens. Você quis dizer Lazer ou Transporte?",
          highlight: null,
        })}
      />,
    );

    expect(marks(container)).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "De onde veio esse número" })).toBeNull();
  });

  it("o destaque só é pintado com movimento na resposta que acabou de chegar", () => {
    const { container, rerender } = render(<AssistantMessage message={answer({})} />);
    expect(marks(container)[0]).not.toHaveClass("before:animate-paint");

    rerender(<AssistantMessage message={answer({})} fresh />);
    expect(marks(container)[0]).toHaveClass("before:animate-paint");
  });

  it('"De onde veio esse número" mostra até 5 transações e "Ver todas" abre a lista completa', async () => {
    const user = userEvent.setup();
    render(
      <AssistantMessage
        message={answer({
          transactions: Array.from({ length: 8 }, (_, index) => expense(index + 1)),
          transactions_total_count: 23,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    expect(within(block).getAllByRole("listitem")).toHaveLength(5);
    expect(block).toHaveTextContent("Mercado 5");
    expect(block).not.toHaveTextContent("Mercado 6");

    const all = within(block).getByRole("button", { name: "Ver todas as 23" });
    expect(all).toHaveAttribute("aria-expanded", "false");
    await user.click(all);

    expect(within(block).getAllByRole("listitem")).toHaveLength(8);
    // A resposta traz no máximo 50 transações: o bloco diz quantas das 23 estão na tela.
    expect(block).toHaveTextContent("Mostrando 8 de 23.");
    expect(within(block).getByRole("button", { name: "Ver menos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it('com 5 transações ou menos, o bloco não tem "Ver todas"', () => {
    render(
      <AssistantMessage
        message={answer({
          transactions: [
            expense(1),
            expense(2, { type: "income", description: "Reembolso", amount_cents: 1_200 }),
          ],
          transactions_total_count: 2,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    const [first, second] = within(block).getAllByRole("listitem");
    expect(first).toHaveTextContent("3 de out.");
    expect(first).toHaveTextContent("Mercado 1");
    // Despesa com − e receita com +: a cor nunca é o único sinal.
    expect(first).toHaveTextContent("−R$ 45,90");
    expect(second).toHaveTextContent("+R$ 12,00");
    expect(within(block).queryByRole("button")).toBeNull();
  });

  it("cada linha diz o que foi e onde: a categoria e a conta do lançamento", async () => {
    render(
      <AssistantMessage
        message={answer({
          transactions: [
            expense(1),
            expense(2, { type: "income", description: "Estorno Mercado", amount_cents: 1_000 }),
          ],
          transactions_total_count: 2,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    expect(await within(block).findByText("Alimentação › Mercado · Conta corrente")).toBeVisible();
    const [, refund] = within(block).getAllByRole("listitem");
    // Receita em categoria de despesa é o estorno da compra.
    expect(refund).toHaveTextContent("Estorno · Alimentação › Mercado · Conta corrente");
  });

  it("uma transferência mostra de qual conta o dinheiro saiu e em qual entrou", async () => {
    render(
      <AssistantMessage
        message={answer({
          content: "Você fez 1 transferência de R$ 500,00 em outubro de 2026.",
          highlight: "R$ 500,00",
          transactions: [
            expense(1, {
              type: "transfer",
              description: "Transferência",
              amount_cents: 50_000,
              account_id: "acc-checking",
              to_account_id: "acc-savings",
              category_id: null,
            }),
          ],
          transactions_total_count: 1,
        })}
      />,
    );

    const block = screen.getByRole("region", { name: "De onde veio esse número" });
    const [row] = within(block).getAllByRole("listitem");
    await within(block).findByText("Poupança");
    expect(row).toHaveTextContent("Transferência de Conta corrente para Poupança");
    // Sem sinal: a transferência não é gasto nem receita.
    expect(within(block).getByText("R$ 500,00")).toHaveClass("text-ink-muted");
    expect(row).not.toHaveTextContent("−R$");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import { addDays, today } from "../../../lib/dates";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import type { Category } from "../../categories/types";
import { NewTransactionProvider } from "../../transactions/hooks/useNewTransaction";
import * as transactionsService from "../../transactions/services/transactionsService";
import type { Transaction } from "../../transactions/types";
import { useConversation } from "../hooks/useConversation";
import * as assistantService from "../services/assistantService";
import type { ChatMessage, Proposal } from "../types";
import { ProposalCard } from "./ProposalCard";

vi.mock("../services/assistantService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");
vi.mock("../../transactions/services/transactionsService");

const getConversation = vi.mocked(assistantService.getConversation);
const markProposalSaved = vi.mocked(assistantService.markProposalSaved);
const discardProposal = vi.mocked(assistantService.discardProposal);
const listAccounts = vi.mocked(accountsService.listAccounts);
const listCategories = vi.mocked(categoriesService.listCategories);
const createTransaction = vi.mocked(transactionsService.createTransaction);

const YESTERDAY = addDays(today(), -1);

function account(id: string, name: string, type: Account["type"], archived = false): Account {
  return {
    id,
    type,
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: type === "credit_card" ? 10 : null,
    due_day: type === "credit_card" ? 17 : null,
    credit_limit_cents: null,
    archived,
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

const proposal: Proposal = {
  type: "expense",
  amount_cents: 4_500,
  date: YESTERDAY,
  description: "iFood",
  account_id: "acc-card",
  category_id: "cat-restaurant",
  category_source: "ai",
  status: "pending",
  transaction_id: null,
};

function messageWith(changes: Partial<Proposal>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    kind: "transaction_proposal",
    content: "Preparei o lançamento. Salve como está ou ajuste antes de salvar.",
    highlight: null,
    transactions: [],
    transactions_total_count: 0,
    proposal: { ...proposal, ...changes },
    created_at: "2026-10-04T15:00:00Z",
  };
}

function saved(changes: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    type: "expense",
    transfer_direction: null,
    amount_cents: 4_500,
    date: YESTERDAY,
    description: "iFood",
    notes: null,
    account_id: "acc-card",
    category_id: "cat-restaurant",
    transfer_group_id: null,
    installment_group_id: null,
    installment_number: null,
    installment_count: null,
    source: "assistant",
    created_at: "2026-10-04T15:00:05Z",
    ...changes,
  };
}

/** O cartão como aparece no chat: lê a proposta da conversa guardada na tela. */
function Chat() {
  const conversation = useConversation("conv-1");
  const message = conversation.data?.messages[0];
  if (!message?.proposal) return null;
  return <ProposalCard messageId={message.id} proposal={message.proposal} />;
}

function renderCard(changes: Partial<Proposal> = {}) {
  getConversation.mockResolvedValue({
    id: "conv-1",
    title: "gastei 45 no ifood ontem no cartão",
    created_at: "2026-10-04T15:00:00Z",
    updated_at: "2026-10-04T15:00:00Z",
    messages: [messageWith(changes)],
  });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <NewTransactionProvider>
            <Chat />
          </NewTransactionProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const card = (name = "Lançamento sugerido"): Promise<HTMLElement> =>
  screen.findByRole("region", { name });

beforeEach(() => {
  vi.resetAllMocks();
  listAccounts.mockResolvedValue([
    account("acc-checking", "Conta corrente", "checking"),
    account("acc-card", "Cartão Verde", "credit_card"),
  ]);
  listCategories.mockResolvedValue({
    expense: [category("cat-food", "Alimentação", [category("cat-restaurant", "Restaurante")])],
    income: [],
  });
  markProposalSaved.mockResolvedValue(undefined);
  discardProposal.mockResolvedValue(undefined);
});

describe("ProposalCard", () => {
  it("mostra o valor, a data, a conta e a categoria da proposta", async () => {
    renderCard();

    const region = await card();
    expect(region).toHaveTextContent("Despesa");
    expect(region).toHaveTextContent("−R$ 45,00");
    expect(region).toHaveTextContent("iFood");
    expect(region).toHaveTextContent("DataOntem");
    expect(await within(region).findByText("Cartão Verde")).toBeInTheDocument();
    expect(region).toHaveTextContent("CategoriaAlimentação › Restaurante");
    expect(within(region).getByText("−R$ 45,00")).toHaveClass("money", "text-money-lg");
  });

  it('"Salvar" grava o lançamento direto, sem abrir o formulário', async () => {
    const user = userEvent.setup();
    createTransaction.mockResolvedValue(saved({}));
    renderCard();
    await within(await card()).findByText("Cartão Verde");
    expect(createTransaction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    // Todos os campos obrigatórios vieram na proposta: o lançamento nasce como ela está.
    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith({
        type: "expense",
        amount_cents: 4_500,
        date: YESTERDAY,
        description: "iFood",
        account_id: "acc-card",
        category_id: "cat-restaurant",
        notes: null,
        source: "assistant",
      }),
    );
    const region = await card("Lançamento salvo");
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(markProposalSaved).toHaveBeenCalledWith("msg-1", "tx-1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(region).getByText("Lançamento salvo")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Ver nos lançamentos" })).toBeInTheDocument();
    for (const name of ["Salvar", "Ajustar", "Descartar"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it('"Salvar" que falha diz o que fazer e deixa a proposta à espera', async () => {
    const user = userEvent.setup();
    createTransaction.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "validation_error",
        message: "Confira os campos destacados.",
        details: { fields: { account_id: "Esta conta foi arquivada. Escolha outra conta." } },
      }),
    );
    renderCard();
    await within(await card()).findByText("Cartão Verde");

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText("Esta conta foi arquivada. Escolha outra conta."),
    ).toBeInTheDocument();
    expect(markProposalSaved).not.toHaveBeenCalled();
    expect(await card()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar" })).toBeInTheDocument();
  });

  it('"Ajustar" abre o formulário preenchido, e nada é salvo antes da confirmação', async () => {
    const user = userEvent.setup();
    renderCard();
    await within(await card()).findByText("Cartão Verde");

    await user.click(screen.getByRole("button", { name: "Ajustar" }));

    const form = await screen.findByRole("dialog", { name: "Ajustar lançamento" });
    expect(within(form).getByLabelText("Valor")).toHaveValue("45,00");
    expect(within(form).getByLabelText("Descrição")).toHaveValue("iFood");
    expect(within(form).getByLabelText("Categoria")).toHaveValue("cat-restaurant");
    expect(within(form).getByLabelText("Conta")).toHaveValue("acc-card");
    expect(within(form).getByLabelText("Data")).toHaveValue(YESTERDAY);
    expect(createTransaction).not.toHaveBeenCalled();

    // Fechar sem salvar: a proposta continua à espera, e nada foi gravado.
    await user.click(within(form).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createTransaction).not.toHaveBeenCalled();
    expect(markProposalSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar" })).toBeInTheDocument();
  });

  it("depois de ajustar e salvar no formulário, o cartão mostra o lançamento salvo", async () => {
    const user = userEvent.setup();
    createTransaction.mockResolvedValue(saved({ description: "iFood jantar" }));
    renderCard();
    await within(await card()).findByText("Cartão Verde");

    await user.click(screen.getByRole("button", { name: "Ajustar" }));
    const form = await screen.findByRole("dialog", { name: "Ajustar lançamento" });
    await user.type(within(form).getByLabelText("Descrição"), " jantar");
    await user.click(within(form).getByRole("button", { name: "Salvar lançamento" }));

    // O lançamento nasce do formulário, com o ajuste e a origem no assistente.
    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith({
        type: "expense",
        amount_cents: 4_500,
        date: YESTERDAY,
        description: "iFood jantar",
        account_id: "acc-card",
        category_id: "cat-restaurant",
        notes: null,
        source: "assistant",
      }),
    );
    const region = await card("Lançamento salvo");
    expect(markProposalSaved).toHaveBeenCalledWith("msg-1", "tx-1");
    expect(region).toHaveTextContent("iFood jantar");
    expect(within(region).getByText("Lançamento salvo")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Ver nos lançamentos" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajustar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
  });

  it('"Descartar" remove a proposta sem salvar nada', async () => {
    const user = userEvent.setup();
    renderCard();
    await card();

    await user.click(screen.getByRole("button", { name: "Descartar" }));

    expect(await screen.findByText(/Proposta descartada: iFood/)).toHaveTextContent(
      "Proposta descartada: iFood, −R$ 45,00. Nada foi salvo.",
    );
    expect(discardProposal).toHaveBeenCalledWith("msg-1");
    expect(createTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Lançamento sugerido" })).toBeNull();
  });

  it('proposta com a conta em aberto: só o "Ajustar", e o formulário pede a conta', async () => {
    const user = userEvent.setup();
    renderCard({ account_id: null });
    const region = await card();
    await within(region).findByText("Alimentação › Restaurante");
    expect(region).toHaveTextContent("ContaVocê escolhe ao ajustar");
    // Sem a conta, não há o que salvar direto: quem escolhe é o usuário, no formulário.
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ajustar" }));
    const form = await screen.findByRole("dialog", { name: "Ajustar lançamento" });
    expect(within(form).getByLabelText("Conta")).toHaveValue("");
    await user.click(within(form).getByRole("button", { name: "Salvar lançamento" }));

    expect(await within(form).findByText("Escolha uma conta.")).toBeInTheDocument();
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('proposta com a categoria em aberto: só o "Ajustar"', async () => {
    renderCard({ category_id: null });

    const region = await card();
    await within(region).findByText("Cartão Verde");
    expect(region).toHaveTextContent("CategoriaVocê escolhe ao ajustar");
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ajustar" })).toBeInTheDocument();
  });

  it('conta arquivada depois da proposta vale como campo em aberto: só o "Ajustar"', async () => {
    const user = userEvent.setup();
    listAccounts.mockResolvedValue([
      account("acc-checking", "Conta corrente", "checking"),
      account("acc-card", "Cartão Verde", "credit_card", true),
    ]);
    renderCard();
    await within(await card()).findByText("Cartão Verde");

    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ajustar" }));

    const form = await screen.findByRole("dialog", { name: "Ajustar lançamento" });
    expect(within(form).getByLabelText("Conta")).toHaveValue("");
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("proposta de receita mostra o valor com o sinal de mais", async () => {
    renderCard({ type: "income", amount_cents: 20_000, description: "Freela", category_id: null });

    const region = await card();
    expect(region).toHaveTextContent("Receita");
    expect(within(region).getByText("+R$ 200,00")).toHaveClass("text-income");
    await waitFor(() => expect(region).toHaveTextContent("CategoriaVocê escolhe ao ajustar"));
  });
});

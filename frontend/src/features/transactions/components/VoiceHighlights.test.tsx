import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import { addDays, today } from "../../../lib/dates";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import type { CategoryTree } from "../../categories/types";
import * as transactionsService from "../services/transactionsService";
import type { Transaction } from "../types";
import { VoiceHighlights } from "./VoiceHighlights";

vi.mock("../services/transactionsService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");

const listTransactions = vi.mocked(transactionsService.listTransactions);
const undoVoice = vi.mocked(transactionsService.undoVoice);
const restoreTransaction = vi.mocked(transactionsService.restoreTransaction);

const nubank: Account = {
  id: "acc-nubank",
  type: "checking",
  name: "Nubank",
  institution: null,
  initial_balance_cents: 0,
  initial_balance_date: "2026-01-01",
  closing_day: null,
  due_day: null,
  credit_limit_cents: null,
  archived: false,
  balance_cents: 0,
};

const categories: CategoryTree = {
  expense: [
    {
      id: "cat-food",
      name: "Alimentação",
      kind: "expense",
      parent_id: null,
      icon: "utensils",
      color: "caqui",
      is_fallback: false,
      archived: false,
      children: [],
    },
  ],
  income: [],
};

function voiceEntry(id: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: "expense",
    transfer_direction: null,
    amount_cents: 4590,
    date: today(),
    description: "iFood",
    notes: null,
    account_id: "acc-nubank",
    category_id: "cat-food",
    transfer_group_id: null,
    installment_group_id: null,
    installment_number: null,
    installment_count: null,
    source: "voice",
    voice_phrase: "gastei 45 e 90 no ifood",
    created_at: "2026-11-21T12:00:00Z",
    ...extra,
  };
}

function renderBlock() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <VoiceHighlights />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountsService.listAccounts).mockResolvedValue([nubank]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue(categories);
});

describe("VoiceHighlights", () => {
  it("mostra os lançamentos por voz dos últimos 7 dias, com a frase entendida", async () => {
    listTransactions.mockResolvedValue({
      items: [voiceEntry("v1")],
      next_cursor: null,
      total_count: 1,
    });

    renderBlock();

    expect(await screen.findByRole("heading", { name: "Lançados por voz" })).toBeInTheDocument();
    expect(screen.getByText("Você disse: “gastei 45 e 90 no ifood”")).toBeInTheDocument();
    expect(screen.getByText("por voz")).toBeInTheDocument();
    expect(listTransactions).toHaveBeenCalledWith(
      { source: "voice", from: addDays(today(), -6) },
      null,
    );
  });

  it("sem lançamentos por voz, o bloco não aparece", async () => {
    listTransactions.mockResolvedValue({ items: [], next_cursor: null, total_count: 0 });

    renderBlock();

    await waitFor(() => expect(listTransactions).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Lançados por voz" })).not.toBeInTheDocument();
  });

  it("desfazer não pede confirmação e oferece Refazer, que restaura", async () => {
    listTransactions.mockResolvedValue({
      items: [voiceEntry("v1")],
      next_cursor: null,
      total_count: 1,
    });
    undoVoice.mockResolvedValue({ restore_token: "token-de-restauracao", expires_in: 10 });
    restoreTransaction.mockResolvedValue(voiceEntry("v1"));
    const user = renderBlock();

    await user.click(await screen.findByRole("button", { name: "Desfazer iFood" }));

    expect(undoVoice).toHaveBeenCalledWith("v1");
    expect(await screen.findByText("Lançamento desfeito.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refazer" }));
    expect(restoreTransaction).toHaveBeenCalledWith("token-de-restauracao");
    expect(await screen.findByText("Lançamento refeito.")).toBeInTheDocument();
  });

  it("desfazer de novo diz que já tinha sido desfeito", async () => {
    listTransactions.mockResolvedValue({
      items: [voiceEntry("v1")],
      next_cursor: null,
      total_count: 1,
    });
    undoVoice.mockRejectedValue(
      new ApiError({ status: 404, code: "transaction_not_found", message: "Não encontrado." }),
    );
    const user = renderBlock();

    await user.click(await screen.findByRole("button", { name: "Desfazer iFood" }));

    expect(await screen.findByText("Esse lançamento já tinha sido desfeito.")).toBeInTheDocument();
  });
});

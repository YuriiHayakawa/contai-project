import { QueryClientProvider } from "@tanstack/react-query";
import type { Proposal } from "@web/features/assistant/types";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { ToastProvider } from "@/components/ui/Toast";
import { createTestQueryClient } from "@/test-utils";

import * as accountsService from "../../accounts/services/accounts";
import * as categoriesService from "../../categories/services/categories";
import * as transactionsService from "../../transactions/services/transactions";
import { accounts, categories, transaction } from "../../transactions/fixtures";
import { takeProposalDraft } from "../proposal-draft";
import * as service from "../services/assistant";
import { ProposalCard } from "./ProposalCard";

const mockPush = jest.fn();

jest.mock("../services/assistant");
jest.mock("../../transactions/services/transactions");
jest.mock("../../accounts/services/accounts");
jest.mock("../../categories/services/categories");
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const createTransaction = jest.mocked(transactionsService.createTransaction);
const markSaved = jest.mocked(service.markProposalSaved);
const discard = jest.mocked(service.discardProposal);

function proposal(extra: Partial<Proposal> = {}): Proposal {
  return {
    type: "expense",
    amount_cents: 4590,
    date: "2026-11-21",
    description: "iFood",
    account_id: "acc-inter",
    category_id: "cat-food",
    category_source: "ai",
    status: "pending",
    transaction_id: null,
    ...extra,
  };
}

async function renderCard(value: Proposal) {
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <ProposalCard messageId="m1" proposal={value} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  [createTransaction, markSaved, discard, mockPush].forEach((mock) => mock.mockReset());
  jest.mocked(accountsService.listAccounts).mockResolvedValue(accounts);
  jest.mocked(categoriesService.listCategories).mockResolvedValue(categories);
  takeProposalDraft();
});

describe("proposta de lançamento", () => {
  it("completa: Salvar grava como está, com origem assistente, e marca a proposta", async () => {
    createTransaction.mockResolvedValue(transaction("novo"));
    markSaved.mockResolvedValue(undefined);
    const user = await renderCard(proposal());

    await user.press(await screen.findByRole("button", { name: "Salvar lançamento" }));

    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith({
        type: "expense",
        amount_cents: 4590,
        date: "2026-11-21",
        description: "iFood",
        account_id: "acc-inter",
        category_id: "cat-food",
        notes: null,
        source: "assistant",
      }),
    );
    await waitFor(() => expect(markSaved).toHaveBeenCalledWith("m1", "novo"));
    expect(await screen.findByText("Lançamento salvo")).toBeOnTheScreen();
  });

  it("sem conta, não tem Salvar: só Ajustar, que abre o formulário preenchido", async () => {
    const user = await renderCard(proposal({ account_id: null }));

    expect(await screen.findByText("Conta: você escolhe ao ajustar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Salvar lançamento" })).not.toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Ajustar" }));

    expect(mockPush).toHaveBeenCalledWith("/lancamento/novo");
    expect(takeProposalDraft()).toEqual({
      messageId: "m1",
      values: {
        type: "expense",
        amountCents: 4590,
        description: "iFood",
        date: "2026-11-21",
        accountId: null,
        categoryId: "cat-food",
      },
    });
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("Descartar não salva nada", async () => {
    discard.mockResolvedValue(undefined);
    const user = await renderCard(proposal());

    await user.press(await screen.findByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(discard).toHaveBeenCalledWith("m1"));
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("depois de descartada, diz que nada foi salvo", async () => {
    await renderCard(proposal({ status: "discarded" }));

    expect(screen.getByText(/Proposta descartada: iFood/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Salvar lançamento" })).not.toBeOnTheScreen();
  });
});

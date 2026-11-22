import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { addDays, today } from "@web/lib/dates";

import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api-client";
import { createTestQueryClient } from "@/test-utils";

import * as accountsService from "../../accounts/services/accounts";
import * as categoriesService from "../../categories/services/categories";
import { accounts, categories, transaction } from "../fixtures";
import * as transactionsService from "../services/transactions";
import * as voiceService from "../services/voice";
import { VoiceHighlights } from "./VoiceHighlights";

jest.mock("../services/transactions");
jest.mock("../services/voice");
jest.mock("../../accounts/services/accounts");
jest.mock("../../categories/services/categories");

const listTransactions = jest.mocked(transactionsService.listTransactions);
const undoVoice = jest.mocked(voiceService.undoVoice);
const restoreTransaction = jest.mocked(voiceService.restoreTransaction);

const entry = transaction("v1", {
  description: "iFood",
  amount_cents: 4500,
  date: today(),
  source: "voice",
  voice_phrase: "gastei 45 no ifood",
});

async function renderBlock() {
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>
        <VoiceHighlights />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  [listTransactions, undoVoice, restoreTransaction].forEach((mock) => mock.mockReset());
  jest.mocked(accountsService.listAccounts).mockResolvedValue(accounts);
  jest.mocked(categoriesService.listCategories).mockResolvedValue(categories);
  listTransactions.mockResolvedValue({ items: [entry], next_cursor: null, total_count: 1 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("bloco Lançados por voz", () => {
  it("mostra os últimos 7 dias, com a frase entendida e a marca por voz", async () => {
    await renderBlock();

    expect(await screen.findByRole("header", { name: "Lançados por voz" })).toBeOnTheScreen();
    expect(screen.getByText("Você disse: “gastei 45 no ifood”")).toBeOnTheScreen();
    expect(screen.getByText("por voz")).toBeOnTheScreen();
    expect(listTransactions).toHaveBeenCalledWith(
      { source: "voice", from: addDays(today(), -6) },
      null,
      expect.anything(),
    );
  });

  it("o botão de desfazer é lido com o valor e a descrição", async () => {
    await renderBlock();

    expect(
      await screen.findByRole("button", { name: "Lançado por voz, 45 reais, iFood. Desfazer" }),
    ).toBeOnTheScreen();
  });

  it("sem lançamentos por voz, o bloco não aparece", async () => {
    listTransactions.mockResolvedValue({ items: [], next_cursor: null, total_count: 0 });

    await renderBlock();

    expect(screen.queryByRole("header", { name: "Lançados por voz" })).not.toBeOnTheScreen();
  });

  it("desfazer não pede confirmação, e o Refazer fica 10 s e restaura", async () => {
    jest.useFakeTimers();
    undoVoice.mockResolvedValue({ restore_token: "token", expires_in: 10 });
    restoreTransaction.mockResolvedValue(entry);
    await renderBlock();
    const fastUser = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await fastUser.press(
      await screen.findByRole("button", { name: "Lançado por voz, 45 reais, iFood. Desfazer" }),
    );

    expect(undoVoice).toHaveBeenCalledWith("v1");
    expect(await screen.findByText("Lançamento desfeito.")).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(9_000));
    await fastUser.press(screen.getByRole("button", { name: "Refazer" }));
    expect(restoreTransaction).toHaveBeenCalledWith("token");
    expect(await screen.findByText("Lançamento refeito.")).toBeOnTheScreen();
  });

  it("o Refazer some depois de 10 s", async () => {
    jest.useFakeTimers();
    undoVoice.mockResolvedValue({ restore_token: "token", expires_in: 10 });
    await renderBlock();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await user.press(
      await screen.findByRole("button", { name: "Lançado por voz, 45 reais, iFood. Desfazer" }),
    );
    await screen.findByText("Lançamento desfeito.");
    await act(() => jest.advanceTimersByTimeAsync(10_000));

    expect(screen.queryByRole("button", { name: "Refazer" })).not.toBeOnTheScreen();
  });

  it("desfazer de novo diz que já tinha sido desfeito", async () => {
    undoVoice.mockRejectedValue(
      new ApiError({ status: 404, code: "transaction_not_found", message: "Não encontrado." }),
    );
    const user = await renderBlock();

    await user.press(
      await screen.findByRole("button", { name: "Lançado por voz, 45 reais, iFood. Desfazer" }),
    );

    expect(await screen.findByText("Esse lançamento já tinha sido desfeito.")).toBeOnTheScreen();
  });
});

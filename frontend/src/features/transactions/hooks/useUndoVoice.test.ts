import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import * as transactionsService from "../services/transactionsService";
import type { Transaction } from "../types";
import { useUndoVoice } from "./useUndoVoice";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("../services/transactionsService");
vi.mock("../../../components/ui/Toast", () => ({ useToast: () => toast }));

const undoVoice = vi.mocked(transactionsService.undoVoice);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

const entry = { id: "v1", source: "voice", description: "iFood" } as Transaction;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useUndoVoice", () => {
  it("o Refazer fica na tela pelo tempo que o token vale", async () => {
    undoVoice.mockResolvedValue({ restore_token: "token", expires_in: 10 });
    const { result } = renderHook(() => useUndoVoice(), { wrapper });

    result.current.mutate(entry);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Lançamento desfeito.", {
      action: { label: "Refazer", onClick: expect.any(Function) },
      durationMs: 10_000,
    });
  });
});

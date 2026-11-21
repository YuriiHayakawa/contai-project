import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

import { ToastProvider } from "@/components/ui/Toast";
import { createTestQueryClient } from "@/test-utils";

import { transaction } from "../fixtures";
import * as voiceService from "../services/voice";
import { useUndoVoice } from "./useUndoVoice";

jest.mock("../services/voice");

const undoVoice = jest.mocked(voiceService.undoVoice);

function setup() {
  const queryClient = createTestQueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { wrapper, invalidate };
}

describe("useUndoVoice", () => {
  it("desfaz, atualiza a lista e o painel, e anuncia o Refazer ao VoiceOver", async () => {
    undoVoice.mockResolvedValue({ restore_token: "token", expires_in: 10 });
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const { wrapper, invalidate } = setup();
    const { result } = await renderHook(() => useUndoVoice(), { wrapper });

    await act(() => result.current.mutateAsync(transaction("v1", { source: "voice" })));

    expect(undoVoice).toHaveBeenCalledWith("v1");
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith("Lançamento desfeito. Refazer disponível."),
    );
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["transactions"],
      ["dashboard"],
    ]);
    expect(screen.getByRole("button", { name: "Refazer" })).toBeOnTheScreen();
  });
});

import { renderHook } from "@testing-library/react-native";

import { useRefetchOnFocus } from "./use-refetch-on-focus";

// Como o expo-router: o efeito roda ao focar e de novo sempre que o callback muda.
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => {
    const { useEffect: mockUseEffect } = jest.requireActual<typeof import("react")>("react");
    mockUseEffect(callback, [callback]);
  },
}));

describe("useRefetchOnFocus", () => {
  it("não recarrega a cada renderização, mesmo com uma função nova a cada vez", async () => {
    const calls: number[] = [];
    const { rerender } = await renderHook(
      ({ round }: { round: number }) => useRefetchOnFocus(() => calls.push(round)),
      { initialProps: { round: 0 } },
    );

    for (let round = 1; round <= 5; round += 1) {
      await rerender({ round });
    }

    expect(calls).toEqual([]);
  });
});

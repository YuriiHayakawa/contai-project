import { act, renderHook } from "@testing-library/react-native";

import { usePullToRefresh } from "./use-pull-to-refresh";

describe("usePullToRefresh", () => {
  it("o indicador só liga com o gesto e desliga quando a recarga termina", async () => {
    let finish: () => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await renderHook(() => usePullToRefresh(refetch));

    expect(result.current.refreshing).toBe(false);
    await act(() => result.current.onRefresh());
    expect(result.current.refreshing).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(result.current.refreshing).toBe(false);
  });
});

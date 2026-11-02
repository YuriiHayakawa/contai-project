import { act, render, screen } from "@testing-library/react";

import { LoadingScreen, SLOW_LOADING_DELAY_MS } from "./LoadingScreen";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoadingScreen", () => {
  it("anuncia o carregamento numa região viva", () => {
    render(<LoadingScreen />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Carregando…");
  });

  it("explica a demora só depois do tempo de espera", () => {
    render(<LoadingScreen slowNotice="Ainda carregando." />);

    act(() => vi.advanceTimersByTime(SLOW_LOADING_DELAY_MS - 1));
    expect(screen.queryByText("Ainda carregando.")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Ainda carregando.");
  });

  it("sem aviso, a espera não muda a tela", () => {
    render(<LoadingScreen />);

    act(() => vi.advanceTimersByTime(SLOW_LOADING_DELAY_MS * 10));
    expect(screen.getByRole("status")).toHaveTextContent(/^Carregando…$/);
  });
});

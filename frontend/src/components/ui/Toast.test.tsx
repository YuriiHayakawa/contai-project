import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";

import { ToastProvider, useToast, type ToastApi } from "./Toast";

let toast: ToastApi;

function Capture() {
  const api = useToast();
  useEffect(() => {
    toast = api;
  });
  return null;
}

function renderProvider(): void {
  render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/**
 * O aviso sai da tela um quadro depois de sair da lista, quando a animação de saída acaba.
 * Usa o `waitFor` do Vitest: o da Testing Library não termina com o `setTimeout` falso.
 */
const gone = (text: string): Promise<void> =>
  vi.waitFor(() => {
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

beforeEach(() => {
  // Só o relógio do aviso é falso; os quadros de animação seguem reais.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("sucesso e informação usam role=status e somem em 5 segundos", async () => {
    renderProvider();
    act(() => toast.success("Lançamento salvo."));

    expect(screen.getByRole("status")).toHaveTextContent("Lançamento salvo.");

    advance(4999);
    expect(screen.getByText("Lançamento salvo.")).toBeInTheDocument();
    advance(1);
    await gone("Lançamento salvo.");
  });

  it("com ação, dura 8 segundos, e a ação fecha o aviso", async () => {
    const undo = vi.fn();
    renderProvider();
    act(() => toast.info("Lançamento excluído.", { action: { label: "Desfazer", onClick: undo } }));

    advance(7999);
    expect(screen.getByText("Lançamento excluído.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));

    expect(undo).toHaveBeenCalledTimes(1);
    await gone("Lançamento excluído.");
  });

  it("erro usa role=alert e não some sozinho", () => {
    renderProvider();
    act(() => toast.error("Não foi possível salvar. Tente de novo."));

    advance(60_000);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar. Tente de novo.");
  });

  it("pausa a contagem com o foco em cima e continua de onde parou", async () => {
    renderProvider();
    act(() => toast.success("Lançamento salvo."));
    const close = screen.getByRole("button", { name: "Fechar aviso" });

    advance(3000);
    fireEvent.focus(close);
    advance(60_000);
    expect(screen.getByText("Lançamento salvo.")).toBeInTheDocument();

    fireEvent.blur(close);
    advance(1999);
    expect(screen.getByText("Lançamento salvo.")).toBeInTheDocument();
    advance(1);
    await gone("Lançamento salvo.");
  });

  it("pausa a contagem com o ponteiro em cima", async () => {
    renderProvider();
    act(() => toast.success("Lançamento salvo."));
    const item = screen.getByRole("status");

    fireEvent.pointerEnter(item);
    advance(60_000);
    expect(screen.getByText("Lançamento salvo.")).toBeInTheDocument();

    fireEvent.pointerLeave(item);
    advance(5000);
    await gone("Lançamento salvo.");
  });

  it("tem botão de fechar", async () => {
    renderProvider();
    act(() => toast.error("Não foi possível salvar. Tente de novo."));

    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    await gone("Não foi possível salvar. Tente de novo.");
  });

  it("empilha no máximo três: o mais antigo dá lugar ao novo", async () => {
    renderProvider();
    act(() => {
      toast.error("Primeiro");
      toast.error("Segundo");
      toast.error("Terceiro");
      toast.error("Quarto");
    });

    await gone("Primeiro");
    expect(screen.getAllByRole("alert").map((item) => item.textContent)).toEqual([
      "Segundo",
      "Terceiro",
      "Quarto",
    ]);
  });

  it("useToast fora do provedor avisa o que falta", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Capture />)).toThrow("useToast precisa estar dentro de <ToastProvider>.");

    silence.mockRestore();
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import { paths } from "../../lib/paths";
import { breakpoints } from "../../lib/useMediaQuery";
import { Sidebar } from "./Sidebar";

const HISTORY = <p>Conversas guardadas</p>;

/** A barra lateral só aparece a partir de `lg`: o teste escolhe a largura da tela. */
function setDesktop(desktop: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: desktop && query === breakpoints.lg,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function renderSidebar(history: ReactNode = HISTORY, path: string = paths.home) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar userName="Yuri" onNewTransaction={() => undefined} assistantHistory={history} />
    </MemoryRouter>,
  );
}

const toggle = (): HTMLElement => screen.getByRole("button", { name: "Histórico de conversas" });

beforeEach(() => {
  window.localStorage.clear();
  setDesktop(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar", () => {
  it('a seta do item "Assistente" abre e fecha o histórico de conversas', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Conversas guardadas")).toBeNull();

    await user.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByText("Conversas guardadas").parentElement;
    expect(panel).toHaveAttribute("id", toggle().getAttribute("aria-controls"));

    await user.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Conversas guardadas")).toBeNull();
  });

  it("o item continua levando ao assistente; só a seta abre o histórico", () => {
    renderSidebar();

    const item = screen.getByRole("link", { name: "Assistente" });
    expect(item).toHaveAttribute("href", paths.assistant);
    expect(within(item).queryByRole("button")).toBeNull();
  });

  it("quem deixou o histórico aberto o encontra aberto na próxima visita", async () => {
    const user = userEvent.setup();
    const first = renderSidebar();
    await user.click(toggle());
    first.unmount();

    renderSidebar();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Conversas guardadas")).toBeInTheDocument();
  });

  it("no celular, onde a barra lateral fica escondida, a lista não é montada", async () => {
    setDesktop(false);
    const user = userEvent.setup();
    renderSidebar();

    await user.click(toggle());

    expect(screen.queryByText("Conversas guardadas")).toBeNull();
  });

  it("sem histórico para mostrar, o item não tem seta", () => {
    renderSidebar(null);

    expect(screen.getByRole("link", { name: "Assistente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Histórico de conversas" })).toBeNull();
  });
});

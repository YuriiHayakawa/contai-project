import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { conversationPath, paths } from "../../../lib/paths";
import * as assistantService from "../services/assistantService";
import type { Conversation } from "../types";
import { SidebarHistory } from "./SidebarHistory";

vi.mock("../services/assistantService");

const listConversations = vi.mocked(assistantService.listConversations);
const deleteConversation = vi.mocked(assistantService.deleteConversation);

function conversation(id: string, title: string): Conversation {
  return { id, title, created_at: "2026-10-04T12:00:00Z", updated_at: "2026-10-04T12:00:00Z" };
}

const food = conversation("conv-food", "Quanto gastei com alimentação este mês?");
const transfers = conversation("conv-transfers", "Fiz alguma transferência esse mês?");

/** O histórico como fica na casca do app: ao lado da tela, em qualquer rota. */
function renderHistory(path: string = paths.home) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <SidebarHistory />
            <Outlet />
          </>
        ),
        children: [
          { path: paths.home, element: <h1>Painel</h1> },
          { path: paths.assistantChat, element: <h1>Chat</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

const history = (): Promise<HTMLElement> =>
  screen.findByRole("list", { name: "Histórico de conversas" });

beforeEach(() => {
  vi.resetAllMocks();
  listConversations.mockResolvedValue({ items: [food, transfers], next_cursor: null });
  deleteConversation.mockResolvedValue(undefined);
});

describe("SidebarHistory", () => {
  it("lista as conversas, e cada uma abre no chat", async () => {
    const user = userEvent.setup();
    const router = renderHistory();

    const list = await history();
    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([food.title, transfers.title]);

    await user.click(within(list).getByRole("link", { name: transfers.title }));

    expect(router.state.location.pathname).toBe(conversationPath(transfers.id));
    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });

  it("marca a conversa que está aberta no chat", async () => {
    renderHistory(conversationPath(food.id));

    const list = await history();
    expect(within(list).getByRole("link", { name: food.title })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(list).getByRole("link", { name: transfers.title })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("apagar uma conversa pede confirmação; a que está aberta devolve o chat vazio", async () => {
    const user = userEvent.setup();
    const router = renderHistory(conversationPath(food.id));
    await history();

    await user.click(screen.getByRole("button", { name: `Apagar a conversa: ${food.title}` }));

    const dialog = await screen.findByRole("alertdialog", { name: "Apagar esta conversa?" });
    expect(dialog).toHaveTextContent(`A conversa "${food.title}" deixa de existir`);
    expect(deleteConversation).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Apagar conversa" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(food.id));
    expect(await screen.findByText("Conversa apagada.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.assistant));
  });

  it("apagar outra conversa não tira o usuário de onde ele está", async () => {
    const user = userEvent.setup();
    const router = renderHistory(conversationPath(food.id));
    await history();

    await user.click(screen.getByRole("button", { name: `Apagar a conversa: ${transfers.title}` }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Apagar conversa",
      }),
    );

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(transfers.id));
    await screen.findByText("Conversa apagada.");
    expect(router.state.location.pathname).toBe(conversationPath(food.id));
  });

  it('só a lixeira de cada conversa apaga: a barra lateral não tem "Apagar todas"', async () => {
    renderHistory();

    const list = await history();
    expect(within(list).getAllByRole("button", { name: /^Apagar a conversa: / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Apagar todas" })).toBeNull();
  });

  it("sem conversas, diz isso e não oferece apagar", async () => {
    listConversations.mockResolvedValue({ items: [], next_cursor: null });
    renderHistory();

    expect(await screen.findByText("Nenhuma conversa ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Histórico de conversas" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apagar/ })).toBeNull();
  });

  it("uma conversa sem pergunta respondida aparece com um nome", async () => {
    listConversations.mockResolvedValue({
      items: [conversation("conv-empty", "")],
      next_cursor: null,
    });
    renderHistory();

    expect(
      within(await history()).getByRole("link", { name: "Conversa sem perguntas" }),
    ).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import { conversationPath, paths } from "../../../lib/paths";
import * as accountsService from "../../accounts/services/accountsService";
import * as categoriesService from "../../categories/services/categoriesService";
import * as assistantService from "../services/assistantService";
import type { AssistantUsage, ChatMessage } from "../types";
import { ChatPage } from "./ChatPage";

vi.mock("../services/assistantService");
// As contas e as categorias dão nome às transações que acompanham a resposta.
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");

const listSuggestions = vi.mocked(assistantService.listSuggestions);
const getUsage = vi.mocked(assistantService.getUsage);
const createConversation = vi.mocked(assistantService.createConversation);
const getConversation = vi.mocked(assistantService.getConversation);
const sendMessage = vi.mocked(assistantService.sendMessage);

const QUESTION = "Quanto gastei com alimentação este mês?";
const WAITING = "Consultando seus lançamentos…";
const NOW = "2026-10-04T15:00:00Z";

const reply: ChatMessage = {
  id: "msg-2",
  role: "assistant",
  kind: "answer",
  content: "Você gastou R$ 842,30 com Alimentação em outubro de 2026.",
  highlight: "R$ 842,30",
  transactions: [
    {
      id: "tx-1",
      type: "expense",
      date: "2026-10-03",
      description: "Mercado",
      amount_cents: 4_590,
      account_id: "acc-1",
      to_account_id: null,
      category_id: null,
    },
  ],
  transactions_total_count: 1,
  proposal: null,
  created_at: NOW,
};

function usage(remaining: number): AssistantUsage {
  // Meia-noite de 5 de outubro em Brasília.
  return { used: 30 - remaining, limit: 30, remaining, resets_at: "2026-10-05T03:00:00Z" };
}

function apiError(status: number, code: string, message: string, details?: object): ApiError {
  return new ApiError({ status, code, message, details: details as Record<string, unknown> });
}

function renderChat(path: string = paths.assistant) {
  const router = createMemoryRouter([{ path: paths.assistantChat, element: <ChatPage /> }], {
    initialEntries: [path],
  });
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

/** Uma resposta que só chega quando o teste mandar, como a do assistente, que leva segundos. */
function pendingReply() {
  let resolve: (message: ChatMessage) => void = () => undefined;
  sendMessage.mockReturnValue(
    new Promise<ChatMessage>((done) => {
      resolve = done;
    }),
  );
  return { arrive: () => resolve(reply) };
}

beforeEach(() => {
  vi.resetAllMocks();
  // O jsdom não rola a página.
  Element.prototype.scrollIntoView = vi.fn();
  listSuggestions.mockResolvedValue([QUESTION, "Quanto recebi este ano?"]);
  vi.mocked(accountsService.listAccounts).mockResolvedValue([]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue({ expense: [], income: [] });
  getUsage.mockResolvedValue(usage(30));
  createConversation.mockResolvedValue({
    id: "conv-1",
    title: "",
    created_at: NOW,
    updated_at: NOW,
  });
});

describe("ChatPage", () => {
  it("chat vazio: mostra as sugestões, e tocar em uma faz a pergunta", async () => {
    const user = userEvent.setup();
    const answerOf = pendingReply();
    const router = renderChat();

    expect(
      await screen.findByRole("heading", { name: "Pergunte sobre o seu dinheiro" }),
    ).toBeVisible();
    const suggestions = await screen.findByRole("list", { name: "Sugestões de perguntas" });
    await user.click(within(suggestions).getByRole("button", { name: QUESTION }));

    // Enquanto a resposta não chega: a pergunta fica na tela, com o indicador de consulta, e
    // o campo de escrita fica desativado.
    const chat = await screen.findByRole("list", { name: "Conversa" });
    expect(chat).toHaveAttribute("aria-live", "polite");
    expect(chat).toHaveTextContent(QUESTION);
    expect(chat).toHaveTextContent(WAITING);
    expect(screen.getByRole("textbox", { name: "Sua pergunta" })).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("list", { name: "Sugestões de perguntas" })).toBeNull();

    answerOf.arrive();

    expect(await screen.findByText("R$ 842,30")).toHaveClass("marca-texto");
    expect(chat).not.toHaveTextContent(WAITING);
    expect(screen.getByRole("region", { name: "De onde veio esse número" })).toHaveTextContent(
      "Mercado",
    );
    // A pergunta aparece uma vez só, e a conversa nova ganha o endereço dela.
    expect(within(chat).getAllByText(QUESTION)).toHaveLength(1);
    expect(sendMessage).toHaveBeenCalledWith("conv-1", QUESTION);
    await waitFor(() => expect(router.state.location.pathname).toBe(conversationPath("conv-1")));
    expect(screen.getByRole("textbox", { name: "Sua pergunta" })).not.toHaveAttribute("readonly");
  });

  it("pergunta digitada em uma conversa do histórico entra depois das mensagens dela", async () => {
    const user = userEvent.setup();
    getConversation.mockResolvedValue({
      id: "conv-9",
      title: "Quanto recebi este ano?",
      created_at: NOW,
      updated_at: NOW,
      messages: [
        { ...reply, id: "msg-a", role: "user", kind: "text", content: "Quanto recebi este ano?" },
        { ...reply, id: "msg-b", content: "Você recebeu R$ 9.000,00 em 2026.", highlight: null },
      ],
    });
    sendMessage.mockResolvedValue(reply);
    renderChat(conversationPath("conv-9"));

    const chat = await screen.findByRole("list", { name: "Conversa" });
    expect(chat).toHaveTextContent("Você recebeu R$ 9.000,00 em 2026.");
    await user.type(screen.getByRole("textbox", { name: "Sua pergunta" }), "E com comida?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("R$ 842,30");
    expect(sendMessage).toHaveBeenCalledWith("conv-9", "E com comida?");
    expect(createConversation).not.toHaveBeenCalled();
    const items = within(chat)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.getAttribute("aria-label") === "Conversa");
    expect(items).toHaveLength(4);
    expect(items[2]).toHaveTextContent("E com comida?");
    expect(items[3]).toHaveTextContent("Você gastou R$ 842,30");
    expect(screen.getByRole("textbox", { name: "Sua pergunta" })).toHaveValue("");
  });

  it("avisa quantas perguntas restam só quando são 5 ou menos", async () => {
    getUsage.mockResolvedValue(usage(3));
    renderChat();

    expect(await screen.findByText("Restam 3 perguntas hoje")).toBeVisible();
  });

  it("com mais de 5 perguntas restantes, não há aviso", async () => {
    getUsage.mockResolvedValue(usage(6));
    renderChat();

    await screen.findByRole("list", { name: "Sugestões de perguntas" });
    await waitFor(() => expect(getUsage).toHaveBeenCalled());
    expect(screen.queryByText(/perguntas? hoje/)).toBeNull();
  });

  it("uma pergunta restante: o aviso fica no singular", async () => {
    getUsage.mockResolvedValue(usage(1));
    renderChat();

    expect(await screen.findByText("Resta 1 pergunta hoje")).toBeVisible();
  });

  it("no limite do dia, o campo dá lugar ao aviso de quando o assistente volta", async () => {
    getUsage.mockResolvedValue(usage(0));
    renderChat();

    const notice = await screen.findByText(/Você atingiu o limite de perguntas de hoje/);
    expect(notice).toHaveTextContent("O assistente volta em 5 de out. às 00:00");
    expect(notice).toHaveTextContent("o restante do Contaí continua funcionando");
    expect(screen.queryByRole("textbox", { name: "Sua pergunta" })).toBeNull();
    // As sugestões continuam à vista, mas não enviam nada.
    const suggestion = await screen.findByRole("button", { name: QUESTION });
    expect(suggestion).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(suggestion);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("serviço indisponível: a pergunta fica na tela, com o aviso e o Tentar de novo", async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValueOnce(
      apiError(
        503,
        "ai_unavailable",
        "O assistente está indisponível no momento. Tente de novo em alguns minutos.",
      ),
    );
    sendMessage.mockResolvedValueOnce(reply);
    renderChat();

    await user.type(await screen.findByRole("textbox", { name: "Sua pergunta" }), QUESTION);
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("O assistente está indisponível no momento.");
    const chat = screen.getByRole("list", { name: "Conversa" });
    expect(chat).toHaveTextContent(QUESTION);
    expect(chat).not.toHaveTextContent(WAITING);

    await user.click(within(alert).getByRole("button", { name: "Tentar de novo" }));

    // A mensagem entra na tela com uma transição: confere-se a presença, e não a opacidade.
    expect(await screen.findByText("R$ 842,30")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // A nova tentativa usa a conversa que a primeira criou, em vez de abrir outra.
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith("conv-1", QUESTION);
  });

  it("cota do serviço de IA esgotada: avisa que volta amanhã, sem Tentar de novo", async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValue(
      apiError(
        429,
        "ai_quota_exhausted",
        "O limite de hoje do serviço de IA foi atingido. Ele volta a funcionar amanhã; o restante do Contaí continua funcionando normalmente.",
      ),
    );
    renderChat();

    await user.type(await screen.findByRole("textbox", { name: "Sua pergunta" }), QUESTION);
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText(/Ele volta a funcionar amanhã/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(screen.getByRole("list", { name: "Conversa" })).toHaveTextContent(QUESTION);
  });

  it("limite atingido no envio: o campo dá lugar ao aviso, com o horário do erro", async () => {
    const user = userEvent.setup();
    getUsage.mockResolvedValueOnce(usage(2));
    // O uso relido depois do erro já vem zerado.
    getUsage.mockResolvedValue(usage(0));
    sendMessage.mockRejectedValue(
      apiError(
        429,
        "ai_limit_reached",
        "Você atingiu o limite de perguntas ao assistente por hoje. Ele volta amanhã.",
        { resets_at: "2026-10-05T03:00:00Z" },
      ),
    );
    renderChat();

    await user.type(await screen.findByRole("textbox", { name: "Sua pergunta" }), QUESTION);
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText(/O assistente volta em 5 de out. às 00:00/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Sua pergunta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("conversa que não existe mais: convida a começar outra", async () => {
    const user = userEvent.setup();
    getConversation.mockRejectedValue(
      apiError(404, "not_found", "Não encontramos o que você pediu."),
    );
    const router = renderChat(conversationPath("apagada"));

    expect(await screen.findByRole("heading", { name: "Conversa não encontrada" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Sua pergunta" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Começar outra conversa" }));

    expect(router.state.location.pathname).toBe(paths.assistant);
    expect(
      await screen.findByRole("heading", { name: "Pergunte sobre o seu dinheiro" }),
    ).toBeVisible();
  });
});

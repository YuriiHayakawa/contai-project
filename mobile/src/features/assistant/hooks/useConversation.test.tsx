import { QueryClientProvider } from "@tanstack/react-query";
import type { ChatMessage, ConversationDetail } from "@web/features/assistant/types";
import { dateTimeLabel } from "@web/lib/dates";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api-client";
import { createTestQueryClient } from "@/test-utils";

import { AssistantHome } from "../components/AssistantHome";
import { ConversationView } from "../components/ConversationView";
import * as service from "../services/assistant";

const mockPush = jest.fn();
const mockSetParams = jest.fn();

jest.mock("../services/assistant");
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useFocusEffect: jest.fn(),
}));

const createConversation = jest.mocked(service.createConversation);
const sendMessage = jest.mocked(service.sendMessage);
const getConversation = jest.mocked(service.getConversation);
const getUsage = jest.mocked(service.getUsage);
const listConversations = jest.mocked(service.listConversations);
const deleteConversation = jest.mocked(service.deleteConversation);

const RESETS_AT = "2026-11-23T03:00:00Z";

function answer(content: string): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    kind: "answer",
    content,
    highlight: "R$ 842,30",
    transactions: [],
    transactions_total_count: 0,
    proposal: null,
    created_at: "2026-11-22T12:00:00Z",
  };
}

async function renderWith(element: ReactElement) {
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>{element}</ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  [
    createConversation,
    sendMessage,
    getConversation,
    getUsage,
    listConversations,
    deleteConversation,
    mockPush,
    mockSetParams,
  ].forEach((mock) => mock.mockReset());
  getUsage.mockResolvedValue({ used: 3, limit: 30, remaining: 27, resets_at: RESETS_AT });
});

describe("conversa com o assistente", () => {
  it("mostra que a resposta está sendo preparada e depois a resposta", async () => {
    createConversation.mockResolvedValue({
      id: "c1",
      title: "",
      created_at: "2026-11-22T12:00:00Z",
      updated_at: "2026-11-22T12:00:00Z",
    });
    let reply: (message: ChatMessage) => void = () => undefined;
    sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const user = await renderWith(<ConversationView conversationId={null} />);

    await user.type(
      screen.getByLabelText("Pergunta ao assistente"),
      "quanto gastei com alimentação?",
    );
    await user.press(screen.getByRole("button", { name: "Enviar pergunta" }));

    expect(await screen.findByText("Preparando a resposta…")).toBeOnTheScreen();
    expect(screen.getByText("quanto gastei com alimentação?")).toBeOnTheScreen();
    reply(answer("Você gastou R$ 842,30 com Alimentação em novembro."));

    expect(await screen.findByText(/com Alimentação em novembro/)).toBeOnTheScreen();
    expect(screen.queryByText("Preparando a resposta…")).not.toBeOnTheScreen();
    expect(sendMessage).toHaveBeenCalledWith("c1", "quanto gastei com alimentação?");
    expect(mockSetParams).toHaveBeenCalledWith({ id: "c1" });
  });

  it("abre uma conversa começada no site, com o histórico", async () => {
    const detail: ConversationDetail = {
      id: "c9",
      title: "Gastos do mês",
      created_at: "2026-11-20T12:00:00Z",
      updated_at: "2026-11-20T12:00:00Z",
      messages: [answer("Você gastou R$ 842,30 com Alimentação em novembro.")],
    };
    getConversation.mockResolvedValue(detail);

    await renderWith(<ConversationView conversationId="c9" />);

    expect(await screen.findByText(/com Alimentação em novembro/)).toBeOnTheScreen();
  });

  it("no limite diário, mostra a mensagem do site com o horário em que volta", async () => {
    getUsage.mockResolvedValue({ used: 30, limit: 30, remaining: 0, resets_at: RESETS_AT });

    await renderWith(<ConversationView conversationId={null} />);

    expect(
      await screen.findByText(
        `Você atingiu o limite de perguntas de hoje. O assistente volta em ${dateTimeLabel(RESETS_AT)}; o restante do Contaí continua funcionando.`,
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText("Pergunta ao assistente")).not.toBeOnTheScreen();
  });

  it("quando o limite acaba na hora de perguntar, mostra o aviso e não perde o texto", async () => {
    createConversation.mockResolvedValue({
      id: "c1",
      title: "",
      created_at: "2026-11-22T12:00:00Z",
      updated_at: "2026-11-22T12:00:00Z",
    });
    // Depois do erro, a API diz que não restam perguntas hoje.
    getUsage
      .mockResolvedValueOnce({ used: 29, limit: 30, remaining: 1, resets_at: RESETS_AT })
      .mockResolvedValue({ used: 30, limit: 30, remaining: 0, resets_at: RESETS_AT });
    sendMessage.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "ai_limit_reached",
        message: "Você atingiu o limite de perguntas ao assistente por hoje.",
        details: { resets_at: RESETS_AT },
      }),
    );
    const user = await renderWith(<ConversationView conversationId={null} />);

    await user.type(screen.getByLabelText("Pergunta ao assistente"), "quanto gastei?");
    await user.press(screen.getByRole("button", { name: "Enviar pergunta" }));

    expect(await screen.findByText(/O assistente volta em/)).toBeOnTheScreen();
  });
});

describe("histórico de conversas", () => {
  it("lista as conversas, inclusive as do site, e apagar pede confirmação", async () => {
    listConversations.mockResolvedValue({
      items: [
        {
          id: "c9",
          title: "Gastos do mês",
          created_at: "2026-11-20T12:00:00Z",
          updated_at: "2026-11-20T12:00:00Z",
        },
      ],
      next_cursor: null,
    });
    deleteConversation.mockResolvedValue(undefined);
    const user = await renderWith(<AssistantHome />);

    await user.press(
      await screen.findByRole("button", { name: "Apagar a conversa Gastos do mês" }),
    );
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "Apagar esta conversa?" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Apagar conversa" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("c9"));
  });

  it("abrir uma conversa e começar outra", async () => {
    listConversations.mockResolvedValue({
      items: [
        {
          id: "c9",
          title: "Gastos do mês",
          created_at: "2026-11-20T12:00:00Z",
          updated_at: "2026-11-20T12:00:00Z",
        },
      ],
      next_cursor: null,
    });
    const user = await renderWith(<AssistantHome />);

    await user.press(await screen.findByRole("button", { name: /^Gastos do mês/ }));
    expect(mockPush).toHaveBeenCalledWith("/assistente/c9");
    await user.press(screen.getByRole("button", { name: "Nova conversa" }));
    expect(mockPush).toHaveBeenCalledWith("/assistente/nova");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";

import { ToastProvider } from "../../../components/ui/Toast";
import type { SessionInfo } from "../../auth/types";
import * as settingsService from "../services/settingsService";
import { SessionsSection } from "./SessionsSection";

vi.mock("../services/settingsService");

const listSessions = vi.mocked(settingsService.listSessions);

const sessions: SessionInfo[] = [
  {
    id: "web-1",
    device: "Chrome no Windows",
    client: "web",
    last_used_at: "2026-11-18T13:00:00Z",
    is_current: true,
  },
  {
    id: "mobile-1",
    device: "iPhone",
    client: "mobile",
    last_used_at: "2026-11-18T12:00:00Z",
    is_current: false,
  },
];

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionsSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  listSessions.mockResolvedValue(sessions);
});

describe("SessionsSection", () => {
  it("mostra a sessão do app como App do Contaí, com o aparelho", async () => {
    renderSection();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [site, app] = items as [HTMLElement, HTMLElement];

    expect(within(site).getByText("Chrome no Windows")).toBeInTheDocument();
    expect(within(site).getByText("Este aparelho")).toBeInTheDocument();
    expect(within(app).getByText("App do Contaí")).toBeInTheDocument();
    expect(within(app).getByText(/^iPhone · Última atividade:/)).toBeInTheDocument();
    expect(within(app).getByRole("button", { name: "Encerrar" })).toBeInTheDocument();
  });
});

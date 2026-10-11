import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import * as accountsService from "../../accounts/services/accountsService";
import type { Account } from "../../accounts/types";
import * as categoriesService from "../../categories/services/categoriesService";
import * as dashboardService from "../../dashboard/services/dashboardService";
import type { CardSummary } from "../../dashboard/types";
import { NewTransactionProvider } from "../../transactions/hooks/useNewTransaction";
import * as transactionsService from "../../transactions/services/transactionsService";
import type { Transaction } from "../../transactions/types";
import * as cardsService from "../services/cardsService";
import type { CardInvoice, CardInvoices, InvoiceStatus } from "../types";
import { CardsPage } from "./CardsPage";

vi.mock("../services/cardsService");
vi.mock("../../dashboard/services/dashboardService");
vi.mock("../../transactions/services/transactionsService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");
// O gráfico de verdade usa o Recharts; aqui basta saber o que a tela entrega a ele.
vi.mock("./InstallmentsChart", () => ({
  InstallmentsChart: ({ months }: { months: { month: string }[] }) => (
    <p>gráfico: {months.map((item) => item.month).join(", ")}</p>
  ),
}));

const getCards = vi.mocked(dashboardService.getCards);
const getCardInvoices = vi.mocked(cardsService.getCardInvoices);
const getInvoiceCategories = vi.mocked(cardsService.getInvoiceCategories);
const listTransactions = vi.mocked(transactionsService.listTransactions);

const FOOD = "9aed6bd1-1c77-42d3-8a4c-5d638f8465f5";

function invoice(
  [start, end, closing, due]: [string, string, string, string],
  status: InvoiceStatus,
  amount: number,
  remaining = 0,
): CardInvoice {
  return {
    period_start: start,
    period_end: end,
    closing_date: closing,
    due_date: due,
    amount_cents: amount,
    status,
    remaining_cents: remaining,
  };
}

// Hoje é 5 de outubro de 2026. O Nubank fecha no dia 28 e vence no dia 10: a fatura de
// outubro fechou em 28 de setembro e está a pagar; a de novembro está aberta.
const SEPTEMBER: [string, string, string, string] = [
  "2026-07-28",
  "2026-08-27",
  "2026-08-28",
  "2026-09-10",
];
const OCTOBER: [string, string, string, string] = [
  "2026-08-28",
  "2026-09-27",
  "2026-09-28",
  "2026-10-10",
];
const NOVEMBER: [string, string, string, string] = [
  "2026-09-28",
  "2026-10-27",
  "2026-10-28",
  "2026-11-10",
];
const DECEMBER: [string, string, string, string] = [
  "2026-10-28",
  "2026-11-27",
  "2026-11-28",
  "2026-12-10",
];
const JANUARY: [string, string, string, string] = [
  "2026-11-28",
  "2026-12-27",
  "2026-12-28",
  "2027-01-10",
];

const nubankPayment = {
  closed_invoice: { closing_date: "2026-09-28", due_date: "2026-10-10", amount_cents: 124_380 },
  total_due_cents: 163_020,
};

const nubank: CardSummary = {
  account_id: "acc-nubank",
  name: "Cartão Nubank",
  closing_day: 28,
  due_day: 10,
  current_invoice_paid: false,
  credit_limit: null,
  current_invoice: { ...invoice(NOVEMBER, "open", 38_640) },
  future_installments: {
    total_cents: 70_000,
    months: [
      { month: "2026-12", amount_cents: 42_000 },
      { month: "2027-01", amount_cents: 28_000 },
    ],
  },
  payment: nubankPayment,
};

const nubankInvoices: CardInvoices = {
  account_id: "acc-nubank",
  name: "Cartão Nubank",
  closing_day: 28,
  due_day: 10,
  credit_limit: null,
  items: [
    invoice(SEPTEMBER, "paid", 103_170),
    invoice(OCTOBER, "due", 124_380, 124_380),
    invoice(NOVEMBER, "open", 38_640),
    invoice(DECEMBER, "future", 42_000),
    invoice(JANUARY, "future", 28_000),
  ],
  payment: nubankPayment,
};

// O Itaú fecha no dia 15 e vence no dia 22: está em dia, com a fatura de outubro aberta.
const itauPayment = { closed_invoice: null, total_due_cents: 51_230 };

const itau: CardSummary = {
  account_id: "acc-itau",
  name: "Itaú Visa",
  closing_day: 15,
  due_day: 22,
  current_invoice_paid: false,
  credit_limit: null,
  current_invoice: {
    ...invoice(["2026-09-15", "2026-10-14", "2026-10-15", "2026-10-22"], "open", 51_230),
  },
  future_installments: { total_cents: 0, months: [] },
  payment: itauPayment,
};

const itauInvoices: CardInvoices = {
  account_id: "acc-itau",
  name: "Itaú Visa",
  closing_day: 15,
  due_day: 22,
  credit_limit: null,
  items: [
    invoice(["2026-08-15", "2026-09-14", "2026-09-15", "2026-09-22"], "paid", 20_000),
    invoice(["2026-09-15", "2026-10-14", "2026-10-15", "2026-10-22"], "open", 51_230),
  ],
  payment: itauPayment,
};

function account(id: string, name: string, type: Account["type"]): Account {
  const isCard = type === "credit_card";
  return {
    id,
    type,
    name,
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: isCard ? 28 : null,
    due_day: isCard ? 10 : null,
    credit_limit_cents: null,
    archived: false,
    balance_cents: isCard ? -163_020 : 500_000,
  };
}

const market: Transaction = {
  id: "tx-mercado",
  type: "expense",
  transfer_direction: null,
  amount_cents: 31_245,
  date: "2026-09-26",
  description: "Mercado Pão de Açúcar",
  notes: null,
  account_id: "acc-nubank",
  category_id: FOOD,
  transfer_group_id: null,
  installment_group_id: null,
  installment_number: null,
  installment_count: null,
  source: "manual",
  created_at: "2026-09-26T12:00:00Z",
};

function CurrentAddress() {
  const { pathname, search } = useLocation();
  return <p data-testid="address">{`${pathname}${search}`}</p>;
}

function renderPage(address = "/cartoes") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[address]}>
          <CurrentAddress />
          <NewTransactionProvider>
            <Routes>
              <Route path="/cartoes" element={<CardsPage />} />
              <Route path="/contas" element={<h1>Contas</h1>} />
            </Routes>
          </NewTransactionProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const address = (): string => screen.getByTestId("address").textContent ?? "";
const heading = (name: string) => screen.findByRole("heading", { name, level: 2 });
/** O número principal da fatura, que vem logo depois do rótulo dele. */
const hero = (label: string): Element | null => screen.getByText(label).nextElementSibling;

beforeEach(() => {
  vi.resetAllMocks();
  // Só a data é fixada: cliques e consultas continuam com o relógio de verdade.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
  getCards.mockResolvedValue({ items: [nubank] });
  getCardInvoices.mockImplementation((cardId) =>
    Promise.resolve(cardId === "acc-itau" ? itauInvoices : nubankInvoices),
  );
  getInvoiceCategories.mockImplementation((_cardId, month) =>
    Promise.resolve({
      month,
      total_cents: 124_380,
      items: [
        {
          category_id: FOOD,
          name: "Alimentação",
          icon: "utensils",
          color: "caqui",
          amount_cents: 124_380,
          percent: 100,
          subcategories: [],
        },
      ],
    }),
  );
  listTransactions.mockResolvedValue({ items: [market], next_cursor: null, total_count: 1 });
  vi.mocked(accountsService.listAccounts).mockResolvedValue([
    account("acc-conta", "Conta Principal", "checking"),
    account("acc-nubank", "Cartão Nubank", "credit_card"),
    account("acc-itau", "Itaú Visa", "credit_card"),
  ]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue({ expense: [], income: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CardsPage", () => {
  it("abre na fatura a pagar, com o que falta, o prazo e os lançamentos dela", async () => {
    renderPage();

    expect(await heading("Fatura de outubro")).toBeVisible();
    expect(screen.getByText("Fechada, vence em 5 dias")).toBeVisible();
    expect(hero("Falta pagar")).toHaveTextContent("R$1.243,80");
    expect(
      screen.getByText(
        "Compras de 28 de ago. a 27 de set. · fechou em 28 de set. · vence em 10 de out.",
      ),
    ).toBeVisible();
    expect(screen.getByText("R$ 212,10 a mais que a fatura de setembro.")).toBeVisible();
    expect(screen.getByText(/fecha todo dia 28 · vence todo dia 10/)).toHaveTextContent(
      "Cartão Nubank",
    );

    // Só as compras e os estornos do cartão no período da fatura, sem o pagamento.
    expect(await screen.findByText("Mercado Pão de Açúcar")).toBeVisible();
    expect(listTransactions).toHaveBeenCalledWith(
      {
        account_id: "acc-nubank",
        from: "2026-08-28",
        to: "2026-09-27",
        without_transfers: true,
      },
      null,
      expect.anything(),
    );
    expect(
      screen.getByRole("region", { name: "Lançamentos da fatura de outubro" }),
    ).toBeInTheDocument();
  });

  it('"Pagar fatura" abre a transferência para o cartão e deixa a fatura no endereço', async () => {
    const user = renderPage();
    await heading("Fatura de outubro");

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Valor em reais" })).toHaveValue("1.243,80");
    expect(screen.getByLabelText("Entra em", { selector: "select" })).toHaveValue("acc-nubank");
    // Depois de pagar, a tela continua nesta fatura, agora como paga.
    expect(address()).toBe("/cartoes?cartao=acc-nubank&fatura=2026-09");
  });

  it("as abas mostram o estado de cada fatura e trocam a fatura da tela", async () => {
    const user = renderPage();
    await heading("Fatura de outubro");

    const tabs = screen.getByRole("navigation", { name: "Faturas" });
    expect(
      within(tabs).getByRole("button", { name: "Fatura de outubro: a pagar" }),
    ).toHaveAttribute("aria-current", "true");
    expect(within(tabs).getByRole("button", { name: "Fatura de setembro: paga" })).toBeVisible();
    expect(
      within(tabs).getByRole("button", { name: "Fatura de janeiro de 2027: futura" }),
    ).toHaveTextContent("Jan. 2027");

    await user.click(within(tabs).getByRole("button", { name: "Fatura de novembro: aberta" }));

    expect(await heading("Fatura de novembro")).toBeVisible();
    expect(screen.getByText("Aberta, fecha em 23 dias")).toBeVisible();
    expect(hero("Até agora")).toHaveTextContent("R$386,40");
    expect(
      screen.getByText(
        "Compras até 27 de out. entram nesta fatura; a partir de 28 de out., na seguinte.",
      ),
    ).toBeVisible();
    // "Pagar fatura" continua à vista, e diz que o pagamento é da fatura fechada.
    expect(screen.getByRole("button", { name: "Pagar fatura" })).toBeVisible();
    expect(
      screen.getByText("Há uma fatura fechada a pagar neste cartão: R$ 1.243,80, vence em 5 dias."),
    ).toBeVisible();
    expect(address()).toBe("/cartoes?cartao=acc-nubank&fatura=2026-10");
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "2026-09-28", to: "2026-10-27" }),
        null,
        expect.anything(),
      ),
    );
  });

  it("as setas passam para a fatura anterior e para a seguinte", async () => {
    const user = renderPage();
    await heading("Fatura de outubro");

    await user.click(screen.getByRole("button", { name: "Fatura anterior" }));

    expect(await heading("Fatura de setembro")).toBeVisible();
    expect(hero("Total da fatura")).toHaveTextContent("R$1.031,70");
    expect(screen.getByText(/venceu em 10 de set\./)).toBeVisible();
    expect(screen.getByRole("button", { name: "Pagar fatura" })).toBeVisible();
    // É a mais antiga: não há para onde voltar.
    expect(screen.getByRole("button", { name: "Fatura anterior" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Próxima fatura" }));

    expect(await heading("Fatura de outubro")).toBeVisible();
  });

  it("um link pode abrir direto em um cartão e em uma fatura", async () => {
    renderPage("/cartoes?cartao=acc-nubank&fatura=2026-12");

    expect(await heading("Fatura de janeiro de 2027")).toBeVisible();
    expect(hero("Já lançado")).toHaveTextContent("R$280,00");
    expect(
      screen.getByText(
        "Por enquanto, só o que já está lançado: parcelas e compras com data futura.",
      ),
    ).toBeVisible();
  });

  it("fatura que não existe no endereço vale como a fatura a pagar", async () => {
    renderPage("/cartoes?cartao=acc-nubank&fatura=1999-01");

    expect(await heading("Fatura de outubro")).toBeVisible();
  });

  it("com mais de um cartão, dá para escolher, e cada um diz como está", async () => {
    getCards.mockResolvedValue({ items: [nubank, itau] });
    const user = renderPage();
    await heading("Fatura de outubro");

    const picker = screen.getByRole("group", { name: "Cartão" });
    expect(within(picker).getByRole("button", { name: /Cartão Nubank/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).getByRole("button", { name: /Cartão Nubank/ })).toHaveTextContent(
      "Fatura a pagar",
    );
    const other = within(picker).getByRole("button", { name: /Itaú Visa/ });
    expect(other).toHaveTextContent("Em dia");

    await user.click(other);

    // Sem fatura a pagar, a tela abre na atual, e o pagamento adianta o que já se deve.
    expect(await screen.findByText("Aberta, fecha em 10 dias")).toBeVisible();
    expect(getCardInvoices).toHaveBeenLastCalledWith("acc-itau", expect.anything());
    expect(hero("Até agora")).toHaveTextContent("R$512,30");
    expect(screen.getByRole("button", { name: "Pagar fatura" })).toBeVisible();
    expect(
      screen.getByText(
        "Esta fatura ainda não fechou: o pagamento adianta o que você já deve no cartão, R$ 512,30.",
      ),
    ).toBeVisible();
    expect(address()).toBe("/cartoes?cartao=acc-itau");
  });

  it("com um cartão só, não há o que escolher", async () => {
    renderPage();
    await heading("Fatura de outubro");

    expect(screen.queryByRole("group", { name: "Cartão" })).toBeNull();
  });

  it("fatura paga em parte: diz o total, o que já foi pago e o que ficou de antes", async () => {
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: [
        invoice(SEPTEMBER, "paid", 103_170),
        invoice(OCTOBER, "due", 124_380, 100_000),
        invoice(NOVEMBER, "open", 38_640),
      ],
      payment: {
        closed_invoice: { ...nubankPayment.closed_invoice, amount_cents: 105_000 },
        total_due_cents: 143_640,
      },
    });
    renderPage();
    await heading("Fatura de outubro");

    expect(hero("Falta pagar")).toHaveTextContent("R$1.050,00");
    expect(
      screen.getByText(
        "Total da fatura: R$ 1.243,80. Você já pagou R$ 243,80. R$ 50,00 ficaram de antes desta fatura.",
      ),
    ).toBeVisible();
  });

  it("cartão com saldo a favor, de pagamento a mais: o botão continua lá e a tela diz o valor", async () => {
    const inFavor = { closed_invoice: null, total_due_cents: 0 };
    getCards.mockResolvedValue({ items: [{ ...nubank, payment: inFavor }] });
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: [invoice(OCTOBER, "paid", 11_000), invoice(NOVEMBER, "open", 0)],
      payment: inFavor,
    });
    vi.mocked(accountsService.listAccounts).mockResolvedValue([
      account("acc-conta", "Conta Principal", "checking"),
      { ...account("acc-nubank", "Cartão Nubank", "credit_card"), balance_cents: 4_000 },
    ]);
    const user = renderPage();
    await heading("Fatura de novembro");

    expect(screen.getByText("Pelo saldo do cartão, você não deve nada nele hoje.")).toBeVisible();
    expect(
      await screen.findByText(
        "O cartão está com R$ 40,00 a seu favor, de pagamento a mais: esse valor abate as próximas compras.",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(screen.getByLabelText("Entra em", { selector: "select" })).toHaveValue("acc-nubank");
  });

  it("fatura atual paga em parte: número grande é o que falta, com barra do já pago", async () => {
    // Fatura atual de R$ 159,90, com R$ 110,00 já pagos: faltam R$ 49,90.
    const partial = { closed_invoice: null, total_due_cents: 4_990 };
    getCards.mockResolvedValue({ items: [{ ...nubank, payment: partial }] });
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: [invoice(OCTOBER, "paid", 0), invoice(NOVEMBER, "open", 15_990)],
      payment: partial,
    });
    const user = renderPage();
    await heading("Fatura de novembro");

    // O número principal é o que falta, não o total.
    expect(hero("Falta pagar")).toHaveTextContent("R$49,90");
    expect(screen.getByText(/Você já pagou/)).toHaveTextContent(
      "Você já pagou R$ 110,00 de R$ 159,90.",
    );
    const meter = screen.getByRole("meter", { name: "Progresso do pagamento" });
    expect(meter).toHaveAttribute("aria-valuenow", "11000");
    expect(meter).toHaveAttribute("aria-valuemax", "15990");
    expect(meter.getAttribute("aria-valuetext")).toMatch(/110,00 pagos de .*159,90/);
    expect(screen.getByText("Paga os R$ 49,90 que faltam.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Valor em reais" })).toHaveValue("49,90");
  });

  it("fatura atual paga adiantado: mostra Paga, sem botão de pagar, com datas no presente", async () => {
    // Nenhuma fatura fechada a pagar, e a atual (novembro) paga adiantado.
    const settled = { closed_invoice: null, total_due_cents: 0 };
    getCards.mockResolvedValue({ items: [{ ...nubank, payment: settled }] });
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: [invoice(OCTOBER, "paid", 0), invoice(NOVEMBER, "paid_ahead", 38_640)],
      payment: settled,
    });
    renderPage();

    expect(await heading("Fatura de novembro")).toBeVisible();
    expect(screen.getByText("Paga · fatura em aberto")).toBeVisible();
    expect(hero("Total da fatura")).toHaveTextContent("R$386,40");
    // Ainda não fechou: tempo presente.
    expect(screen.getByText(/fecha em 28 de out\. · vence em 10 de nov\./)).toBeVisible();
    // Sem botão de pagar; a nota diz que novas compras reabrem.
    expect(screen.queryByRole("button", { name: "Pagar fatura" })).toBeNull();
    expect(
      screen.getByText("Fatura paga. Novas compras entram nela e reabrem o pagamento."),
    ).toBeVisible();
    // A aba da atual aparece como "Paga".
    expect(screen.getByRole("button", { name: "Fatura de novembro: paga" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("com limite informado, mostra o disponível, o usado e o limite, que não mudam a fatura", async () => {
    // Limite de R$ 500,00 e uma compra de R$ 110,00, com a fatura ainda aberta.
    const owes = { closed_invoice: null, total_due_cents: 11_000 };
    const usage = { limit_cents: 50_000, used_cents: 11_000, available_cents: 39_000 };
    getCards.mockResolvedValue({ items: [{ ...nubank, payment: owes, credit_limit: usage }] });
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: [invoice(OCTOBER, "paid", 0), invoice(NOVEMBER, "open", 11_000)],
      payment: owes,
      credit_limit: usage,
    });
    const user = renderPage();
    await heading("Fatura de novembro");

    const limit = screen.getByRole("heading", { name: "Limite do cartão" }).closest("section");
    expect(limit).toHaveTextContent("DisponívelR$ 390,00");
    expect(limit).toHaveTextContent("UsadoR$ 110,00");
    expect(limit).toHaveTextContent("LimiteR$ 500,00");
    expect(screen.getByRole("meter", { name: "Uso do limite" })).toHaveAttribute(
      "aria-valuetext",
      "R$\u00a0110,00 usados de R$\u00a0500,00",
    );
    // O limite é um teto, e não dinheiro: a fatura continua em R$ 110,00, e dá para pagá-la
    // antes do fechamento.
    expect(hero("Até agora")).toHaveTextContent("R$110,00");
    expect(
      screen.getByText(
        "Esta fatura ainda não fechou: o pagamento adianta o que você já deve no cartão, R$ 110,00.",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pagar fatura" }));

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Valor em reais" })).toHaveValue("110,00");
  });

  it("acima do limite: diz quanto passou, com texto, e nada fica bloqueado", async () => {
    const usage = { limit_cents: 50_000, used_cents: 60_000, available_cents: -10_000 };
    getCardInvoices.mockResolvedValue({ ...nubankInvoices, credit_limit: usage });
    renderPage();
    await heading("Fatura de outubro");

    const limit = screen.getByRole("heading", { name: "Limite do cartão" }).closest("section");
    expect(limit).toHaveTextContent("R$ 100,00 acima do limite");
    expect(limit).not.toHaveTextContent("Disponível");
    expect(screen.getByRole("meter", { name: "Uso do limite" })).toHaveAttribute(
      "aria-valuetext",
      "R$\u00a0600,00 usados de R$\u00a0500,00",
    );
    expect(screen.getByRole("button", { name: "Pagar fatura" })).toBeVisible();
  });

  it("sem limite informado, não mostra usado nem disponível e leva a Contas para informá-lo", async () => {
    renderPage();
    await heading("Fatura de outubro");

    const limit = screen.getByRole("heading", { name: "Limite do cartão" }).closest("section");
    expect(limit).toHaveTextContent("Informe o limite deste cartão");
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("link", { name: "Informar o limite em Contas" })).toHaveAttribute(
      "href",
      "/contas",
    );
  });

  it("fatura vencida: o selo vira alerta e diz há quanto tempo venceu", async () => {
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
    getCardInvoices.mockResolvedValue({
      ...nubankInvoices,
      items: nubankInvoices.items.map((item) =>
        item.status === "due" ? { ...item, status: "overdue" } : item,
      ),
    });
    renderPage();
    await heading("Fatura de outubro");

    expect(screen.getByText("Venceu há 3 dias")).toBeVisible();
    expect(screen.getByRole("button", { name: "Fatura de outubro: vencida" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pagar fatura" })).toBeVisible();
  });

  it("mostra para onde foi o gasto da fatura, com o caminho para os lançamentos", async () => {
    renderPage();
    await heading("Fatura de outubro");

    const row = await screen.findByRole("link", { name: /Alimentação/ });
    expect(row).toHaveTextContent("100,0% da fatura");
    expect(row).toHaveAttribute(
      "href",
      `/lancamentos?conta=acc-nubank&de=2026-08-28&ate=2026-09-27&categoria=${FOOD}`,
    );
    // A fatura é identificada pelo mês em que fecha.
    expect(getInvoiceCategories).toHaveBeenCalledWith("acc-nubank", "2026-09", expect.anything());
  });

  it("mostra as parcelas futuras do cartão, no total e por mês", async () => {
    renderPage();
    await heading("Fatura de outubro");

    const installments = screen
      .getByRole("heading", { name: "Parcelas futuras" })
      .closest("section");
    expect(installments).toHaveTextContent("R$ 700,00");
    expect(installments).toHaveTextContent("Depois da fatura atual, até a de janeiro de 2027");
    expect(await screen.findByText("gráfico: 2026-12, 2027-01")).toBeVisible();
  });

  it("sem cartão cadastrado, convida a cadastrar em Contas", async () => {
    getCards.mockResolvedValue({ items: [] });
    const user = renderPage();

    expect(await screen.findByRole("heading", { name: "Nenhum cartão cadastrado" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Ir para Contas" }));

    expect(address()).toBe("/contas");
  });

  it("falha ao carregar os cartões: diz o que fazer e tenta de novo", async () => {
    getCards.mockRejectedValueOnce(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    const user = renderPage();

    expect(
      await screen.findByRole("heading", { name: "Não foi possível carregar seus cartões" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await heading("Fatura de outubro")).toBeVisible();
  });

  it("falha ao carregar as faturas: o resto da tela continua, com o pedido de tentar de novo", async () => {
    getCardInvoices.mockRejectedValueOnce(
      new ApiError({ status: 500, code: "internal_error", message: "Tente de novo em instantes." }),
    );
    const user = renderPage();

    expect(
      await screen.findByRole("heading", { name: "Não foi possível carregar as faturas" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Cartões", level: 1 })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await heading("Fatura de outubro")).toBeVisible();
  });
});

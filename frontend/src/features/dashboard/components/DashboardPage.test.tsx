import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { ToastProvider } from "../../../components/ui/Toast";
import { ApiError } from "../../../lib/api-client";
import {
  addDays,
  addMonths,
  monthLabel,
  monthRange,
  shortDate,
  today,
  yearMonthOf,
} from "../../../lib/dates";
import * as accountsService from "../../accounts/services/accountsService";
import { AuthProvider } from "../../auth/hooks/useAuth";
import * as authService from "../../auth/services/authService";
import * as categoriesService from "../../categories/services/categoriesService";
import { NewTransactionProvider } from "../../transactions/hooks/useNewTransaction";
import * as transactionsService from "../../transactions/services/transactionsService";
import type { Transaction } from "../../transactions/types";
import * as dashboardService from "../services/dashboardService";
import type { CardSummary, CategorySpending, DashboardSummary, MonthTotals } from "../types";
import { DashboardPage } from "./DashboardPage";
import type { TrendChartProps } from "./TrendChart";

vi.mock("../services/dashboardService");
vi.mock("../../transactions/services/transactionsService");
vi.mock("../../accounts/services/accountsService");
vi.mock("../../categories/services/categoriesService");
vi.mock("../../auth/services/authService");
// O gráfico de verdade tem teste próprio; aqui basta saber o que a página entrega a ele.
vi.mock("./TrendChart", () => ({
  TrendChart: ({ trend, month, onSelectMonth }: TrendChartProps) => (
    <div data-testid="trend" data-month={month}>
      {trend.map((item) => (
        <button key={item.month} type="button" onClick={() => onSelectMonth(item.month)}>
          gráfico: {item.month}
        </button>
      ))}
    </div>
  ),
}));

const getSummary = vi.mocked(dashboardService.getSummary);
const getCategories = vi.mocked(dashboardService.getCategories);
const getTrend = vi.mocked(dashboardService.getTrend);
const getTopExpenses = vi.mocked(dashboardService.getTopExpenses);
const getCards = vi.mocked(dashboardService.getCards);
const countTransactions = vi.mocked(transactionsService.countTransactions);

const CURRENT = yearMonthOf();
const PREVIOUS = addMonths(CURRENT, -1);
const FOOD = "9aed6bd1-1c77-42d3-8a4c-5d638f8465f5";

function spending(index: number, name: string, amount: number, percent: number): CategorySpending {
  return {
    category_id: index === 0 ? FOOD : `00000000-0000-4000-8000-00000000000${index}`,
    name,
    icon: "shapes",
    color: "caqui",
    amount_cents: amount,
    percent,
    subcategories: [],
  };
}

function summaryOf(month: string, income: number, expense: number): DashboardSummary {
  return {
    month,
    income_cents: income,
    expense_cents: expense,
    net_cents: income - expense,
    accounts: [
      { id: "acc-1", name: "Conta Nubank", type: "checking", balance_cents: 218_435 },
      { id: "acc-2", name: "Cartão Nubank", type: "credit_card", balance_cents: -124_380 },
    ],
  };
}

const rent: Transaction = {
  id: "tx-1",
  type: "expense",
  transfer_direction: null,
  amount_cents: 158_000,
  date: `${CURRENT}-05`,
  description: "Aluguel",
  notes: null,
  account_id: "acc-1",
  category_id: FOOD,
  transfer_group_id: null,
  installment_group_id: null,
  installment_number: null,
  installment_count: null,
  source: "manual",
  created_at: `${CURRENT}-05T12:00:00Z`,
};

// Um cartão com a fatura fechada a pagar, que vence daqui a cinco dias.
const DUE_DATE = addDays(today(), 5);
const cardToPay: CardSummary = {
  account_id: "acc-2",
  name: "Cartão Nubank",
  closing_day: 3,
  due_day: 10,
  current_invoice: {
    period_start: addDays(today(), -10),
    period_end: addDays(today(), 19),
    closing_date: addDays(today(), 20),
    due_date: addDays(today(), 27),
    amount_cents: 38_640,
  },
  future_installments: { total_cents: 70_000, months: [{ month: CURRENT, amount_cents: 70_000 }] },
  payment: {
    closed_invoice: {
      closing_date: addDays(today(), -2),
      due_date: DUE_DATE,
      amount_cents: 124_380,
    },
    total_due_cents: 163_020,
  },
};

function answerEveryMonth(): void {
  getSummary.mockImplementation((month) =>
    Promise.resolve(
      month === CURRENT ? summaryOf(month, 545_000, 397_240) : summaryOf(month, 100_000, 376_000),
    ),
  );
  getCategories.mockImplementation((month) =>
    Promise.resolve({
      month,
      total_cents: 397_240,
      items: [spending(0, "Moradia", 284_600, 71.6), spending(1, "Alimentação", 112_640, 28.4)],
    }),
  );
  getTrend.mockImplementation((month) =>
    Promise.resolve({
      items: [addMonths(month, -1), month].map((item): MonthTotals => ({
        month: item,
        income_cents: 545_000,
        expense_cents: 397_240,
        net_cents: 147_760,
      })),
    }),
  );
  getTopExpenses.mockImplementation((month) => Promise.resolve({ month, items: [rent] }));
  getCards.mockResolvedValue({ items: [] });
  countTransactions.mockResolvedValue(42);
}

function CurrentAddress() {
  const { pathname, search } = useLocation();
  return <p data-testid="address">{`${pathname}${search}`}</p>;
}

function renderPage(address = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[address]}>
            <CurrentAddress />
            <NewTransactionProvider>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/lancamentos" element={<h1>Lançamentos</h1>} />
              </Routes>
            </NewTransactionProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const title = (month: string) =>
  screen.findByRole("button", { name: `${monthLabel(month)}, escolher outro mês` });
const address = (): string => screen.getByTestId("address").textContent ?? "";

beforeEach(() => {
  vi.resetAllMocks();
  answerEveryMonth();
  vi.mocked(authService.restoreSession).mockResolvedValue({
    name: "Marina Duarte",
    email: "marina@exemplo.com",
    status: "active",
    two_factor_enabled: false,
    ai_documents_consent: false,
    deletion_scheduled_at: null,
  });
  vi.mocked(accountsService.listAccounts).mockResolvedValue([]);
  vi.mocked(categoriesService.listCategories).mockResolvedValue({ expense: [], income: [] });
});

describe("DashboardPage", () => {
  it("mostra o mês atual: saldo do mês, entradas, saídas, contas e maiores gastos", async () => {
    renderPage();

    expect(await title(CURRENT)).toBeVisible();
    const balance = screen.getByRole("region", { name: "Saldo do mês" });
    expect(balance).toHaveTextContent("R$1.477,60");
    expect(balance).toHaveTextContent("você recebeu mais do que gastou");
    const flows = screen.getByRole("region", { name: "Entradas e saídas" });
    expect(flows).toHaveTextContent("EntradasR$ 5.450,00");
    expect(flows).toHaveTextContent("SaídasR$ 3.972,40");

    const accounts = screen.getByRole("heading", { name: "Contas" }).closest("section");
    expect(accounts).toHaveTextContent("Conta NubankConta correnteR$ 2.184,35");
    expect(accounts).toHaveTextContent("Cartão NubankCartão de crédito−R$ 1.243,80");

    const top = screen.getByRole("heading", { name: "Maiores gastos" }).closest("section");
    expect(top).toHaveTextContent("Aluguel");
    expect(top).toHaveTextContent("−R$ 1.580,00");
    expect(await screen.findByTestId("trend")).toHaveAttribute("data-month", CURRENT);
    for (const service of [getSummary, getCategories, getTrend, getTopExpenses]) {
      expect(service).toHaveBeenCalledWith(CURRENT, expect.anything());
    }
  });

  it("cada categoria mostra valor e percentual e abre os lançamentos dela no mês", async () => {
    const user = renderPage(`/?mes=${PREVIOUS}`);
    await title(PREVIOUS);

    const housing = screen.getByRole("link", { name: /Moradia/ });
    expect(housing).toHaveTextContent("R$ 2.846,00");
    expect(housing).toHaveTextContent("71,6% dos gastos");

    await user.click(housing);

    const range = monthRange(PREVIOUS);
    expect(address()).toBe(`/lancamentos?de=${range.from}&ate=${range.to}&categoria=${FOOD}`);
  });

  it("com mais de seis categorias, mostra as cinco maiores e junta o resto em Outras", async () => {
    const names = ["Moradia", "Alimentação", "Transporte", "Saúde", "Lazer", "Educação", "Pets"];
    getCategories.mockImplementation((month) =>
      Promise.resolve({
        month,
        total_cents: 280_000,
        // O percentual de cada categoria vem pronto da API, com uma casa.
        items: names.map((name, index) => {
          const amount = 70_000 - index * 10_000;
          return spending(index, name, amount, Math.round((amount * 1000) / 280_000) / 10);
        }),
      }),
    );
    renderPage();
    await title(CURRENT);

    const ranking = screen.getByRole("heading", { name: "Para onde foi o dinheiro" });
    const rows = within(ranking.closest("section") as HTMLElement).getAllByRole("link");

    expect(rows.map((row) => row.textContent?.match(/^[^R]+/)?.[0])).toEqual([
      "Moradia",
      "Alimentação",
      "Transporte",
      "Saúde",
      "Lazer",
      "Outras",
    ]);
    // Educação (R$ 200,00) e Pets (R$ 100,00) somados: R$ 300,00 de R$ 2.800,00.
    expect(rows[5]).toHaveTextContent("R$ 300,00");
    expect(rows[5]).toHaveTextContent("10,7% dos gastos · 2 categorias");
    expect(rows[5]).toHaveAttribute("href", "/lancamentos?tipo=expense");
  });

  it("categoria negativa por um estorno: mostra o valor, sem barra nem percentual", async () => {
    getCategories.mockImplementation((month) =>
      Promise.resolve({
        month,
        total_cents: 35_000,
        items: [
          spending(0, "Alimentação", 30_000, 75),
          spending(1, "Transporte", 10_000, 25),
          // O livro comprado no mês passado foi devolvido neste.
          spending(2, "Educação", -5_000, 0),
        ],
      }),
    );
    renderPage();
    await title(CURRENT);

    const ranking = screen.getByRole("heading", { name: "Para onde foi o dinheiro" });
    const rows = within(ranking.closest("section") as HTMLElement).getAllByRole("link");

    expect(rows[0]).toHaveTextContent("75,0% dos gastos");
    expect(rows[2]).toHaveTextContent("Educação");
    expect(rows[2]).toHaveTextContent("−R$ 50,00");
    expect(rows[2]).toHaveTextContent("Estornos maiores que os gastos do mês");
    expect(rows[2]).not.toHaveTextContent("% dos gastos");
  });

  it("mês no vermelho: o saldo leva o sinal de menos e a frase diz o que houve", async () => {
    renderPage(`/?mes=${PREVIOUS}`);
    await title(PREVIOUS);

    const balance = screen.getByRole("region", { name: "Saldo do mês" });
    expect(balance).toHaveTextContent("−R$2.760,00");
    expect(balance).toHaveTextContent("você gastou mais do que recebeu");
  });

  it("as setas trocam de mês, e todos os números passam a ser os do mês escolhido", async () => {
    const user = renderPage();
    await title(CURRENT);

    await user.click(screen.getByRole("button", { name: "Mês anterior" }));

    expect(await title(PREVIOUS)).toBeVisible();
    expect(address()).toBe(`/?mes=${PREVIOUS}`);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Saldo do mês" })).toHaveTextContent("2.760,00"),
    );
    for (const service of [getSummary, getCategories, getTrend, getTopExpenses]) {
      expect(service).toHaveBeenLastCalledWith(PREVIOUS, expect.anything());
    }

    await user.click(screen.getByRole("button", { name: "Próximo mês" }));

    expect(await title(CURRENT)).toBeVisible();
    expect(address()).toBe("/");
  });

  it("o título abre a escolha do mês, por ano, com a volta ao mês atual", async () => {
    const user = renderPage(`/?mes=${PREVIOUS}`);
    await user.click(await title(PREVIOUS));
    let picker = screen.getByRole("dialog", { name: "Escolher o mês" });
    const previousYear = Number(PREVIOUS.slice(0, 4)) - 1;

    await user.click(within(picker).getByRole("button", { name: "Ano anterior" }));
    await user.click(within(picker).getByRole("button", { name: "Março" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(address()).toBe(`/?mes=${previousYear}-03`);
    expect(getSummary).toHaveBeenLastCalledWith(`${previousYear}-03`, expect.anything());

    await user.click(await title(`${previousYear}-03`));
    picker = screen.getByRole("dialog", { name: "Escolher o mês" });
    expect(within(picker).getByRole("button", { name: "Março" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(picker).getByRole("button", { name: "Ir para o mês atual" }));

    expect(await title(CURRENT)).toBeVisible();
    expect(address()).toBe("/");
  });

  it("escolher um mês no gráfico muda o mês do painel", async () => {
    const user = renderPage();
    await title(CURRENT);

    await user.click(await screen.findByRole("button", { name: `gráfico: ${PREVIOUS}` }));

    expect(await title(PREVIOUS)).toBeVisible();
    expect(screen.getByRole("heading", { name: /^6 meses até / })).toBeInTheDocument();
  });

  it("mês fora do formato no endereço vale como o mês atual", async () => {
    renderPage("/?mes=2026-13");

    expect(await title(CURRENT)).toBeVisible();
    expect(getSummary).toHaveBeenCalledWith(CURRENT, expect.anything());
  });

  it("mês sem despesas: os cartões dizem isso em vez de mostrar listas vazias", async () => {
    getCategories.mockImplementation((month) =>
      Promise.resolve({ month, total_cents: 0, items: [] }),
    );
    getTopExpenses.mockImplementation((month) => Promise.resolve({ month, items: [] }));
    const user = renderPage();
    await title(CURRENT);

    expect(screen.getAllByText(/^Nenhuma despesa em /)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Lançar despesa" }));

    expect(await screen.findByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
  });

  it("fatura fechada a pagar: o aviso no topo diz o valor e o prazo e abre o pagamento", async () => {
    getCards.mockResolvedValue({ items: [cardToPay] });
    // A transferência precisa de uma conta de onde sair e do cartão em que entra.
    const base = {
      institution: null,
      initial_balance_cents: 0,
      initial_balance_date: `${CURRENT}-01`,
      archived: false,
    };
    vi.mocked(accountsService.listAccounts).mockResolvedValue([
      {
        ...base,
        id: "acc-1",
        type: "checking",
        name: "Conta Nubank",
        closing_day: null,
        due_day: null,
        balance_cents: 218_435,
      },
      {
        ...base,
        id: "acc-2",
        type: "credit_card",
        name: "Cartão Nubank",
        closing_day: 3,
        due_day: 10,
        balance_cents: -163_020,
      },
    ]);
    const user = renderPage();
    await title(CURRENT);

    const notice = screen.getByRole("region", { name: "Faturas a pagar" });
    expect(notice).toHaveTextContent("Fatura fechada: Cartão Nubank");
    expect(notice).toHaveTextContent(`R$ 1.243,80 · vence em 5 dias, em ${shortDate(DUE_DATE)}`);
    expect(within(notice).getByRole("link", { name: "Ver fatura: Cartão Nubank" })).toHaveAttribute(
      "href",
      `/cartoes?cartao=acc-2&fatura=${yearMonthOf(addDays(today(), -2))}`,
    );

    await user.click(within(notice).getByRole("button", { name: "Pagar fatura" }));

    expect(await screen.findByRole("dialog", { name: "Nova transferência" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Valor em reais" })).toHaveValue("1.243,80");
  });

  it("o aviso de fatura é de hoje: some ao olhar um mês que passou", async () => {
    getCards.mockResolvedValue({ items: [cardToPay] });
    renderPage(`/?mes=${PREVIOUS}`);
    await title(PREVIOUS);

    expect(screen.queryByRole("region", { name: "Faturas a pagar" })).toBeNull();
  });

  it("sem fatura a pagar, não há aviso; os cartões aparecem resumidos e levam à tela deles", async () => {
    getCards.mockResolvedValue({
      items: [{ ...cardToPay, payment: { closed_invoice: null, total_due_cents: 38_640 } }],
    });
    renderPage();
    await title(CURRENT);

    expect(screen.queryByRole("region", { name: "Faturas a pagar" })).toBeNull();
    const cards = screen.getByRole("heading", { name: "Cartões" }).closest("section");
    expect(cards).toHaveTextContent("Fatura atual · fecha em");
    expect(cards).toHaveTextContent("Parcelas futuras: R$ 700,00");
    expect(cards).toHaveTextContent("R$ 386,40");
    expect(
      within(cards as HTMLElement).getByRole("link", { name: /Cartão Nubank/ }),
    ).toHaveAttribute("href", "/cartoes?cartao=acc-2");
  });

  it("sem cartão, o painel não mostra o bloco de cartões", async () => {
    renderPage();
    await title(CURRENT);

    expect(screen.queryByRole("heading", { name: "Cartões" })).toBeNull();
  });

  it("falha ao carregar: diz o que fazer e tenta de novo", async () => {
    getSummary.mockRejectedValueOnce(
      new ApiError({
        status: 0,
        code: "network_error",
        message: "Não foi possível falar com o servidor. Confira sua conexão e tente de novo.",
      }),
    );
    const user = renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confira sua conexão e tente de novo.",
    );

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await title(CURRENT)).toBeVisible();
  });

  it("sem nenhum lançamento: boas-vindas com os primeiros passos, sem gráficos", async () => {
    countTransactions.mockResolvedValue(0);
    const user = renderPage();

    expect(
      await screen.findByRole("heading", { name: "Boas-vindas, Marina", level: 1 }),
    ).toBeVisible();
    // A conta já existe: o passo dela está feito, e a ação é a do passo seguinte.
    expect(screen.getByText("Cadastre uma conta")).toHaveTextContent("(feito)");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Faça seu primeiro lançamento",
    );
    expect(screen.getByRole("heading", { name: "Contas" })).toBeInTheDocument();
    expect(screen.queryByTestId("trend")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Para onde foi o dinheiro" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Fazer um lançamento" }));

    expect(await screen.findByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
  });
});

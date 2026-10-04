import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../../components/ui/Toast";
import * as categoriesService from "../services/categoriesService";
import type { Category, CategoryTree } from "../types";
import { CategoriesPage } from "./CategoriesPage";

vi.mock("../services/categoriesService");

const listCategories = vi.mocked(categoriesService.listCategories);
const createCategory = vi.mocked(categoriesService.createCategory);

function category(id: string, name: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    name,
    kind: "expense",
    parent_id: null,
    icon: "utensils",
    color: "caqui",
    is_fallback: false,
    archived: false,
    children: [],
    ...overrides,
  };
}

const child = (id: string, name: string, parent: string, overrides: Partial<Category> = {}) =>
  category(id, name, { parent_id: parent, ...overrides });

let tree: CategoryTree;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CategoriesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** A linha de uma categoria principal que tem subcategorias: é ela que abre e fecha. */
const toggleOf = (name: string): Promise<HTMLElement> =>
  screen.findByRole("button", { name: new RegExp(`^${name}\\s*\\d+ subcategoria`) });

beforeEach(() => {
  vi.resetAllMocks();
  tree = {
    expense: [
      category("cat-food", "Alimentação", {
        children: [
          child("cat-delivery", "Delivery", "cat-food"),
          child("cat-market", "Mercado", "cat-food"),
          child("cat-old", "Lanchonete", "cat-food", { archived: true }),
        ],
      }),
      category("cat-subs", "Assinaturas"),
      category("cat-care", "Autocuidado", {
        children: [child("cat-hair", "Cabeleireiro", "cat-care")],
      }),
      category("cat-other", "Outros", { is_fallback: true, color: "ardosia" }),
    ],
    income: [
      category("cat-extra", "Renda extra", {
        kind: "income",
        children: [child("cat-freela", "Freela", "cat-extra", { kind: "income" })],
      }),
      category("cat-salary", "Salário", { kind: "income" }),
    ],
  };
  listCategories.mockImplementation(() => Promise.resolve(tree));
});

describe("CategoriesPage", () => {
  it("mostra só as categorias principais, com quantas subcategorias cada uma tem", async () => {
    renderPage();

    const food = await toggleOf("Alimentação");
    // As arquivadas não contam: são duas ativas.
    expect(food).toHaveTextContent("Alimentação2 subcategorias");
    expect(food).toHaveAttribute("aria-expanded", "false");
    expect(await toggleOf("Autocuidado")).toHaveTextContent("1 subcategoria");
    expect(screen.getByRole("button", { name: "Assinaturas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outros" })).toBeInTheDocument();
    for (const name of ["Delivery", "Mercado", "Cabeleireiro"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("clicar em uma categoria principal abre as subcategorias dela, e clicar de novo fecha", async () => {
    const user = userEvent.setup();
    renderPage();
    const food = await toggleOf("Alimentação");

    await user.click(food);

    expect(food).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("list", { name: "Subcategorias de Alimentação" });
    expect(panel).toHaveAttribute("id", food.getAttribute("aria-controls"));
    expect(
      within(panel)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual(["Delivery", "Mercado"]);
    // Só a que foi clicada se abre, e nenhuma folha de edição aparece.
    expect(await toggleOf("Autocuidado")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Cabeleireiro" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(food);

    expect(food).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delivery" })).toBeNull());
  });

  it("o lápis edita a categoria principal sem abrir as subcategorias", async () => {
    const user = userEvent.setup();
    renderPage();
    const food = await toggleOf("Alimentação");

    await user.click(screen.getByRole("button", { name: "Editar Alimentação" }));

    const sheet = await screen.findByRole("dialog", { name: "Editar categoria" });
    expect(within(sheet).getByRole("textbox", { name: "Nome" })).toHaveValue("Alimentação");
    expect(food).toHaveAttribute("aria-expanded", "false");
  });

  it("uma subcategoria aberta e uma categoria sem subcategorias abrem a edição ao clicar", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await toggleOf("Alimentação"));

    await user.click(screen.getByRole("button", { name: "Mercado" }));
    const sheet = await screen.findByRole("dialog", { name: "Editar categoria" });
    expect(within(sheet).getByRole("textbox", { name: "Nome" })).toHaveValue("Mercado");
    await user.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Assinaturas" }));
    const second = await screen.findByRole("dialog", { name: "Editar categoria" });
    expect(within(second).getByRole("textbox", { name: "Nome" })).toHaveValue("Assinaturas");
  });

  it("as receitas se comportam do mesmo jeito", async () => {
    const user = userEvent.setup();
    renderPage();
    await toggleOf("Alimentação");

    await user.click(screen.getByRole("radio", { name: "Receitas" }));

    const extra = await toggleOf("Renda extra");
    expect(extra).toHaveTextContent("1 subcategoria");
    expect(screen.getByRole("button", { name: "Salário" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Freela" })).toBeNull();
    await user.click(extra);
    expect(screen.getByRole("button", { name: "Freela" })).toBeInTheDocument();
  });

  it("a subcategoria arquivada continua no grupo das arquivadas, com o nome completo", async () => {
    renderPage();
    await toggleOf("Alimentação");

    expect(screen.getByRole("button", { name: "Alimentação › Lanchonete" })).toBeInTheDocument();
  });

  it("uma subcategoria nova aparece logo: a categoria principal dela se abre", async () => {
    const user = userEvent.setup();
    const created = child("cat-bakery", "Padaria", "cat-subs");
    createCategory.mockImplementation(() => {
      const [food, subs, ...rest] = tree.expense as [Category, Category, ...Category[]];
      tree = { ...tree, expense: [food, { ...subs, children: [created] }, ...rest] };
      return Promise.resolve(created);
    });
    renderPage();
    await toggleOf("Alimentação");

    await user.click(screen.getByRole("button", { name: "Nova categoria" }));
    const sheet = await screen.findByRole("dialog", { name: "Nova categoria" });
    await user.type(within(sheet).getByRole("textbox", { name: "Nome" }), "Padaria");
    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: /Categoria principal/ }),
      "Assinaturas",
    );
    await user.click(within(sheet).getByRole("button", { name: "Criar categoria" }));

    // "Assinaturas" não tinha subcategorias: passa a ter uma, já à vista.
    const subs = await toggleOf("Assinaturas");
    await waitFor(() => expect(subs).toHaveAttribute("aria-expanded", "true"));
    expect(subs).toHaveTextContent("1 subcategoria");
    expect(screen.getByRole("button", { name: "Padaria" })).toBeInTheDocument();
  });
});

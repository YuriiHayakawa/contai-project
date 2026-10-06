// Tipos das rotas de Categorias (contracts/rest-api.md). Os nomes dos campos são os da API.

export type CategoryKind = "expense" | "income";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** Nulo em uma categoria principal; preenchido em uma subcategoria. */
  parent_id: string | null;
  /** Nome do ícone guardado no banco; um nome desconhecido é desenhado com o ícone neutro. */
  icon: string;
  /** Nome do token de cor da paleta, como `caqui`. */
  color: string;
  /** A "Outros" de cada tipo: não pode ser arquivada e mantém a cor neutra. */
  is_fallback: boolean;
  archived: boolean;
  /** Subcategorias, em ordem alfabética; vazio em uma subcategoria. */
  children: Category[];
}

/** Árvore de dois níveis por tipo, com a "Outros" por último. */
export interface CategoryTree {
  expense: Category[];
  income: Category[];
}

export interface CategoryCreateInput {
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  icon: string;
  color: string;
}

/** Na "Outros", a cor não é enviada: ela fica sempre na neutra. */
export interface CategoryUpdateInput {
  name: string;
  icon: string;
  color?: string;
}

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  expense: "Despesas",
  income: "Receitas",
};

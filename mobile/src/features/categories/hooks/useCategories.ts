import type { Category, CategoryKind, CategoryTree } from "@web/features/categories/types";
import { useQuery } from "@tanstack/react-query";

import { listCategories } from "../services/categories";

export const categoriesQueryKey = ["categories"] as const;

/** As categorias do usuário, só para leitura: o cadastro fica no site. */
export function useCategories() {
  return useQuery({
    queryKey: categoriesQueryKey,
    queryFn: ({ signal }) => listCategories(signal),
  });
}

/** Uma categoria que pode ser escolhida, com o nome completo: "Alimentação › Mercado". */
export interface CategoryOption {
  category: Category;
  label: string;
}

/** As categorias de um tipo, cada principal seguida das subcategorias, como no site. */
export function categoryOptions(
  tree: CategoryTree,
  kind: CategoryKind,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): CategoryOption[] {
  const usable = (category: Category): boolean => includeArchived || !category.archived;
  return tree[kind]
    .filter(usable)
    .flatMap((parent) => [
      { category: parent, label: parent.name },
      ...parent.children
        .filter(usable)
        .map((child) => ({ category: child, label: `${parent.name} › ${child.name}` })),
    ]);
}

/** Todas as categorias por id, com o nome completo, para as listas de lançamentos. */
export function categoriesById(tree: CategoryTree): Map<string, CategoryOption> {
  return new Map(
    [
      ...categoryOptions(tree, "expense", { includeArchived: true }),
      ...categoryOptions(tree, "income", { includeArchived: true }),
    ].map((option) => [option.category.id, option]),
  );
}

/** A "Outros" de um tipo, que recebe o que não tem categoria sugerida. */
export function fallbackCategory(tree: CategoryTree, kind: CategoryKind): Category | undefined {
  return tree[kind].find((category) => category.is_fallback);
}

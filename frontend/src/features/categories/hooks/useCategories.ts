import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  archiveCategory,
  createCategory,
  listCategories,
  unarchiveCategory,
  updateCategory,
} from "../services/categoriesService";
import type {
  Category,
  CategoryCreateInput,
  CategoryKind,
  CategoryTree,
  CategoryUpdateInput,
} from "../types";

export const categoriesQueryKey = ["categories"] as const;

interface UpdateCategoryVariables {
  id: string;
  input: CategoryUpdateInput;
}

/** Uma categoria que pode ser escolhida em um lançamento, com o nome completo dela. */
export interface CategoryOption {
  category: Category;
  /** "Alimentação" ou, em uma subcategoria, "Alimentação › Mercado". */
  label: string;
}

/** Categorias do usuário, em dois níveis por tipo. Inclui as arquivadas. */
export function useCategories() {
  return useQuery({ queryKey: categoriesQueryKey, queryFn: listCategories });
}

/** Nome completo de uma categoria, com o da principal na frente quando é subcategoria. */
export function categoryLabel(category: Category, parent?: Category): string {
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/**
 * Categorias de um tipo, na ordem da árvore: cada principal seguida das subcategorias. Sem
 * `includeArchived`, só entram as que podem receber lançamentos novos.
 */
export function categoryOptions(
  tree: CategoryTree,
  kind: CategoryKind,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): CategoryOption[] {
  const usable = (category: Category): boolean => includeArchived || !category.archived;
  return tree[kind].filter(usable).flatMap((parent) => [
    { category: parent, label: categoryLabel(parent) },
    ...parent.children.filter(usable).map((child) => ({
      category: child,
      label: categoryLabel(child, parent),
    })),
  ]);
}

/** Todas as categorias por id, com o nome completo, para as listas de lançamentos. */
export function categoriesById(tree: CategoryTree): Map<string, CategoryOption> {
  const options = [
    ...categoryOptions(tree, "expense", { includeArchived: true }),
    ...categoryOptions(tree, "income", { includeArchived: true }),
  ];
  return new Map(options.map((option) => [option.category.id, option]));
}

function useInvalidateCategories(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: categoriesQueryKey });
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (input: CategoryCreateInput) => createCategory(input),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, input }: UpdateCategoryVariables) => updateCategory(id, input),
    onSuccess: invalidate,
  });
}

export function useArchiveCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({ mutationFn: (id: string) => archiveCategory(id), onSuccess: invalidate });
}

export function useUnarchiveCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({ mutationFn: (id: string) => unarchiveCategory(id), onSuccess: invalidate });
}

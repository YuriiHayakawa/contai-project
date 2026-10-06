// Chamadas HTTP de categorias. Só os hooks desta feature chamam este módulo.
import { api } from "../../../lib/api-client";
import type { Category, CategoryCreateInput, CategoryTree, CategoryUpdateInput } from "../types";

/** A árvore inteira, com as arquivadas: os lançamentos antigos continuam mostrando a categoria. */
export function listCategories(): Promise<CategoryTree> {
  return api.get<CategoryTree>("/categories", { params: { include_archived: true } });
}

export function createCategory(input: CategoryCreateInput): Promise<Category> {
  return api.post<Category>("/categories", input);
}

export function updateCategory(id: string, input: CategoryUpdateInput): Promise<Category> {
  return api.patch<Category>(`/categories/${id}`, input);
}

/** Arquivar a categoria principal arquiva as subcategorias dela. */
export function archiveCategory(id: string): Promise<Category> {
  return api.post<Category>(`/categories/${id}/archive`);
}

export function unarchiveCategory(id: string): Promise<Category> {
  return api.post<Category>(`/categories/${id}/unarchive`);
}

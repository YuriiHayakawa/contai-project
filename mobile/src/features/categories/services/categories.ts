import type { CategoryTree } from "@web/features/categories/types";

import { api } from "@/lib/api-client";

/** As categorias em dois níveis por tipo, com as arquivadas. */
export function listCategories(signal?: AbortSignal): Promise<CategoryTree> {
  return api.get<CategoryTree>("/categories", { params: { include_archived: true }, signal });
}

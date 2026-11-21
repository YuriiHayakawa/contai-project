// Sugestões do formulário de lançamento (FR-009): a conta mais usada e a categoria pela
// descrição. São só pontos de partida, que o usuário vê e pode trocar; nada aqui calcula
// valores. A API não tem rota de sugestão de categoria, então a base são os últimos lançamentos.
import type { Account } from "@web/features/accounts/types";
import type { CategoryKind, CategoryTree } from "@web/features/categories/types";
import type { Transaction } from "@web/features/transactions/types";

import { categoryOptions, fallbackCategory } from "../categories/hooks/useCategories";

/** Quantos lançamentos recentes as sugestões olham. */
export const RECENT_LIMIT = 50;

/** Minúsculas, sem acentos e sem espaços nas pontas: "iFood " e "ifood" são a mesma loja. */
export function normalizeDescription(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** A conta mais frequente entre os últimos lançamentos, ou a primeira conta ativa. */
export function mostUsedAccountId(recent: Transaction[], accounts: Account[]): string | null {
  const active = new Set(accounts.filter((account) => !account.archived).map((a) => a.id));
  const counts = new Map<string, number>();
  for (const item of recent) {
    if (active.has(item.account_id)) {
      counts.set(item.account_id, (counts.get(item.account_id) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best ?? accounts.find((account) => !account.archived)?.id ?? null;
}

/**
 * A categoria do lançamento mais recente com a mesma descrição e do mesmo tipo, se ela ainda
 * puder ser usada; senão, a "Outros" do tipo.
 */
export function suggestCategoryId(
  description: string,
  kind: CategoryKind,
  recent: Transaction[],
  tree: CategoryTree,
): string | null {
  const usable = new Set(categoryOptions(tree, kind).map((option) => option.category.id));
  const wanted = normalizeDescription(description);
  if (wanted) {
    const match = recent.find(
      (item) =>
        item.type === kind &&
        item.category_id !== null &&
        usable.has(item.category_id) &&
        normalizeDescription(item.description) === wanted,
    );
    if (match?.category_id) return match.category_id;
  }
  return fallbackCategory(tree, kind)?.id ?? null;
}

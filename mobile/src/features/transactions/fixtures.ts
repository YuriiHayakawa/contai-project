// Dados dos testes de lançamentos.
import type { Account } from "@web/features/accounts/types";
import type { Category, CategoryTree } from "@web/features/categories/types";
import type { Transaction } from "@web/features/transactions/types";

function account(id: string, name: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    name,
    type: "checking",
    institution: null,
    initial_balance_cents: 0,
    initial_balance_date: "2026-01-01",
    closing_day: null,
    due_day: null,
    credit_limit_cents: null,
    archived: false,
    balance_cents: 0,
    ...extra,
  };
}

function category(id: string, name: string, extra: Partial<Category> = {}): Category {
  return {
    id,
    name,
    kind: "expense",
    parent_id: null,
    icon: "tag",
    color: "caqui",
    is_fallback: false,
    archived: false,
    children: [],
    ...extra,
  };
}

export const accounts: Account[] = [
  account("acc-nubank", "Nubank"),
  account("acc-inter", "Inter crédito", { type: "credit_card", closing_day: 7, due_day: 15 }),
  account("acc-old", "Conta antiga", { archived: true }),
];

export const categories: CategoryTree = {
  expense: [
    category("cat-food", "Alimentação", {
      children: [category("cat-market", "Mercado", { parent_id: "cat-food" })],
    }),
    category("cat-transport", "Transporte"),
    category("cat-other-exp", "Outros", { is_fallback: true }),
  ],
  income: [
    category("cat-salary", "Salário", { kind: "income" }),
    category("cat-other-inc", "Outros", { kind: "income", is_fallback: true }),
  ],
};

export function transaction(id: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: "expense",
    transfer_direction: null,
    amount_cents: 1000,
    date: "2026-11-10",
    description: "Padaria",
    notes: null,
    account_id: "acc-inter",
    category_id: "cat-food",
    transfer_group_id: null,
    installment_group_id: null,
    installment_number: null,
    installment_count: null,
    source: "manual",
    voice_phrase: null,
    created_at: "2026-11-10T12:00:00Z",
    ...extra,
  };
}

/** Os últimos lançamentos: o cartão é a conta mais usada, e "iFood" já foi em Alimentação. */
export const recent: Transaction[] = [
  transaction("t1", { description: "iFood", category_id: "cat-food", account_id: "acc-inter" }),
  transaction("t2", { description: "Uber", category_id: "cat-transport", account_id: "acc-inter" }),
  transaction("t3", { description: "Padaria", account_id: "acc-inter" }),
  transaction("t4", {
    description: "Mercado",
    category_id: "cat-market",
    account_id: "acc-nubank",
  }),
];

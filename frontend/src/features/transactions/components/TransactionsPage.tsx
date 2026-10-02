import { CalendarDays, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { Select, type SelectOption } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { cn } from "../../../lib/cn";
import { addMonths, monthLabel, monthName, monthRange, yearMonthOf } from "../../../lib/dates";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import {
  categoriesById,
  categoryOptions,
  useCategories,
  type CategoryOption,
} from "../../categories/hooks/useCategories";
import {
  ALL_PERIOD_PARAM,
  FILTER_PARAM as PARAM,
  SEARCH_MAX_LENGTH,
  readListView,
  wholeMonthOf,
  type FilterParamName as ParamName,
  type TransactionListView,
} from "../filters";
import { useNewTransaction } from "../hooks/useNewTransaction";
import { useTransactions } from "../hooks/useTransactions";
import type { Transaction } from "../types";
import { TransactionDetail } from "./TransactionDetail";
import { TransactionList } from "./TransactionList";
import { TransactionSheet } from "./TransactionSheet";

interface FilterSelectProps extends Omit<ComponentProps<"select">, "children"> {
  /** Nome do filtro para leitores de tela; na tela, o valor escolhido já diz o que é. */
  label: string;
  options: readonly SelectOption[];
  /** Ícone à esquerda do valor. */
  icon?: ReactNode;
}

const SEARCH_DELAY_MS = 300;
const RECENT_MONTHS = 12;
const ALL_PERIOD = "all";
const CUSTOM_PERIOD = "custom";

const typeOptions: readonly SelectOption[] = [
  { value: "", label: "Todos os tipos" },
  { value: "expense", label: "Despesas" },
  { value: "income", label: "Receitas" },
];

/** O valor do seletor de período: um mês, "todo o período" ou um intervalo livre. */
function periodOf({ filters, periodKind }: TransactionListView): string {
  if (periodKind === "all") return ALL_PERIOD;
  return wholeMonthOf(filters.from, filters.to) ?? CUSTOM_PERIOD;
}

function periodLabel(period: string): string {
  if (period === ALL_PERIOD) return "todo o período";
  if (period === CUSTOM_PERIOD) return "período escolhido";
  return monthLabel(period).toLowerCase();
}

/** Filtro da lista (seção 6.6): seleção nativa com contorno de controle, 44px e texto `label`. */
function FilterSelect({ label, options, icon, className, ...rest }: FilterSelectProps) {
  const id = useId();

  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {icon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3 text-ink-muted [&>svg]:size-4"
        >
          {icon}
        </span>
      )}
      <select
        {...rest}
        id={id}
        className={cn(
          "h-11 w-full appearance-none truncate rounded-sm bg-surface pr-9 text-label text-ink",
          "border-[1.5px] border-border-strong transition-colors duration-fast ease-out",
          "hover:bg-bg-sunken focus:border-primary",
          icon ? "pl-9" : "pl-3.5",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-3.5 right-3 size-4 text-ink-muted"
      />
    </div>
  );
}

/**
 * Lançamentos do usuário, com busca por texto, período e filtros de conta, categoria e tipo.
 * Até `sm`, os filtros ficam atrás do botão "Filtros"; a partir de `sm`, cada um tem o próprio
 * seletor. O período fica sempre visível e começa no mês atual.
 */
export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const openNewTransaction = useNewTransaction();
  const accounts = useAccounts();
  const categories = useCategories();

  const paramsKey = params.toString();
  const view = useMemo(() => readListView(new URLSearchParams(paramsKey)), [paramsKey]);
  const { filters, periodKind } = view;
  const transactions = useTransactions(filters);

  const urlSearch = filters.q ?? "";
  const [search, setSearch] = useState(urlSearch);
  // O endereço mudou por fora (voltar do navegador, limpar filtros): o campo acompanha.
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch);
    if (urlSearch !== search.trim()) setSearch(urlSearch);
  }

  const [customPeriodOpen, setCustomPeriodOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Ficam guardados depois de fechar, para as folhas não esvaziarem enquanto saem da tela.
  const [selected, setSelected] = useState<Transaction | undefined>(undefined);
  const [editing, setEditing] = useState<Transaction | undefined>(undefined);

  const setFilter = (changes: Partial<Record<ParamName, string | undefined>>): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value) next.set(name, value);
          else next.delete(name);
        }
        return next;
      },
      { replace: true },
    );
  };

  // A busca espera a pessoa parar de digitar antes de ir ao servidor.
  useEffect(() => {
    const text = search.trim();
    if (text === urlSearch) return;
    const timer = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (text) next.set(PARAM.search, text);
          else next.delete(PARAM.search);
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, urlSearch, setParams]);

  const clearFilters = (): void => {
    setSearch("");
    setCustomPeriodOpen(false);
    setParams({}, { replace: true });
  };

  // ---------- opções dos filtros

  const currentMonth = yearMonthOf();
  const period = customPeriodOpen ? CUSTOM_PERIOD : periodOf(view);
  const periodOptions = useMemo<SelectOption[]>(() => {
    const months = Array.from({ length: RECENT_MONTHS }, (_, index) =>
      addMonths(currentMonth, -index),
    );
    // Um mês fora da lista, vindo de um link, também precisa aparecer como escolhido.
    const selectedMonth = wholeMonthOf(filters.from, filters.to);
    if (selectedMonth && !months.includes(selectedMonth)) months.push(selectedMonth);
    return [
      ...months.map((month) => ({ value: month, label: monthLabel(month) })),
      { value: ALL_PERIOD, label: "Todo o período" },
      { value: CUSTOM_PERIOD, label: "Outro período…" },
    ];
  }, [currentMonth, filters.from, filters.to]);

  const accountOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "Todas as contas" },
      ...(accounts.data ?? []).map((account) => ({
        value: account.id,
        label: account.archived ? `${account.name} (arquivada)` : account.name,
      })),
    ],
    [accounts.data],
  );

  const categoryFilterOptions = useMemo<SelectOption[]>(() => {
    const tree = categories.data;
    if (!tree) return [{ value: "", label: "Todas as categorias" }];
    // Com o tipo escolhido, só as categorias dele; sem ele, as de receita vêm marcadas.
    const expense = filters.type === "income" ? [] : categoryOptions(tree, "expense");
    const income = filters.type === "expense" ? [] : categoryOptions(tree, "income");
    const mixed = expense.length > 0 && income.length > 0;
    return [
      { value: "", label: "Todas as categorias" },
      ...expense.map(({ category, label }) => ({ value: category.id, label })),
      ...income.map(({ category, label }) => ({
        value: category.id,
        label: mixed ? `${label} (receita)` : label,
      })),
    ];
  }, [categories.data, filters.type]);

  const accountsMap = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account])),
    [accounts.data],
  );
  const categoriesMap = useMemo(
    () => (categories.data ? categoriesById(categories.data) : new Map<string, CategoryOption>()),
    [categories.data],
  );

  // ---------- mudanças de filtro

  const changePeriod = (value: string): void => {
    if (value === CUSTOM_PERIOD) {
      // As datas do período de agora viram o ponto de partida do intervalo livre.
      setCustomPeriodOpen(true);
      setFilter({ [PARAM.from]: filters.from, [PARAM.to]: filters.to, [PARAM.period]: undefined });
      return;
    }
    setCustomPeriodOpen(false);
    // O mês atual é o padrão: não precisa de nada no endereço.
    const range = value === ALL_PERIOD || value === currentMonth ? undefined : monthRange(value);
    setFilter({
      [PARAM.from]: range?.from,
      [PARAM.to]: range?.to,
      [PARAM.period]: value === ALL_PERIOD ? ALL_PERIOD_PARAM : undefined,
    });
  };

  const changeDate = (name: typeof PARAM.from | typeof PARAM.to, value: string): void => {
    setFilter({ [name]: value, [PARAM.period]: undefined });
  };

  const changeType = (value: string): void => {
    // A categoria escolhida era do outro tipo: sai junto, para a lista não ficar vazia à toa.
    const chosen = filters.category_id ? categoriesMap.get(filters.category_id) : undefined;
    const keepCategory = !value || !chosen || chosen.category.kind === value;
    setFilter({
      [PARAM.type]: value,
      [PARAM.category]: keepCategory ? filters.category_id : undefined,
    });
  };

  const extraFilterCount = [filters.account_id, filters.category_id, filters.type].filter(
    Boolean,
  ).length;
  // O mês atual é o ponto de partida da lista, e não um filtro escolhido.
  const hasFilters = Boolean(filters.q) || periodKind !== "default" || extraFilterCount > 0;

  const accountFilter = {
    label: "Conta",
    options: accountOptions,
    value: filters.account_id ?? "",
    onChange: (value: string) => setFilter({ [PARAM.account]: value }),
  };
  const categoryFilter = {
    label: "Categoria",
    options: categoryFilterOptions,
    value: filters.category_id ?? "",
    onChange: (value: string) => setFilter({ [PARAM.category]: value }),
  };
  const typeFilter = {
    label: "Tipo",
    options: typeOptions,
    value: filters.type ?? "",
    onChange: changeType,
  };
  const extraFilters = [accountFilter, categoryFilter, typeFilter];

  const pages = transactions.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items), [pages]);

  return (
    <PageContent>
      <PageHeader title="Lançamentos" />

      <div className="relative">
        <label htmlFor="busca-lancamentos" className="sr-only">
          Buscar lançamentos
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3.5 size-5 text-ink-subtle"
        />
        <input
          id="busca-lancamentos"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Buscar por descrição"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={cn(
            "h-12 w-full rounded-md bg-surface pr-3.5 pl-11 text-body text-ink",
            "border-[1.5px] border-border-strong transition-colors duration-fast ease-out",
            "focus:border-primary",
          )}
        />
      </div>

      <div className="mt-3 mb-5 grid gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label="Período"
            icon={<CalendarDays />}
            options={periodOptions}
            value={period}
            onChange={(event) => changePeriod(event.target.value)}
            className="min-w-0 flex-1 sm:max-w-56 sm:flex-none"
          />
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(true)}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm bg-surface px-3.5",
              "border-[1.5px] border-border-strong text-label text-ink sm:hidden",
              "transition-colors duration-fast ease-out hover:bg-bg-sunken",
            )}
          >
            <SlidersHorizontal aria-hidden="true" className="size-4 text-ink-muted" />
            {extraFilterCount > 0 ? `Filtros (${extraFilterCount})` : "Filtros"}
          </button>
          {extraFilters.map((filter) => (
            <FilterSelect
              key={filter.label}
              label={filter.label}
              options={filter.options}
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
              className="hidden max-w-52 sm:block"
            />
          ))}
        </div>

        {period === CUSTOM_PERIOD && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="De"
              type="date"
              max={filters.to}
              value={filters.from ?? ""}
              onChange={(event) => changeDate(PARAM.from, event.target.value)}
            />
            <TextField
              label="Até"
              type="date"
              min={filters.from}
              value={filters.to ?? ""}
              onChange={(event) => changeDate(PARAM.to, event.target.value)}
            />
          </div>
        )}
      </div>

      <TransactionList
        label={`Lançamentos de ${periodLabel(period)}`}
        transactions={items}
        totalCount={pages?.[0]?.total_count ?? 0}
        accounts={accountsMap}
        categories={categoriesMap}
        error={transactions.error}
        onRetry={() => void transactions.refetch()}
        empty={
          hasFilters ? (
            <EmptyState
              kind="no-results"
              title="Nenhum lançamento encontrado"
              description="Nada combina com a busca e os filtros de agora. Mude algum deles ou limpe tudo."
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              kind="first-time"
              title={`Nada lançado em ${monthName(currentMonth)}`}
              description="Anote uma despesa ou uma receita, ou escolha outro período para ver os lançamentos de antes."
              actionLabel="Lançar"
              onAction={openNewTransaction}
            />
          )
        }
        onSelect={(transaction) => {
          setSelected(transaction);
          setDetailOpen(true);
        }}
        hasMore={transactions.hasNextPage}
        loadingMore={transactions.isFetchingNextPage}
        onLoadMore={() => void transactions.fetchNextPage()}
      />

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtros"
        footer={
          <>
            <Button onClick={() => setFiltersOpen(false)}>Ver lançamentos</Button>
            <Button
              variant="secondary"
              disabled={!hasFilters}
              onClick={() => {
                clearFilters();
                setFiltersOpen(false);
              }}
            >
              Limpar filtros
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {extraFilters.map((filter) => (
            <Select
              key={filter.label}
              label={filter.label}
              options={filter.options}
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
            />
          ))}
        </div>
      </Modal>

      <TransactionDetail
        open={detailOpen}
        transaction={selected}
        account={selected ? accountsMap.get(selected.account_id) : undefined}
        category={selected?.category_id ? categoriesMap.get(selected.category_id) : undefined}
        onClose={() => setDetailOpen(false)}
        onEdit={(transaction) => {
          setDetailOpen(false);
          setEditing(transaction);
          setEditorOpen(true);
        }}
      />
      <TransactionSheet
        open={editorOpen}
        transaction={editing}
        onClose={() => setEditorOpen(false)}
      />
    </PageContent>
  );
}

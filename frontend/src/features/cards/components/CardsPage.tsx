import { Check, CreditCard } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { PageSkeleton } from "../../../components/layout/PageSkeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { CARD_PARAM, INVOICE_PARAM, paths } from "../../../lib/paths";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import type { CardSummary } from "../../dashboard/types";
import { useNewTransaction } from "../../transactions/hooks/useNewTransaction";
import { invoicePaymentPreset } from "../../transactions/presets";
import { useCardInvoices, useCards } from "../hooks/useCards";
import { cardStanding, initialInvoice, invoiceKey, type CardStanding } from "../invoices";
import type { CardInvoice } from "../types";
import { CardInstallments } from "./CardInstallments";
import { InvoiceCategories } from "./InvoiceCategories";
import { InvoicePanel } from "./InvoicePanel";
import { InvoiceTabs } from "./InvoiceTabs";
import { InvoiceTransactions } from "./InvoiceTransactions";

interface CardPickerProps {
  cards: readonly CardSummary[];
  selected: CardSummary;
  onSelect: (card: CardSummary) => void;
}

interface CardInvoicesViewProps {
  card: CardSummary;
  /** Mês de fechamento da fatura pedida no endereço; sem ele, a tela escolhe. */
  requestedInvoice: string | null;
  onSelectInvoice: (invoice: CardInvoice) => void;
}

const TITLE = "Cartões";

const STANDING_LABELS: Record<CardStanding, string> = {
  overdue: "Fatura vencida",
  due: "Fatura a pagar",
  clear: "Em dia",
};

/** Com mais de um cartão: a escolha de qual ver, já dizendo como cada um está. */
function CardPicker({ cards, selected, onSelect }: CardPickerProps) {
  return (
    <div role="group" aria-label="Cartão" className="mb-4 flex flex-wrap gap-2">
      {cards.map((card) => {
        const active = card.account_id === selected.account_id;
        return (
          <button
            key={card.account_id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(card)}
            className={cn(
              "flex min-h-14 min-w-40 flex-1 items-center gap-3 rounded-md border-[1.5px] px-3.5 py-2",
              "text-left transition-colors duration-fast ease-out sm:flex-none",
              active
                ? "border-primary bg-primary-soft"
                : "border-border-strong bg-surface hover:bg-bg-sunken",
            )}
          >
            <span className="grid min-w-0 flex-1">
              <span
                className={cn("truncate text-body font-bold", active ? "text-primary" : "text-ink")}
              >
                {card.name}
              </span>
              <span className="truncate text-small text-ink-muted">
                {STANDING_LABELS[cardStanding(card.payment)]}
              </span>
            </span>
            {/* A marca diz qual está escolhido sem depender da cor. */}
            {active && <Check aria-hidden="true" className="size-5 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}

/** As faturas de um cartão: as abas, a fatura escolhida, os lançamentos dela e o que vem. */
function CardInvoicesView({ card, requestedInvoice, onSelectInvoice }: CardInvoicesViewProps) {
  const openNewTransaction = useNewTransaction();
  const accounts = useAccounts();
  const invoices = useCardInvoices(card.account_id);

  if (invoices.data === undefined) {
    if (invoices.isError) {
      return (
        <EmptyState
          kind="error"
          title="Não foi possível carregar as faturas"
          description={errorMessage(invoices.error)}
          onAction={() => void invoices.refetch()}
        />
      );
    }
    return (
      <div className="rounded-lg border border-border bg-surface">
        <SkeletonList rows={3} label="Carregando as faturas…" />
      </div>
    );
  }

  const { items, payment } = invoices.data;
  const invoice =
    items.find((item) => invoiceKey(item) === requestedInvoice) ?? initialInvoice(items);
  if (!invoice) return null;
  const previous = items[items.indexOf(invoice) - 1];

  const pay = (): void => {
    // A fatura fica no endereço: depois de pagar, a tela continua nela, agora como paga, em
    // vez de pular para a atual.
    onSelectInvoice(invoice);
    openNewTransaction(invoicePaymentPreset({ id: card.account_id, name: card.name, payment }));
  };

  return (
    <div
      className={cn(
        "grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start",
        // A coluna lateral atravessa as duas linhas; o que sobrar dela fica na de baixo.
        "lg:grid-rows-[auto_1fr]",
      )}
    >
      <div className="rounded-lg border border-border bg-surface lg:col-start-1">
        <InvoiceTabs invoices={items} selected={invoice} onSelect={onSelectInvoice} />
        <InvoicePanel
          invoice={invoice}
          previous={previous}
          payment={payment}
          account={accounts.data?.find((account) => account.id === card.account_id)}
          onPay={pay}
        />
      </div>
      {/* No celular, os lançamentos vêm por último: a lista não tem fim marcado. */}
      <div className="grid gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <InvoiceCategories cardId={card.account_id} invoice={invoice} />
        <CardInstallments card={card} />
      </div>
      <div className="lg:col-start-1 lg:row-start-2">
        <InvoiceTransactions cardId={card.account_id} invoice={invoice} />
      </div>
    </div>
  );
}

/**
 * Cartões: a casa de cada cartão de crédito. Mostra as faturas, da primeira com compra até a
 * última com parcela, com o estado de cada uma; a tela abre na que está a pagar e, sem
 * nenhuma, na atual. "Pagar fatura" está sempre à vista. O cartão e a fatura ficam no
 * endereço, para um link do painel abrir direto neles.
 */
export function CardsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const cards = useCards();

  const items = cards.data?.items;
  if (items === undefined) {
    if (!cards.isError) return <PageSkeleton wide />;
    return (
      <PageContent wide>
        <PageHeader title={TITLE} />
        <EmptyState
          kind="error"
          title="Não foi possível carregar seus cartões"
          description={errorMessage(cards.error)}
          onAction={() => void cards.refetch()}
        />
      </PageContent>
    );
  }

  const requestedCard = params.get(CARD_PARAM);
  const card = items.find((item) => item.account_id === requestedCard) ?? items[0];
  if (!card) {
    return (
      <PageContent>
        <PageHeader title={TITLE} />
        <EmptyState
          kind="first-time"
          icon={CreditCard}
          title="Nenhum cartão cadastrado"
          description="Cadastre um cartão de crédito em Contas para acompanhar as faturas aqui."
          actionLabel="Ir para Contas"
          onAction={() => void navigate(paths.accounts)}
        />
      </PageContent>
    );
  }

  // Trocar de cartão ou de fatura não empilha no histórico: "voltar" sai da tela.
  const selectCard = (next: CardSummary): void => {
    setParams({ [CARD_PARAM]: next.account_id }, { replace: true });
  };
  const selectInvoice = (invoice: CardInvoice): void => {
    setParams(
      { [CARD_PARAM]: card.account_id, [INVOICE_PARAM]: invoiceKey(invoice) },
      { replace: true },
    );
  };

  return (
    <PageContent wide>
      <PageHeader title={TITLE} />
      {items.length > 1 && <CardPicker cards={items} selected={card} onSelect={selectCard} />}
      <p className="mb-4 text-small text-ink-muted">
        <span className="font-bold text-ink">{card.name}</span> · fecha todo dia {card.closing_day}{" "}
        · vence todo dia {card.due_day}
      </p>
      <CardInvoicesView
        key={card.account_id}
        card={card}
        requestedInvoice={params.get(INVOICE_PARAM)}
        onSelectInvoice={selectInvoice}
      />
    </PageContent>
  );
}

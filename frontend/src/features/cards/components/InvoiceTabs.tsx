import { ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { invoiceKey, invoiceMonth, invoiceTabLabel, statusLabel } from "../invoices";
import type { CardInvoice, InvoiceStatus } from "../types";

export interface InvoiceTabsProps {
  /** Da mais antiga para a mais nova. */
  invoices: readonly CardInvoice[];
  selected: CardInvoice;
  onSelect: (invoice: CardInvoice) => void;
}

// Quantas faturas ficam à vista: a escolhida fica no meio, com as vizinhas dos dois lados.
const NARROW_TABS = 3;
const WIDE_TABS = 5;

// O estado vem escrito; a cor só reforça. Vencida é alerta, e não erro.
const STATUS_TONE: Record<InvoiceStatus, string> = {
  paid: "text-income",
  due: "text-ink",
  overdue: "text-warning",
  open: "text-ink-muted",
  future: "text-ink-muted",
};

/** Fechada e sem compras não é uma conquista: fica na tinta secundária, como a aberta. */
function tone(invoice: CardInvoice): string {
  if (invoice.status === "paid" && invoice.amount_cents === 0) return "text-ink-muted";
  return STATUS_TONE[invoice.status];
}

/** Primeira posição de uma janela de `size` abas com a escolhida no meio, sem sair da lista. */
function windowStart(index: number, size: number, total: number): number {
  return Math.max(0, Math.min(index - Math.floor(size / 2), total - size));
}

/**
 * As faturas do cartão em abas, com o mês do vencimento e o estado de cada uma. As setas
 * passam para a fatura anterior e a seguinte; no celular cabem três abas e, a partir de `sm`,
 * cinco.
 */
export function InvoiceTabs({ invoices, selected, onSelect }: InvoiceTabsProps) {
  const index = Math.max(
    0,
    invoices.findIndex((invoice) => invoice.closing_date === selected.closing_date),
  );
  const wideStart = windowStart(index, WIDE_TABS, invoices.length);
  const narrowStart = windowStart(index, NARROW_TABS, invoices.length);
  const previous = invoices[index - 1];
  const next = invoices[index + 1];

  return (
    <nav aria-label="Faturas" className="flex items-stretch border-b border-border">
      <IconButton
        aria-label="Fatura anterior"
        disabled={!previous}
        onClick={() => previous && onSelect(previous)}
        className="my-1.5 ml-1"
      >
        <ChevronLeft />
      </IconButton>
      {/* As abas dividem a largura; com poucas faturas, não se esticam além de 176px. */}
      <ul className="flex min-w-0 flex-1">
        {invoices.slice(wideStart, wideStart + WIDE_TABS).map((invoice, offset) => {
          const position = wideStart + offset;
          const current = position === index;
          const narrow = position >= narrowStart && position < narrowStart + NARROW_TABS;
          return (
            <li
              key={invoiceKey(invoice)}
              className={cn("min-w-0 flex-1 basis-0 sm:max-w-44", !narrow && "hidden sm:block")}
            >
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                aria-label={`Fatura de ${invoiceMonth(invoice)}: ${statusLabel(invoice).toLowerCase()}`}
                onClick={() => onSelect(invoice)}
                className={cn(
                  "-mb-px grid h-full min-h-14 w-full content-center gap-0.5 px-2 text-left",
                  "border-b-[3px] transition-colors duration-fast ease-out hover:bg-bg-sunken",
                  current ? "border-primary" : "border-transparent",
                )}
              >
                <span
                  className={cn(
                    "truncate text-label",
                    current ? "font-bold text-primary" : "text-ink-muted",
                  )}
                >
                  {/* O nome inteiro não cabe em três abas no celular. */}
                  <span className="sm:hidden">{invoiceTabLabel(invoice, "short")}</span>
                  <span className="hidden sm:inline">{invoiceTabLabel(invoice)}</span>
                </span>
                <span className={cn("truncate text-micro", tone(invoice))}>
                  {statusLabel(invoice)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <IconButton
        aria-label="Próxima fatura"
        disabled={!next}
        onClick={() => next && onSelect(next)}
        className="my-1.5 mr-1"
      >
        <ChevronRight />
      </IconButton>
    </nav>
  );
}

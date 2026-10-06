import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { cn } from "../../../lib/cn";
import { addMonths, monthLabel, monthName, yearMonthOf, type YearMonth } from "../../../lib/dates";

export interface PeriodPickerProps {
  /** Mês exibido no painel. */
  month: YearMonth;
  onChange: (month: YearMonth) => void;
}

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Cabeçalho do painel (seção 6.9 do design-system.md): o título é o mês exibido e funciona como
 * botão para escolher outro; as setas de mês anterior e próximo aparecem a partir de 480px. O
 * painel escolhe só o mês, sem intervalo de datas (FR-059).
 */
export function PeriodPicker({ month, onChange }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const currentMonth = yearMonthOf();

  const openPicker = (): void => {
    setYear(Number(month.slice(0, 4)));
    setOpen(true);
  };

  const choose = (chosen: YearMonth): void => {
    setOpen(false);
    onChange(chosen);
  };

  return (
    <header className="mb-5 flex min-h-11 items-center justify-between gap-3">
      <h1 className="min-w-0 font-display text-title-1 text-ink">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${monthLabel(month)}, escolher outro mês`}
          onClick={openPicker}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-left"
        >
          {monthLabel(month)}
          <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
        </button>
      </h1>
      <div className="hidden items-center gap-1 min-[480px]:flex">
        <IconButton aria-label="Mês anterior" onClick={() => onChange(addMonths(month, -1))}>
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <IconButton aria-label="Próximo mês" onClick={() => onChange(addMonths(month, 1))}>
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Escolher o mês"
        footer={
          <Button
            variant="secondary"
            disabled={month === currentMonth}
            onClick={() => choose(currentMonth)}
          >
            Ir para o mês atual
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-3">
          <IconButton aria-label="Ano anterior" onClick={() => setYear(year - 1)}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <p aria-live="polite" className="money text-title-3 text-ink">
            {year}
          </p>
          <IconButton aria-label="Próximo ano" onClick={() => setYear(year + 1)}>
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </div>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {MONTH_NUMBERS.map((number) => {
            const option: YearMonth = `${year}-${number}`;
            const selected = option === month;
            return (
              <li key={number}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-center rounded-md px-1 text-label",
                    "transition-colors duration-fast ease-out",
                    selected ? "bg-primary text-on-primary" : "text-ink hover:bg-bg-sunken",
                    // O mês de hoje leva um contorno, para servir de referência ao navegar.
                    option === currentMonth && !selected && "border-[1.5px] border-border-strong",
                  )}
                >
                  {capitalized(monthName(option))}
                  {option === currentMonth && <span className="sr-only"> (mês atual)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </header>
  );
}

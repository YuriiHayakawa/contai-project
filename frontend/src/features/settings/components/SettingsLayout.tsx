import type { LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../../../lib/cn";

export interface SettingsGroup {
  /** Identifica a aba e liga o botão ao seu painel. */
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

export interface SettingsLayoutProps {
  groups: SettingsGroup[];
  /** Aba aberta; o estado fica na página, para o cabeçalho também poder trocá-la. */
  active: string;
  onSelect: (id: string) => void;
}

/**
 * Painel de configurações em abas: a partir de `lg`, a lista de seções fica numa coluna fixa à
 * esquerda; no celular, vira uma fileira de atalhos no topo. Clicar numa seção mostra só o
 * conteúdo dela — nada de rolar a página inteira. Segue o padrão de abas (setas do teclado
 * trocam a seção; Home e End vão à primeira e à última).
 */
export function SettingsLayout({ groups, active, onSelect }: SettingsLayoutProps) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = groups.findIndex((group) => group.id === active);
    const last = groups.length - 1;
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = current >= last ? 0 : current + 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = current <= 0 ? last : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const group = groups[next];
    if (!group) return;
    onSelect(group.id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div
        role="tablist"
        aria-label="Seções das configurações"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className={cn(
          "mb-6 flex gap-1 overflow-x-auto pb-1",
          "lg:sticky lg:top-8 lg:mb-0 lg:flex-col lg:overflow-visible lg:pb-0",
        )}
      >
        {groups.map((group, index) => {
          const Icon = group.icon;
          const selected = active === group.id;
          return (
            <button
              key={group.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${group.id}`}
              aria-selected={selected}
              aria-controls={`panel-${group.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(group.id)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-label font-bold",
                "transition-colors duration-fast ease-out",
                selected ? "bg-primary-soft text-primary" : "text-ink-muted hover:bg-bg-sunken",
              )}
            >
              <Icon aria-hidden="true" className="size-[18px]" />
              {group.label}
            </button>
          );
        })}
      </div>

      <div className="min-w-0">
        {groups.map((group) => (
          <section
            key={group.id}
            role="tabpanel"
            id={`panel-${group.id}`}
            aria-labelledby={`tab-${group.id}`}
            hidden={active !== group.id}
          >
            <h2 className="mb-4 font-display text-title-2 text-ink">{group.label}</h2>
            <div className="grid gap-5">{group.content}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

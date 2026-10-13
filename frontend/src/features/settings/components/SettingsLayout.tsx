import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "../../../lib/cn";

export interface SettingsGroup {
  /** Âncora da seção; é o alvo do item de navegação. */
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

export interface SettingsLayoutProps {
  groups: SettingsGroup[];
}

/**
 * Painel de configurações em duas colunas: a partir de `lg`, uma navegação lateral fixa marca a
 * seção em que a pessoa está e leva até ela; no celular, a navegação vira uma fileira de atalhos
 * e as seções empilham. Tudo continua visível — a navegação só rola até cada parte.
 */
export function SettingsLayout({ groups }: SettingsLayoutProps) {
  const [active, setActive] = useState(groups[0]?.id ?? "");

  // Marca como ativa a seção mais acima na tela enquanto a página rola (scrollspy).
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = groups
      .map((group) => document.getElementById(group.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActive(topmost.target.id);
      },
      { rootMargin: "-88px 0px -62% 0px", threshold: 0 },
    );
    sections.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [groups]);

  const goTo = (id: string): void => {
    const element = document.getElementById(id);
    if (!element) return;
    setActive(id);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav
        aria-label="Seções das configurações"
        className={cn(
          "mb-6 flex gap-1 overflow-x-auto pb-1",
          "lg:sticky lg:top-8 lg:mb-0 lg:flex-col lg:overflow-visible lg:pb-0",
        )}
      >
        {groups.map((group) => {
          const Icon = group.icon;
          const isActive = active === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => goTo(group.id)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-label font-bold",
                "transition-colors duration-fast ease-out",
                isActive ? "bg-primary-soft text-primary" : "text-ink-muted hover:bg-bg-sunken",
              )}
            >
              <Icon aria-hidden="true" className="size-[18px]" />
              {group.label}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-10">
        {groups.map((group) => (
          <section
            key={group.id}
            id={group.id}
            aria-labelledby={`${group.id}-title`}
            className="scroll-mt-6 lg:scroll-mt-8"
          >
            <h2 id={`${group.id}-title`} className="mb-4 font-display text-title-2 text-ink">
              {group.label}
            </h2>
            <div className="grid gap-5">{group.content}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

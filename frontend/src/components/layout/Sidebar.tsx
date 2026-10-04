import { ChevronDown, LogOut, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { cn } from "../../lib/cn";
import { paths } from "../../lib/paths";
import { breakpoints, useMediaQuery } from "../../lib/useMediaQuery";
import { Button } from "../ui/Button";
import { settingsItem, sidebarItems, type NavItem } from "./navigation";

export interface SidebarProps {
  userName: string;
  /** Abre a folha de novo lançamento. */
  onNewTransaction: () => void;
  /** Sai da conta; o item "Sair" só aparece quando informado. */
  onSignOut?: () => void;
  /** O histórico de conversas, que a seta do item "Assistente" abre embaixo dele. */
  assistantHistory?: ReactNode;
}

interface SideLinkProps {
  item: NavItem;
  className?: string;
}

interface ExpandableLinkProps {
  item: NavItem;
  /** Nome do que a seta abre, para leitores de tela. */
  label: string;
  /** O que aparece embaixo do item, aberto. */
  children: ReactNode;
}

// Fica só neste aparelho: quem gosta do histórico aberto o encontra aberto na próxima visita.
const HISTORY_OPEN_STORAGE_KEY = "contai-assistant-history-open";

function readHistoryOpen(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberHistoryOpen(open: boolean): void {
  try {
    if (open) window.localStorage.setItem(HISTORY_OPEN_STORAGE_KEY, "1");
    else window.localStorage.removeItem(HISTORY_OPEN_STORAGE_KEY);
  } catch {
    // Sem armazenamento, a escolha vale só até recarregar a página.
  }
}

const itemClass =
  "relative flex h-11 items-center gap-3 rounded-md px-3 text-label " +
  "transition-colors duration-fast ease-out";

function SideLink({ item, className }: SideLinkProps) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          itemClass,
          className,
          isActive
            ? // A barra de 3px à esquerda marca o item ativo além da cor.
              "bg-primary-soft text-primary before:absolute before:inset-y-2.5 before:left-0 " +
                "before:w-0.75 before:rounded-sm before:bg-primary"
            : "text-ink-muted hover:bg-bg-sunken",
        )
      }
    >
      <item.icon aria-hidden="true" className="size-5" />
      {item.label}
    </NavLink>
  );
}

/**
 * Item com uma seta à direita, que abre uma lista embaixo dele: o histórico de conversas no
 * "Assistente". O item continua levando à tela; só a seta abre e fecha.
 */
function ExpandableLink({ item, label, children }: ExpandableLinkProps) {
  const panelId = useId();
  const [open, setOpen] = useState(readHistoryOpen);
  const { pathname } = useLocation();
  // A barra lateral existe no celular, escondida: ali a lista não é montada nem consultada.
  const visible = useMediaQuery(breakpoints.lg);
  const active = pathname.startsWith(item.to);

  const toggle = (): void => {
    rememberHistoryOpen(!open);
    setOpen(!open);
  };

  return (
    <>
      <div className="relative">
        <SideLink item={item} className="pr-11" />
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={toggle}
          className={cn(
            "absolute top-1 right-1 flex size-9 items-center justify-center rounded-md",
            "transition-colors duration-fast ease-out",
            active ? "text-primary hover:bg-surface" : "text-ink-muted hover:bg-bg-sunken",
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 transition-transform duration-fast ease-out",
              open && "rotate-180",
            )}
          />
        </button>
      </div>
      {open && visible && (
        // A linha à esquerda liga a lista ao item, como em uma árvore.
        <div id={panelId} className="mt-1 ml-5 border-l border-border pl-1">
          {children}
        </div>
      )}
    </>
  );
}

/** Barra lateral (a partir de `lg`): fixa à esquerda, com 248px, sobre o próprio fundo. */
export function Sidebar({ userName, onNewTransaction, onSignOut, assistantHistory }: SidebarProps) {
  return (
    <nav
      aria-label="Principal"
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden w-62 flex-col gap-6 overflow-y-auto",
        "border-r border-border px-4 pt-7 pb-5 lg:flex",
      )}
    >
      <Link
        to={paths.home}
        className="self-start rounded-sm px-3 font-display text-display font-extrabold text-primary"
      >
        Contaí
      </Link>

      <Button icon={<Plus />} onClick={onNewTransaction}>
        Novo lançamento
      </Button>

      {/* Só esta parte rola: com o histórico de conversas aberto e comprido, a marca e o
          botão em cima e a conta embaixo continuam à vista. A folga lateral é do contorno de
          foco, que a área de rolagem cortaria. */}
      <ul
        className={cn(
          "-mx-1 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-1",
          "overflow-y-auto px-1",
        )}
      >
        {sidebarItems.map((item) => (
          // Sem a largura mínima zerada, um título longo do histórico alargaria a barra inteira.
          <li key={item.to} className="min-w-0">
            {item.to === paths.assistant && assistantHistory ? (
              <ExpandableLink item={item} label="Histórico de conversas">
                {assistantHistory}
              </ExpandableLink>
            ) : (
              <SideLink item={item} />
            )}
          </li>
        ))}
      </ul>

      <div className="grid gap-1 border-t border-border pt-3">
        <p className="flex items-center gap-3 px-3 py-2">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              "bg-primary font-bold text-on-primary",
            )}
          >
            {userName.trim().charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-label text-ink">{userName}</span>
        </p>
        <SideLink item={settingsItem} />
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className={cn(itemClass, "text-ink-muted hover:bg-bg-sunken")}
          >
            <LogOut aria-hidden="true" className="size-5" />
            Sair
          </button>
        )}
      </div>
    </nav>
  );
}

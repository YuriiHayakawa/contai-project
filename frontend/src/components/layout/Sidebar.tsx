import { LogOut, Plus } from "lucide-react";
import { Link, NavLink } from "react-router";

import { cn } from "../../lib/cn";
import { paths } from "../../lib/paths";
import { Button } from "../ui/Button";
import { settingsItem, sidebarItems, type NavItem } from "./navigation";

export interface SidebarProps {
  userName: string;
  /** Abre a folha de novo lançamento. */
  onNewTransaction: () => void;
  /** Sai da conta; o item "Sair" só aparece quando informado. */
  onSignOut?: () => void;
}

interface SideLinkProps {
  item: NavItem;
}

const itemClass =
  "relative flex h-11 items-center gap-3 rounded-md px-3 text-label " +
  "transition-colors duration-fast ease-out";

function SideLink({ item }: SideLinkProps) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          itemClass,
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

/** Barra lateral (a partir de `lg`): fixa à esquerda, com 248px, sobre o próprio fundo. */
export function Sidebar({ userName, onNewTransaction, onSignOut }: SidebarProps) {
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

      <ul className="grid gap-1">
        {sidebarItems.map((item) => (
          <li key={item.to}>
            <SideLink item={item} />
          </li>
        ))}
      </ul>

      <div className="mt-auto grid gap-1 border-t border-border pt-3">
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

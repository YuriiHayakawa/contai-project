import { ChevronRight, LogOut, Menu, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { bottomNavLeading, bottomNavTrailing, moreItems, type NavItem } from "./navigation";

export interface BottomNavProps {
  /** Abre a folha de novo lançamento. */
  onNewTransaction: () => void;
  /** Sai da conta; o item "Sair" da folha "Mais" só aparece quando informado. */
  onSignOut?: () => void;
  /** Mostra "Cartões" na folha "Mais": só para quem tem cartão de crédito ativo. */
  hasCards?: boolean;
}

interface TabLinkProps {
  item: NavItem;
}

interface TabContentProps {
  icon: NavItem["icon"];
  label: string;
  active: boolean;
}

// Com o teclado virtual aberto, a área visível encolhe bem mais do que qualquer barra do
// navegador; abaixo disso é só a barra de endereço aparecendo e sumindo.
const KEYBOARD_MIN_HEIGHT = 150;

/** A barra some enquanto o teclado virtual está aberto, para não cobrir o campo em uso. */
function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = (): void => {
      setOpen(window.innerHeight - viewport.height > KEYBOARD_MIN_HEIGHT);
    };
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  return open;
}

const tabClass = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-micro";

function TabContent({ icon: Icon, label, active }: TabContentProps) {
  return (
    <>
      <span
        className={cn(
          "flex h-7 w-11 items-center justify-center rounded-full",
          "transition-colors duration-fast ease-out",
          active && "bg-primary-soft",
        )}
      >
        <Icon aria-hidden="true" className="size-6" />
      </span>
      {label}
    </>
  );
}

function TabLink({ item }: TabLinkProps) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn(tabClass, isActive ? "text-primary" : "text-ink-muted")}
    >
      {({ isActive }) => <TabContent icon={item.icon} label={item.label} active={isActive} />}
    </NavLink>
  );
}

/**
 * Barra inferior (até `lg`): Início, Lançamentos, o botão central "Lançar", Assistente e
 * "Mais", que abre uma folha com Contas, Cartões (para quem tem cartão), Categorias,
 * Importações e Configurações e, no fim, a saída da conta.
 */
export function BottomNav({ onNewTransaction, onSignOut, hasCards = false }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useVirtualKeyboardOpen();
  const { pathname } = useLocation();
  const more = moreItems({ hasCards });
  const insideMore = more.some((item) => pathname.startsWith(item.to));

  if (keyboardOpen) return null;

  return (
    <>
      <nav
        aria-label="Principal"
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 items-center",
          "h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]",
          "border-t border-border bg-surface lg:hidden",
        )}
      >
        {bottomNavLeading.map((item) => (
          <TabLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          aria-label="Lançar"
          onClick={onNewTransaction}
          className={cn(
            "flex size-14 -translate-y-3 items-center justify-center justify-self-center",
            "rounded-full bg-primary text-on-primary shadow-sm",
            "transition-[background-color,scale] duration-fast ease-out",
            "hover:bg-primary-hover active:scale-[0.98] active:duration-instant",
          )}
        >
          <Plus aria-hidden="true" className="size-7" />
        </button>
        {bottomNavTrailing.map((item) => (
          <TabLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(tabClass, insideMore ? "text-primary" : "text-ink-muted")}
        >
          <TabContent icon={Menu} label="Mais" active={insideMore} />
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais">
        <nav aria-label="Mais opções">
          <ul>
            {more.map((item) => (
              <li key={item.to} className="border-b border-border last:border-b-0">
                <NavLink
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-14 items-center gap-3 text-body font-bold",
                      isActive ? "text-primary" : "text-ink",
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="size-6 text-ink-muted" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight aria-hidden="true" className="size-5 text-ink-subtle" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {/* No celular não há barra lateral: a saída da conta fica no fim desta folha. */}
        {onSignOut && (
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onSignOut();
            }}
            className={cn(
              "mt-2 flex min-h-14 w-full items-center gap-3 border-t border-border",
              "text-left text-body font-bold text-ink",
            )}
          >
            <LogOut aria-hidden="true" className="size-6 text-ink-muted" />
            Sair
          </button>
        )}
      </Modal>
    </>
  );
}

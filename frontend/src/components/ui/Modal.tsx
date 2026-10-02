import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";
import { enterTransition, exitTransition, sheetSpring } from "../../lib/motion";
import { breakpoints, useMediaQuery } from "../../lib/useMediaQuery";
import { IconButton } from "./Button";

export interface ModalProps {
  open: boolean;
  /** Chamado pelo botão de fechar e, se não houver dados por salvar, por `Esc` e pelo véu. */
  onClose: () => void;
  title: string;
  /** Texto abaixo do título, ligado ao diálogo por `aria-describedby`. */
  description?: string;
  /** `form` abre com 560px a partir de `md`; o padrão é 480px. */
  size?: "default" | "form";
  /** Com dados digitados e não salvos, `Esc` e o toque no véu deixam de fechar. */
  preventDismiss?: boolean;
  /** Elemento que recebe o foco ao abrir; sem ele, o foco vai para o próprio diálogo. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `alertdialog` para confirmações que interrompem o usuário. */
  role?: "dialog" | "alertdialog";
  /** Ações: a principal primeiro. Empilhadas no celular e à direita no desktop. */
  footer?: ReactNode;
  children?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Modal (seção 6.5 do design-system.md): folha que sobe da base no celular e diálogo
 * centralizado a partir de `md`. O foco fica preso dentro e volta à origem ao fechar.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "default",
  preventDismiss = false,
  initialFocusRef,
  role = "dialog",
  footer,
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const isDialog = useMediaQuery(breakpoints.md);

  useEffect(() => {
    if (!open) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? panelRef.current)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      origin?.focus();
    };
  }, [open, initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      // Com diálogos empilhados, só o de cima reage.
      event.stopPropagation();
      if (!preventDismiss) onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = event.currentTarget;
    const focusable = focusableIn(panel);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          key="modal"
          className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6"
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enterTransition }}
            exit={{ opacity: 0, transition: exitTransition }}
            onClick={preventDismiss ? undefined : onClose}
          />
          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            className={cn(
              "relative flex max-h-[90dvh] w-full flex-col bg-surface-raised shadow-lg outline-none",
              "rounded-t-xl md:rounded-xl",
              size === "form" ? "md:max-w-140" : "md:max-w-120",
            )}
            initial={isDialog ? { opacity: 0, scale: 0.97 } : { y: "100%" }}
            animate={
              isDialog
                ? { opacity: 1, scale: 1, transition: sheetSpring }
                : { y: 0, transition: sheetSpring }
            }
            exit={
              isDialog
                ? { opacity: 0, scale: 0.97, transition: exitTransition }
                : { y: "100%", transition: exitTransition }
            }
          >
            {/* Alça da folha: só aparece no celular. */}
            <span
              aria-hidden="true"
              className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden"
            />
            <header className="flex items-start justify-between gap-3 px-4 pt-2 md:px-6 md:pt-5">
              <div className="grid gap-1 py-2">
                <h2 id={titleId} className="font-display text-title-2 text-ink">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="text-body text-ink-muted">
                    {description}
                  </p>
                )}
              </div>
              <IconButton aria-label="Fechar" className="-mr-2" onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            </header>
            {children && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 md:px-6">{children}</div>
            )}
            {footer && (
              <footer
                className={cn(
                  "flex flex-col gap-2 px-4 pt-4 *:w-full",
                  "pb-[calc(1rem+env(safe-area-inset-bottom))]",
                  "md:flex-row-reverse md:px-6 md:pb-6 md:*:w-auto",
                )}
              >
                {footer}
              </footer>
            )}
            {!footer && <div className="h-[calc(1rem+env(safe-area-inset-bottom))] md:h-6" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

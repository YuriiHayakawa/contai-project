import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../lib/cn";
import { enterTransition, exitTransition } from "../../lib/motion";
import { Button, IconButton } from "./Button";

export type ToastKind = "success" | "info" | "error";

export interface ToastAction {
  /** Como "Desfazer". */
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  /** Não some sozinho. Erro de formulário nunca vai só em toast: aparece junto do campo. */
  error: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

interface ToastData {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export interface ToastProviderProps {
  children: ReactNode;
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: number) => void;
}

const MAX_STACKED = 3;
const DURATION_MS = 5000;
const DURATION_WITH_ACTION_MS = 8000;

const appearance: Record<ToastKind, { icon: LucideIcon; color: string }> = {
  success: { icon: CircleCheck, color: "text-income" },
  info: { icon: Info, color: "text-primary" },
  error: { icon: CircleAlert, color: "text-danger" },
};

const ToastContext = createContext<ToastApi | null>(null);

// Só precisa ser único enquanto a página está aberta.
let nextToastId = 1;

function durationOf(toast: ToastData): number | null {
  if (toast.kind === "error") return null;
  return toast.action ? DURATION_WITH_ACTION_MS : DURATION_MS;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationOf(toast));
  const { icon: Icon, color } = appearance[toast.kind];

  // A contagem para com o foco ou o ponteiro em cima e continua de onde parou.
  useEffect(() => {
    if (paused || remaining.current === null) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current -= Date.now() - startedAt;
    };
  }, [paused, onDismiss, toast.id]);

  return (
    <motion.li
      layout
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border border-border",
        "bg-surface-raised py-1 pr-1 pl-4 shadow-md",
      )}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: enterTransition }}
      exit={{ opacity: 0, y: 12, transition: exitTransition }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon aria-hidden="true" className={cn("mt-3 size-5 shrink-0", color)} />
      {/* Em tela estreita, a ação desce para a linha de baixo em vez de espremer o texto. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3">
        <p className="min-w-40 flex-1 py-2.5 text-body text-ink">{toast.message}</p>
        {toast.action && (
          <Button
            variant="ghost"
            className="-ml-5"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </Button>
        )}
      </div>
      <IconButton aria-label="Fechar aviso" onClick={() => onDismiss(toast.id)}>
        <X aria-hidden="true" />
      </IconButton>
    </motion.li>
  );
}

/**
 * Avisos passageiros (seção 6.8 do design-system.md): na base, acima da barra inferior, no
 * celular; no canto superior direito a partir de `lg`. No máximo três empilhados.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const show =
      (kind: ToastKind) =>
      (message: string, options: ToastOptions = {}): void => {
        const toast: ToastData = { id: nextToastId++, kind, message, action: options.action };
        // Passando de três, o mais antigo dá lugar ao novo.
        setToasts((current) => [...current, toast].slice(-MAX_STACKED));
      };
    return { success: show("success"), info: show("info"), error: show("error"), dismiss };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ul
        aria-label="Avisos"
        className={cn(
          "pointer-events-none fixed inset-x-4 z-50 flex flex-col gap-2",
          "bottom-[calc(5rem+env(safe-area-inset-bottom))]",
          "lg:inset-x-auto lg:top-6 lg:right-6 lg:bottom-auto lg:w-96",
        )}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </ul>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return api;
}

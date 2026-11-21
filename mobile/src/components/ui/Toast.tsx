// Toast (design-system, seção 6.8): um aviso por vez, na base da tela, anunciado ao VoiceOver.
// Pode ter uma ação, como "Desfazer" ou "Refazer", e some sozinho, menos o de erro.
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TOUCH_TARGET, radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";
import { Text } from "./Text";

export type ToastKind = "success" | "info" | "error";

export interface ToastOptions {
  message: string;
  kind?: ToastKind;
  action?: { label: string; onPress: () => void };
  /** Padrão: 5 s; 8 s com ação. O de erro só some pelo botão de fechar. */
  durationMs?: number;
}

interface ToastState extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function defaultDuration(options: ToastOptions): number | null {
  if (options.kind === "error") return null;
  return options.durationMs ?? (options.action ? 8_000 : 5_000);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const hide = useCallback(() => setToast(null), []);
  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    setToast({ ...options, id: nextId.current });
    const actionHint = options.action ? ` ${options.action.label} disponível.` : "";
    AccessibilityInfo.announceForAccessibility(`${options.message}${actionHint}`);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const duration = defaultDuration(toast);
    if (duration === null) return;
    const timer = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, duration);
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <ToastView toast={toast} onClose={hide} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const kindColor = {
    success: colors.income,
    info: colors.primary,
    error: colors.danger,
  }[toast.kind ?? "info"];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { bottom: insets.bottom + space[4] + 56 }]}
    >
      <View
        accessibilityRole={toast.kind === "error" ? "alert" : "summary"}
        style={[
          styles.toast,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            borderLeftColor: kindColor,
          },
        ]}
      >
        <Text variant="body" style={styles.message}>
          {toast.message}
        </Text>
        {toast.action && (
          <Button
            compact
            variant="ghost"
            label={toast.action.label}
            onPress={() => {
              toast.action?.onPress();
              onClose();
            }}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar aviso"
          onPress={onClose}
          style={styles.close}
        >
          <Text variant="bodyStrong" color="inkMuted">
            ✕
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return context;
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: space[4], right: space[4] },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: radius.lg,
    paddingLeft: space[4],
    paddingVertical: space[1],
  },
  message: { flex: 1, paddingVertical: space[2] },
  close: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
});

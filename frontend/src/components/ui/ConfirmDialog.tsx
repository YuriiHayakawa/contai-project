import { useRef } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  /** A pergunta com o objeto: "Excluir este lançamento?". */
  title: string;
  /** A consequência: o que acontece se o usuário confirmar. */
  description: string;
  /** O verbo da ação: "Excluir", "Desfazer importação". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Enquanto a ação roda: o botão mostra o indicador e o diálogo não fecha. */
  loading?: boolean;
}

/**
 * Confirmação de ação destrutiva (seção 6.5 do design-system.md). O foco começa em "Cancelar",
 * para um Enter distraído não destruir nada.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleCancel = (): void => {
    if (!loading) onCancel();
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={title}
      description={description}
      role="alertdialog"
      initialFocusRef={cancelRef}
      preventDismiss={loading}
      footer={
        <>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="secondary" disabled={loading} onClick={handleCancel}>
            {cancelLabel}
          </Button>
        </>
      }
    />
  );
}

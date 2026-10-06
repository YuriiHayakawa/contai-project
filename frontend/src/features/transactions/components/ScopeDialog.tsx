import { useRef } from "react";

import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import type { EditScope } from "../types";

export interface ScopeDialogProps {
  open: boolean;
  /** Editar mostra as escolhas como "Salvar…"; excluir, como "Excluir…", em vermelho. */
  action: "edit" | "delete";
  /** Número desta parcela e total de parcelas da compra, como em "3 de 10". */
  number: number;
  count: number;
  /** Quantas parcelas sobram desta em diante, contando esta. */
  following: number;
  /** A escolha que está sendo salva ou excluída: o botão dela mostra o indicador. */
  pending?: EditScope | null;
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
}

function parcels(amount: number): string {
  return amount === 1 ? "1 parcela" : `${amount} parcelas`;
}

/**
 * Escolha do alcance de uma edição ou exclusão de parcela (FR-032): só esta, ou esta e as
 * próximas. As anteriores nunca mudam, e o diálogo diz quantas parcelas cada escolha alcança.
 */
export function ScopeDialog({
  open,
  action,
  number,
  count,
  following,
  pending = null,
  onChoose,
  onCancel,
}: ScopeDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleting = action === "delete";
  const last = number + following - 1;
  const loading = pending !== null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) onCancel();
      }}
      title={
        deleting
          ? `Excluir a parcela ${number} de ${count}?`
          : `Salvar a parcela ${number} de ${count}`
      }
      description={
        deleting
          ? "Escolha o que sai. As parcelas anteriores ficam como estão."
          : "Escolha onde a mudança vale. As parcelas anteriores ficam como estão."
      }
      role={deleting ? "alertdialog" : "dialog"}
      initialFocusRef={cancelRef}
      preventDismiss={loading}
      footer={
        <>
          <Button
            variant={deleting ? "danger" : "primary"}
            loading={pending === "single"}
            disabled={pending === "following"}
            onClick={() => onChoose("single")}
          >
            {deleting ? "Excluir só esta" : "Salvar só nesta"}
          </Button>
          <Button
            variant={deleting ? "danger" : "secondary"}
            loading={pending === "following"}
            disabled={pending === "single"}
            onClick={() => onChoose("following")}
          >
            {deleting
              ? `Excluir esta e as próximas (${parcels(following)})`
              : `Salvar nesta e nas próximas (${parcels(following)})`}
          </Button>
          <Button ref={cancelRef} variant="secondary" disabled={loading} onClick={onCancel}>
            Cancelar
          </Button>
        </>
      }
    >
      <ul className="grid gap-2 text-body text-ink">
        <li>
          <span className="font-bold">Só esta:</span> {deleting ? "apaga" : "muda"} apenas a parcela{" "}
          {number}.
        </li>
        <li>
          <span className="font-bold">Esta e as próximas:</span> {deleting ? "apaga" : "muda"}{" "}
          {parcels(following)}
          {following > 1 && `, da ${number} à ${last}`}.
        </li>
      </ul>
    </Modal>
  );
}

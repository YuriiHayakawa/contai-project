import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useAuth } from "../../auth/hooks/useAuth";
import type { CurrentUser } from "../../auth/types";
import { downloadZip } from "../download";
import { useExportData, useRequestDeletion } from "../hooks/useAccount";

import { SettingsSection } from "./SettingsSection";

const schema = z.object({
  password: z.string().min(1, "Informe sua senha para confirmar."),
  code: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

/** Excluir a conta: desativa na hora, com 7 dias para desistir, e apaga de vez depois (FR-017). */
export function DeleteAccountSection({ user }: { user: CurrentUser }) {
  const [confirming, setConfirming] = useState(false);
  const deletion = useRequestDeletion();
  const exportData = useExportData();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const {
    register: field,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", code: "" },
  });

  const close = (): void => {
    if (deletion.isPending) return;
    setConfirming(false);
    deletion.reset();
    reset();
  };

  const downloadBeforeDeleting = (): void => {
    exportData.mutate(undefined, {
      onSuccess: (blob) => {
        downloadZip(blob);
        toast.success("Seus dados foram baixados.");
      },
    });
  };

  const submit = handleSubmit((values) => {
    deletion.mutate(
      { password: values.password, code: values.code?.trim() || undefined },
      {
        onSuccess: () => {
          // O servidor encerrou todas as sessões: saímos e levamos à entrada com o aviso.
          signOut();
          toast.success("Conta desativada. Você tem 7 dias para desistir: é só entrar de novo.");
          void navigate(paths.login);
        },
        onError: (error) => {
          for (const [name, message] of Object.entries(fieldErrors(error))) {
            if (name === "password" || name === "code") setError(name, { message });
          }
        },
      },
    );
  });

  // Erro sem campo (por exemplo, código inválido): mostra o aviso no topo do diálogo.
  const generalError = deletion.isError && Object.keys(fieldErrors(deletion.error)).length === 0;

  return (
    <SettingsSection title="Excluir a conta" description="Encerre de vez a sua conta no Contaí.">
      <div className="grid gap-4">
        <Notice kind="warning">
          Ao pedir a exclusão, sua conta é desativada na hora. Você tem 7 dias para desistir; depois
          desse prazo, seus dados são apagados de vez e não há como recuperá-los.
        </Notice>
        <p className="text-body text-ink-muted">
          Que tal{" "}
          <button
            type="button"
            onClick={downloadBeforeDeleting}
            disabled={exportData.isPending}
            className="font-bold text-primary underline underline-offset-2 disabled:opacity-60"
          >
            baixar seus dados
          </button>{" "}
          antes de continuar? Depois da exclusão definitiva, não dá mais para recuperá-los.
        </p>
        <div className="justify-self-start">
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Excluir minha conta
          </Button>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={close}
        role="alertdialog"
        title="Excluir a conta?"
        description="A conta é desativada agora e apagada de vez em 7 dias. Dá para desistir nesse prazo entrando de novo."
        preventDismiss={deletion.isPending}
        footer={
          <>
            <Button variant="danger" loading={deletion.isPending} onClick={() => void submit()}>
              Excluir a conta
            </Button>
            <Button variant="secondary" disabled={deletion.isPending} onClick={close}>
              Cancelar
            </Button>
          </>
        }
      >
        <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4 pb-2">
          {generalError && <Notice kind="error">{errorMessage(deletion.error)}</Notice>}
          <TextField
            label="Sua senha"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...field("password")}
          />
          {user.two_factor_enabled && (
            <TextField
              label="Código de verificação"
              inputMode="numeric"
              autoComplete="one-time-code"
              help="O código do seu app autenticador ou um código de recuperação."
              error={errors.code?.message}
              {...field("code")}
            />
          )}
        </form>
      </Modal>
    </SettingsSection>
  );
}

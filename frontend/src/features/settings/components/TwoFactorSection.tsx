import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import type { CurrentUser, RecoveryCodes, TwoFactorSetup } from "../../auth/types";
import {
  useDisableTwoFactor,
  useEnableTwoFactor,
  useRegenerateRecoveryCodes,
  useSetupTwoFactor,
} from "../hooks/useTwoFactor";
import type { TwoFactorPasswordCode } from "../types";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel";
import { SettingsSection } from "./SettingsSection";

export interface TwoFactorSectionProps {
  user: CurrentUser;
}

/** Estado local da ativação: parado, configurando (QR e código) ou mostrando os códigos. */
type Phase = "idle" | "configuring" | "codes";

export function TwoFactorSection({ user }: TwoFactorSectionProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<null | "disable" | "regenerate">(null);

  const startSetup = useSetupTwoFactor();
  const enable = useEnableTwoFactor();
  const [code, setCode] = useState("");

  const begin = (): void => {
    startSetup.mutate(undefined, {
      onSuccess: (data) => {
        setSetup(data);
        setCode("");
        setPhase("configuring");
      },
    });
  };

  const confirmEnable = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!code.trim()) return;
    enable.mutate(code.trim(), {
      onSuccess: (data) => {
        setRecoveryCodes(data.recovery_codes);
        setPhase("codes");
      },
    });
  };

  const finish = (): void => {
    setPhase("idle");
    setSetup(null);
    setRecoveryCodes([]);
    enable.reset();
  };

  return (
    <SettingsSection
      title="Verificação em duas etapas"
      description="Além da senha, a entrada passa a pedir um código de um aplicativo autenticador."
    >
      {phase === "codes" ? (
        <div className="grid gap-4">
          <Notice kind="success">Pronto! A verificação em duas etapas está ativa.</Notice>
          <RecoveryCodesPanel codes={recoveryCodes} />
          <div className="justify-self-start">
            <Button onClick={finish}>Concluir</Button>
          </div>
        </div>
      ) : phase === "configuring" && setup ? (
        <ConfiguringPanel
          setup={setup}
          code={code}
          onCodeChange={setCode}
          onSubmit={confirmEnable}
          submitting={enable.isPending}
          error={enable.isError ? errorMessage(enable.error) : null}
          onCancel={finish}
        />
      ) : user.two_factor_enabled ? (
        <EnabledPanel
          onRegenerate={() => setConfirmAction("regenerate")}
          onDisable={() => setConfirmAction("disable")}
        />
      ) : (
        <DisabledPanel onStart={begin} starting={startSetup.isPending} />
      )}

      {startSetup.isError && phase === "idle" && (
        <Notice kind="error" className="mt-4">
          {errorMessage(startSetup.error)}
        </Notice>
      )}

      {confirmAction && (
        <PasswordCodeDialog
          action={confirmAction}
          onClose={() => setConfirmAction(null)}
          onRecoveryCodes={(codes) => {
            setRecoveryCodes(codes);
            setPhase("codes");
            setConfirmAction(null);
          }}
        />
      )}
    </SettingsSection>
  );
}

function DisabledPanel({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
        <p className="text-body text-ink-muted">
          Um aplicativo autenticador (como Google Authenticator, Authy ou o do seu gerenciador de
          senhas) gera um código novo a cada 30 segundos. Mesmo que alguém descubra sua senha, não
          entra sem esse código.
        </p>
      </div>
      <div className="justify-self-start">
        <Button loading={starting} onClick={onStart}>
          Ativar a verificação em duas etapas
        </Button>
      </div>
    </div>
  );
}

function EnabledPanel({
  onRegenerate,
  onDisable,
}: {
  onRegenerate: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="grid gap-4">
      <Notice kind="success">A verificação em duas etapas está ativa nesta conta.</Notice>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onRegenerate}>
          Gerar novos códigos de recuperação
        </Button>
        <Button variant="danger" onClick={onDisable}>
          Desativar
        </Button>
      </div>
    </div>
  );
}

interface ConfiguringPanelProps {
  setup: TwoFactorSetup;
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
}

function ConfiguringPanel({
  setup,
  code,
  onCodeChange,
  onSubmit,
  submitting,
  error,
  onCancel,
}: ConfiguringPanelProps) {
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5">
      <ol className="grid gap-5">
        <li className="grid gap-1">
          <p className="text-body font-bold text-ink">1. Instale um aplicativo autenticador</p>
          <p className="text-body text-ink-muted">
            No celular, instale um app como Google Authenticator, Microsoft Authenticator ou Authy.
            Seu gerenciador de senhas talvez já faça isso.
          </p>
        </li>
        <li className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-body font-bold text-ink">2. Leia o QR code</p>
            <p className="text-body text-ink-muted">
              No aplicativo, toque em adicionar e aponte a câmera para o código abaixo.
            </p>
          </div>
          <div className="w-fit rounded-lg bg-white p-4">
            <QRCodeSVG value={setup.otpauth_uri} size={176} />
          </div>
          <details className="text-body text-ink-muted">
            <summary className="cursor-pointer font-bold text-primary">
              Não consigo ler o QR code
            </summary>
            <p className="mt-2">Digite esta chave no aplicativo, no lugar de ler o código:</p>
            <p className="mt-1 font-mono text-ink break-all select-all">{setup.secret}</p>
          </details>
        </li>
        <li className="grid gap-2">
          <div className="grid gap-1">
            <p className="text-body font-bold text-ink">3. Digite o código do aplicativo</p>
            <p className="text-body text-ink-muted">
              O app mostra um código de 6 dígitos que muda a cada 30 segundos.
            </p>
          </div>
          <TextField
            label="Código de 6 dígitos"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
          />
        </li>
      </ol>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={submitting}>
          Ativar
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

interface PasswordCodeDialogProps {
  action: "disable" | "regenerate";
  onClose: () => void;
  onRecoveryCodes: (codes: string[]) => void;
}

/** Diálogo que pede a senha e um código, para desativar ou gerar novos códigos de recuperação. */
function PasswordCodeDialog({ action, onClose, onRecoveryCodes }: PasswordCodeDialogProps) {
  const disable = useDisableTwoFactor();
  const regenerate = useRegenerateRecoveryCodes();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const mutation = action === "disable" ? disable : regenerate;
  const fields = fieldErrors(mutation.error);
  const generalError =
    mutation.isError && Object.keys(fields).length === 0 ? errorMessage(mutation.error) : null;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const input: TwoFactorPasswordCode = { password, code: code.trim() };
    if (action === "disable") {
      disable.mutate(input, {
        onSuccess: () => {
          toast.success("Verificação em duas etapas desativada.");
          onClose();
        },
      });
    } else {
      regenerate.mutate(input, {
        onSuccess: (data: RecoveryCodes) => onRecoveryCodes(data.recovery_codes),
      });
    }
  };

  const title =
    action === "disable"
      ? "Desativar a verificação em duas etapas"
      : "Gerar novos códigos de recuperação";

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description="Confirme com sua senha e um código do aplicativo autenticador."
      footer={
        <>
          <Button type="submit" form="two-factor-confirm" variant={action === "disable" ? "danger" : "primary"} loading={mutation.isPending}>
            {action === "disable" ? "Desativar" : "Gerar códigos"}
          </Button>
          <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <form id="two-factor-confirm" noValidate onSubmit={submit} className="grid gap-4">
        {generalError && <Notice kind="error">{generalError}</Notice>}
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={fields.password}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label="Código do aplicativo"
          inputMode="numeric"
          autoComplete="one-time-code"
          error={fields.code}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </form>
    </Modal>
  );
}

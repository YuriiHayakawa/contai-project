import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";

export interface RecoveryCodesPanelProps {
  codes: string[];
}

/**
 * Os 10 códigos de recuperação, exibidos uma única vez. Cada código vale uma entrada quando a
 * pessoa está sem o aplicativo autenticador, então o aviso insiste em guardá-los agora.
 */
export function RecoveryCodesPanel({ codes }: RecoveryCodesPanelProps) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard?.writeText(codes.join("\n")).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  return (
    <div className="grid gap-3">
      <Notice kind="warning">
        Guarde estes códigos agora, num lugar seguro (um gerenciador de senhas, por exemplo). Cada
        um serve para entrar uma vez, caso você fique sem o aplicativo. Eles não serão mostrados de
        novo.
      </Notice>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-bg-sunken p-4 font-mono text-body text-ink">
        {codes.map((code) => (
          <li key={code} className="text-center tracking-widest">
            {code}
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="compact"
        icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        onClick={copy}
      >
        {copied ? "Copiado" : "Copiar os códigos"}
      </Button>
    </div>
  );
}

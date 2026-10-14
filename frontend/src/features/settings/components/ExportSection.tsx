import { Download } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { downloadZip } from "../download";
import { useExportData } from "../hooks/useAccount";

import { SettingsSection } from "./SettingsSection";

/** Baixar todos os dados da conta em um arquivo de formato aberto (FR-016). */
export function ExportSection() {
  const exportData = useExportData();
  const toast = useToast();

  const download = (): void => {
    exportData.mutate(undefined, {
      onSuccess: (blob) => {
        downloadZip(blob);
        toast.success("Seus dados foram baixados.");
      },
    });
  };

  return (
    <SettingsSection
      title="Seus dados"
      description="Baixe tudo o que o Contaí guarda da sua conta num único arquivo."
    >
      <div className="grid gap-4">
        {exportData.isError && <Notice kind="error">{errorMessage(exportData.error)}</Notice>}
        <p className="text-body text-ink-muted">
          O arquivo .zip traz seu perfil, contas, categorias, lançamentos, importações, regras de
          categoria e conversas. Os lançamentos também vêm em uma planilha (.csv) que você abre em
          qualquer programa.
        </p>
        <div className="justify-self-start">
          <Button variant="secondary" loading={exportData.isPending} onClick={download}>
            <Download aria-hidden="true" className="size-4" />
            Baixar meus dados
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Notice } from "../../../components/ui/Notice";

export interface AiConsentDialogProps {
  open: boolean;
  /** Enquanto o aceite é registrado: o botão mostra o indicador e o aviso não fecha. */
  loading?: boolean;
  /** O aceite não pôde ser registrado: o que fazer, em português. */
  error?: string | null;
  /** O usuário aceitou: o aceite é registrado e o envio segue. */
  onAccept: () => void;
  /** O usuário não aceitou: nada é enviado. */
  onCancel: () => void;
}

/**
 * Aviso antes do primeiro envio de PDF ou imagem (FR-044): o conteúdo é lido por um serviço de
 * IA externo, que pode usar os dados para melhorar seus modelos. O envio só acontece com o
 * aceite; depois dele, o aviso não aparece de novo.
 */
export function AiConsentDialog({
  open,
  loading = false,
  error = null,
  onAccept,
  onCancel,
}: AiConsentDialogProps) {
  const handleCancel = (): void => {
    if (!loading) onCancel();
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Este arquivo será lido por um serviço de IA"
      preventDismiss={loading}
      footer={
        <>
          <Button loading={loading} onClick={onAccept}>
            Aceitar e enviar
          </Button>
          <Button variant="secondary" disabled={loading} onClick={handleCancel}>
            Cancelar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-body text-ink">
        <p>
          PDFs e imagens são lidos por um serviço de IA externo ao Contaí. O conteúdo do arquivo é
          enviado a esse serviço, que pode usar os dados para melhorar seus modelos.
        </p>
        <p className="text-ink-muted">
          Se preferir não enviar, cancele e use o extrato em OFX, CSV ou planilha: esses formatos
          são lidos sem IA. Ao aceitar, este aviso não aparece de novo nos próximos envios.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

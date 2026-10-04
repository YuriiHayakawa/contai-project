import { ArrowLeft } from "lucide-react";

import { TextLink } from "../../../components/ui/TextLink";
import { paths } from "../../../lib/paths";

/** Volta ao histórico de importações; fica acima do título das telas de uma importação. */
export function BackToImports() {
  return (
    <TextLink to={paths.imports} standalone className="gap-1.5 text-label no-underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Importações
    </TextLink>
  );
}

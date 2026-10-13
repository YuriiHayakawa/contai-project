import type { ReactNode } from "react";

import { Card } from "../../../components/ui/Card";

export interface SettingsSectionProps {
  title: string;
  /** Uma linha curta abaixo do título, dizendo para que serve a seção. */
  description?: string;
  children: ReactNode;
}

/** Um bloco das Configurações: título, uma linha de contexto e o conteúdo, dentro de um cartão. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-display text-title-2 text-ink">{title}</h2>
        {description && <p className="text-body text-ink-muted">{description}</p>}
      </div>
      <Card>{children}</Card>
    </section>
  );
}

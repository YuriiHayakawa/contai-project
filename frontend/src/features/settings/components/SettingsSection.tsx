import type { ReactNode } from "react";

import { Card } from "../../../components/ui/Card";

export interface SettingsSectionProps {
  /** Título do cartão (`title-3`), abaixo do título do grupo. Opcional quando o grupo já nomeia. */
  title?: string;
  /** Uma linha curta dizendo para que serve o cartão. */
  description?: string;
  children: ReactNode;
}

/** Um cartão dentro de um grupo das Configurações: título opcional, contexto e o conteúdo. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <Card>
      {(title || description) && (
        <header className="mb-4 grid gap-1">
          {title && <h3 className="font-display text-title-3 text-ink">{title}</h3>}
          {description && <p className="text-body text-ink-muted">{description}</p>}
        </header>
      )}
      {children}
    </Card>
  );
}

import { TriangleAlert } from "lucide-react";

import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { cn } from "../../../lib/cn";
import { formatBRL } from "../../../lib/money";
import { paths } from "../../../lib/paths";
import type { CreditLimitUsage } from "../../dashboard/types";

export interface CardLimitProps {
  /** Limite, usado e disponível do cartão, vistos de hoje; `null` sem limite informado. */
  usage: CreditLimitUsage | null;
}

const TITLE = "Limite do cartão";

/**
 * Quanto do limite do cartão está ocupado (FR-088). O limite é um teto, e não dinheiro: aqui
 * ele só diz quanto ainda dá para gastar. O usado soma o que se deve hoje e o que já está
 * lançado para depois, como as parcelas. Passar do limite não bloqueia nada: a tela diz quanto
 * passou, com ícone e texto. Sem limite informado, mostra o caminho para informá-lo.
 */
export function CardLimit({ usage }: CardLimitProps) {
  if (!usage) {
    return (
      <Card title={TITLE}>
        <p className="text-body text-ink-muted">
          Informe o limite deste cartão para ver quanto ainda dá para gastar nele.
        </p>
        <TextLink to={paths.accounts} standalone className="mt-1">
          Informar o limite em Contas
        </TextLink>
      </Card>
    );
  }

  const { limit_cents: limit, used_cents: used, available_cents: available } = usage;
  const over = available < 0;
  // Percentual não é dinheiro: a largura da barra pode ser calculada em ponto flutuante.
  const width = used === 0 ? 0 : Math.min(Math.max((used / limit) * 100, 2), 100);

  return (
    <Card title={TITLE}>
      {over ? (
        <p className="flex items-start gap-2 text-warning">
          <TriangleAlert aria-hidden="true" className="mt-1 size-5 shrink-0" />
          {/* Só o valor não quebra: em 320px, a frase inteira em uma linha não cabe. */}
          <span className="min-w-0 text-money-lg">
            <span className="money">{formatBRL(-available)}</span> acima do limite
          </span>
        </p>
      ) : (
        <>
          <p className="text-label text-ink-muted">Disponível</p>
          <p className="money text-money-lg text-ink">{formatBRL(available)}</p>
        </>
      )}

      <div
        role="meter"
        aria-label="Uso do limite"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${formatBRL(used)} usados de ${formatBRL(limit)}`}
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-bg-sunken"
      >
        <span
          className={cn("block h-full rounded-full", over ? "bg-warning" : "bg-primary")}
          style={{ width: `${width}%` }}
        />
      </div>
      <dl className="mt-2 flex justify-between gap-4 text-small">
        <div className="grid">
          <dt className="text-ink-muted">Usado</dt>
          <dd className="money font-bold text-ink">{formatBRL(used)}</dd>
        </div>
        <div className="grid justify-items-end">
          <dt className="text-ink-muted">Limite</dt>
          <dd className="money font-bold text-ink">{formatBRL(limit)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-small text-ink-muted">
        O usado soma o que você deve hoje e o que já está lançado para depois, como as parcelas.
      </p>
    </Card>
  );
}

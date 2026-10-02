import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { formatBRL } from "../../../lib/money";
import { paths } from "../../../lib/paths";
import { ACCOUNT_TYPE_ICONS } from "../../accounts/account-type-icons";
import { ACCOUNT_TYPE_LABELS } from "../../accounts/types";
import type { AccountBalance } from "../types";

export interface AccountsCardProps {
  /** Contas ativas, com o saldo de hoje. */
  accounts: readonly AccountBalance[];
}

/** Saldo de cada conta ativa (FR-055). O saldo é o de hoje, e não o do mês exibido. */
export function AccountsCard({ accounts }: AccountsCardProps) {
  return (
    <Card
      title="Contas"
      action={
        <TextLink to={paths.accounts} standalone className="text-small">
          Ver todas
        </TextLink>
      }
    >
      {accounts.length === 0 ? (
        <p className="text-body text-ink-muted">Nenhuma conta ativa.</p>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((account) => {
            const Icon = ACCOUNT_TYPE_ICONS[account.type];
            return (
              <li key={account.id} className="flex min-h-14 items-center gap-3 py-2">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-sunken text-ink-muted"
                >
                  <Icon className="size-4.5" />
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-body font-bold text-ink">{account.name}</span>
                  <span className="truncate text-small text-ink-muted">
                    {ACCOUNT_TYPE_LABELS[account.type]}
                  </span>
                </span>
                <span className="money text-money-md text-ink">
                  {formatBRL(account.balance_cents)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

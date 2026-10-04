import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/Button";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { Skeleton } from "../../../components/ui/Skeleton";
import { TextLink } from "../../../components/ui/TextLink";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { dayLabel, yearMonthOf } from "../../../lib/dates";
import { formatBRL } from "../../../lib/money";
import { paths } from "../../../lib/paths";
import { useAccounts } from "../../accounts/hooks/useAccounts";
import { categoriesById, useCategories } from "../../categories/hooks/useCategories";
import { monthSearch } from "../../transactions/filters";
import { useDiscardProposal, useSaveProposal } from "../hooks/useSaveProposal";
import type { Proposal } from "../types";

export interface ProposalCardProps {
  /** A mensagem do assistente que trouxe a proposta. */
  messageId: string;
  proposal: Proposal;
}

interface RowProps {
  label: string;
  children: ReactNode;
}

const TYPE_LABELS: Record<Proposal["type"], string> = { expense: "Despesa", income: "Receita" };
const TO_CHOOSE = "Você escolhe ao ajustar";

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-small text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right text-small text-ink">{children}</dd>
    </div>
  );
}

/**
 * Lançamento sugerido (seção 8 do design-system.md): o valor, a data, a conta e a categoria
 * que o assistente entendeu de uma frase. Com a conta e a categoria definidas, "Salvar" grava o
 * lançamento como está; "Ajustar" abre o formulário preenchido. Se a frase deixou a conta ou a
 * categoria em aberto, só há "Ajustar": quem escolhe é o usuário. Nada é salvo antes de um
 * desses dois pedidos (FR-067). Depois de salvo, o cartão mostra o que ficou gravado e o
 * caminho até ele.
 */
export function ProposalCard({ messageId, proposal }: ProposalCardProps) {
  const toast = useToast();
  const accounts = useAccounts();
  const categories = useCategories();
  const { review, save, isSaving } = useSaveProposal();
  const discard = useDiscardProposal();

  const amount =
    proposal.type === "income"
      ? formatBRL(proposal.amount_cents, { sign: "always" })
      : formatBRL(-proposal.amount_cents);

  if (proposal.status === "discarded") {
    return (
      <p className="text-small text-ink-muted">
        Proposta descartada: {proposal.description}, <span className="money">{amount}</span>. Nada
        foi salvo.
      </p>
    );
  }

  const saved = proposal.status === "saved";
  // Em uma proposta à espera, o que falta é escolhido no formulário.
  const missing = saved ? "—" : TO_CHOOSE;
  const ready = accounts.data !== undefined && categories.data !== undefined;
  const account = accounts.data?.find((candidate) => candidate.id === proposal.account_id);
  const category = categories.data
    ? categoriesById(categories.data).get(proposal.category_id ?? "")
    : undefined;
  // Uma conta ou categoria arquivada depois da proposta já não serve a um lançamento novo.
  const usableAccount = account && !account.archived ? account : undefined;
  const usableCategory = category && !category.category.archived ? category : undefined;
  // Todos os campos obrigatórios preenchidos: o lançamento pode ser salvo direto do cartão.
  const complete =
    usableAccount && usableCategory
      ? { accountId: usableAccount.id, categoryId: usableCategory.category.id }
      : null;
  const openForm = (): void =>
    review(messageId, proposal, {
      accountId: usableAccount?.id ?? null,
      categoryId: usableCategory?.category.id ?? null,
    });

  return (
    <section
      aria-label={saved ? "Lançamento salvo" : "Lançamento sugerido"}
      className="w-full rounded-lg border border-border bg-surface p-4"
    >
      <p className="text-label text-ink-muted">{TYPE_LABELS[proposal.type]}</p>
      <p
        className={cn(
          "money text-money-lg",
          proposal.type === "income" ? "text-income" : "text-ink",
        )}
      >
        {amount}
      </p>
      <p className="text-body font-bold wrap-break-word text-ink">{proposal.description}</p>

      <dl className="mt-3 divide-y divide-border border-y border-border">
        <Row label="Data">{dayLabel(proposal.date)}</Row>
        <Row label="Conta">
          {!ready && <Skeleton className="h-4 w-24" />}
          {ready && (account ? <span className="truncate">{account.name}</span> : missing)}
        </Row>
        <Row label="Categoria">
          {!ready && <Skeleton className="h-4 w-24" />}
          {ready &&
            (category ? (
              <>
                <CategoryChip
                  size="sm"
                  color={category.category.color}
                  icon={category.category.icon}
                />
                <span className="truncate">{category.label}</span>
              </>
            ) : (
              missing
            ))}
        </Row>
      </dl>

      {saved ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3">
          <p className="flex items-center gap-2 text-label text-income">
            <CircleCheck aria-hidden="true" className="size-5" />
            Lançamento salvo
          </p>
          <TextLink
            to={`${paths.transactions}${monthSearch(yearMonthOf(proposal.date))}`}
            standalone
            className="text-small"
          >
            Ver nos lançamentos
          </TextLink>
        </div>
      ) : (
        // No celular os botões não cabem lado a lado: ficam empilhados, na largura toda.
        <div className="mt-4 grid gap-2 sm:flex">
          {/* Enquanto as contas e as categorias carregam, ainda não se sabe se dá para salvar. */}
          {(complete || !ready) && (
            <Button
              disabled={!complete || discard.isPending}
              loading={isSaving}
              onClick={() => {
                if (!complete) return;
                save(messageId, proposal, complete, {
                  // A recusa de um campo já diz o que fazer com ele.
                  onError: (error) =>
                    toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
                });
              }}
            >
              Salvar
            </Button>
          )}
          <Button
            variant={complete || !ready ? "secondary" : "primary"}
            disabled={!ready || discard.isPending || isSaving}
            onClick={openForm}
          >
            Ajustar
          </Button>
          <Button
            variant="ghost"
            disabled={isSaving}
            loading={discard.isPending}
            onClick={() =>
              discard.mutate(messageId, { onError: (error) => toast.error(errorMessage(error)) })
            }
          >
            Descartar
          </Button>
        </div>
      )}
    </section>
  );
}

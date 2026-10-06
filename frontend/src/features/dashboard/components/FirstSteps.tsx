import { Check } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { cn } from "../../../lib/cn";
import { paths } from "../../../lib/paths";

export interface FirstStepsProps {
  /** O primeiro passo já foi dado: existe pelo menos uma conta ativa. */
  hasAccount: boolean;
  /** Abre a folha de novo lançamento. */
  onLaunch: () => void;
}

interface Step {
  title: string;
  description: string;
  done: boolean;
}

/**
 * Primeiros passos de quem ainda não tem lançamentos (FR-060): no lugar de gráficos vazios, a
 * tela diz o que fazer, na ordem, e oferece a ação do passo em que a pessoa está.
 */
export function FirstSteps({ hasAccount, onLaunch }: FirstStepsProps) {
  const navigate = useNavigate();
  const steps: Step[] = [
    {
      title: "Cadastre uma conta",
      description: "Pode ser a conta do banco, um cartão de crédito ou o dinheiro da carteira.",
      done: hasAccount,
    },
    {
      title: "Faça seu primeiro lançamento",
      description: "Anote uma despesa ou uma receita. O saldo da conta se ajusta na hora.",
      done: false,
    },
    {
      title: "Acompanhe o mês por aqui",
      description:
        "Esta tela passa a mostrar quanto entrou, quanto saiu e para onde foi o dinheiro.",
      done: false,
    },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <Card title="Comece por aqui">
      <ol className="grid gap-4">
        {steps.map((step, index) => (
          <li
            key={step.title}
            aria-current={index === current ? "step" : undefined}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-label",
                step.done && "bg-income-soft text-income",
                !step.done && index === current && "bg-primary text-on-primary",
                !step.done && index !== current && "bg-bg-sunken text-ink-muted",
              )}
            >
              {step.done ? <Check className="size-4.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className="grid gap-0.5">
              <span className="text-body font-bold text-ink">
                {step.title}
                {step.done && <span className="font-normal text-ink-muted"> (feito)</span>}
              </span>
              <span className="text-body text-ink-muted">{step.description}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        {hasAccount ? (
          <Button onClick={onLaunch}>Fazer um lançamento</Button>
        ) : (
          <Button onClick={() => void navigate(paths.accounts)}>Cadastrar conta</Button>
        )}
        <TextLink to={paths.categories} standalone>
          Ver as categorias prontas
        </TextLink>
      </div>
    </Card>
  );
}

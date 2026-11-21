// Tela temporária da prova do código compartilhado (T008). Ela mostra, no iPhone, os mesmos
// três resultados que `src/lib/web-imports.test.ts` confere no Jest. O motor de JavaScript do
// app (Hermes) é diferente do Node, e o fuso de Brasília depende do `Intl` dele. Esta tela sai
// no D2, quando as rotas `(auth)` e `(app)` chegarem; até lá, ela também mostra o tema e as
// fontes funcionando.
import { transactionSchema } from "@web/features/transactions/schemas";
import { today } from "@web/lib/dates";
import { formatBRL } from "@web/lib/money";

import { MoneyText } from "@/components/ui/MoneyText";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useSession } from "@/features/auth/SessionProvider";

const schemaResult = transactionSchema.safeParse({
  type: "expense",
  amountCents: 0,
  description: "",
  categoryId: "",
  accountId: "",
  installments: "1",
  fromAccountId: "",
  toAccountId: "",
  date: "2026-11-18",
  notes: "",
});

const checks = [
  { label: "Dinheiro", expected: "R$ 1.234,56", actual: formatBRL(123456) },
  {
    label: "Dia em Brasília às 02h30 UTC",
    expected: "2026-11-01",
    actual: today(new Date("2026-11-02T02:30:00Z")),
  },
  {
    label: "Schema do site recusa valor zero",
    expected: "recusado",
    actual: schemaResult.success ? "aceito" : "recusado",
  },
];

const SESSION_LABELS = {
  loading: "verificando…",
  signedOut: "fora da conta",
  signedIn: "dentro da conta",
} as const;

export default function SharedCodeCheck() {
  const session = useSession();
  return (
    <Screen title="Prova do código do site">
      {checks.map((check) => {
        // O "R$" do site usa espaço inseparável; aqui a comparação ignora o tipo de espaço.
        const ok = check.actual.replace(/\s/g, " ") === check.expected;
        return (
          <Text key={check.label} variant="body">
            {ok ? "✅" : "❌"} {check.label}: {check.actual}
          </Text>
        );
      })}
      <MoneyText cents={4590} variant="moneyHero" />
      <Text variant="small" color="inkMuted">
        Sessão: {SESSION_LABELS[session.status]}
      </Text>
    </Screen>
  );
}

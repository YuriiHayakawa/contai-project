// Só no servidor de desenvolvimento (/dev/componentes): a casca do app e os componentes base,
// para conferir os dois temas sem depender de login. Não entra no build de produção.
import { Plus, Wallet } from "lucide-react";
import { useState } from "react";

import { AppShell, PageContent } from "../components/layout/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CategoryChip } from "../components/ui/CategoryChip";
import {
  CATEGORY_COLOR_LABELS,
  SELECTABLE_CATEGORY_COLORS,
} from "../components/ui/category-colors";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { MoneyInput } from "../components/ui/MoneyInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Select } from "../components/ui/Select";
import { SkeletonList } from "../components/ui/Skeleton";
import { TextField } from "../components/ui/TextField";
import { useToast } from "../components/ui/Toast";
import { dayLabel, monthLabel, today, yearMonthOf } from "../lib/dates";
import { formatBRL } from "../lib/money";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../lib/theme";

type EntryType = "expense" | "income" | "transfer";

const themeOptions = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "auto", label: "Automático" },
] as const;

const entryTypeOptions = [
  { value: "expense", label: "Despesa" },
  { value: "income", label: "Receita" },
  { value: "transfer", label: "Transferência" },
] as const;

const sampleIcons = [
  "car",
  "utensils",
  "repeat",
  "banknote",
  "ticket",
  "house",
  "book-open",
  "pill",
];

export function ShowcasePage() {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [amount, setAmount] = useState(4590);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const changeTheme = (choice: ThemeChoice): void => {
    setTheme(choice);
    setThemeChoice(choice);
  };

  return (
    <AppShell
      userName="Marina Duarte"
      onNewTransaction={() => setModalOpen(true)}
      onSignOut={() => toast.info("Sair da conta entra com a tela de entrada.")}
    >
      <PageContent>
        <PageHeader
          title={monthLabel(yearMonthOf())}
          action={
            <Button variant="ghost" size="compact" onClick={() => setModalOpen(true)}>
              Abrir folha
            </Button>
          }
        />

        <div className="grid gap-6">
          <SegmentedControl
            label="Tema"
            options={themeOptions}
            value={theme}
            onChange={changeTheme}
          />

          <section className="grid gap-1">
            <p className="text-small text-ink-muted">Saldo do mês · {dayLabel(today())}</p>
            <p className="money text-money-hero text-ink lg:text-money-hero-lg">
              <span className="marca-texto">{formatBRL(184230)}</span>
            </p>
            <p className="flex gap-6 text-small text-ink-muted">
              <span>
                Entradas{" "}
                <strong className="money text-money-sm text-income">
                  {formatBRL(520000, { sign: "always" })}
                </strong>
              </span>
              <span>
                Saídas{" "}
                <strong className="money text-money-sm text-expense">{formatBRL(-335770)}</strong>
              </span>
            </p>
          </section>

          <Card title="Botões">
            <div className="flex flex-wrap gap-3">
              <Button icon={<Plus />}>Salvar lançamento</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="ghost">Ver todas</Button>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Excluir
              </Button>
              <Button loading>Salvando</Button>
              <Button disabled>Desativado</Button>
            </div>
          </Card>

          <Card title="Campos">
            <div className="grid gap-4">
              <SegmentedControl
                label="Tipo de lançamento"
                hideLabel
                options={entryTypeOptions}
                value={entryType}
                onChange={setEntryType}
              />
              <MoneyInput
                value={amount}
                onChange={setAmount}
                tone={entryType === "income" ? "income" : "ink"}
              />
              <TextField label="Descrição" placeholder="Padaria, mercado, aluguel" />
              <TextField label="Observação" optional help="Só você vê esta anotação." />
              <TextField
                label="E-mail"
                type="email"
                defaultValue="marina@"
                error="Escreva o e-mail completo, como nome@exemplo.com."
              />
              <TextField label="Senha" type="password" defaultValue="caderneta" />
              <Select
                label="Conta"
                placeholder="Escolha uma conta"
                options={[
                  { value: "1", label: "Conta corrente" },
                  { value: "2", label: "Cartão de crédito" },
                ]}
              />
            </div>
          </Card>

          <Card title="Cores de categoria">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SELECTABLE_CATEGORY_COLORS.map((color, index) => (
                <li key={color} className="flex items-center gap-2">
                  <CategoryChip color={color} icon={sampleIcons[index] ?? "shapes"} />
                  <span className="text-small text-ink">{CATEGORY_COLOR_LABELS[color]}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Avisos">
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => toast.success("Lançamento salvo.")}>
                Sucesso
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.info("Lançamento excluído.", {
                    action: { label: "Desfazer", onClick: () => toast.success("Desfeito.") },
                  })
                }
              >
                Com ação
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast.error("Não foi possível salvar. Tente de novo.")}
              >
                Erro
              </Button>
            </div>
          </Card>

          <Card title="Carregando" flush>
            <SkeletonList rows={3} />
          </Card>

          <Card>
            <EmptyState
              kind="first-time"
              icon={Wallet}
              title="Cadastre sua primeira conta"
              description="Com uma conta cadastrada, você já pode anotar seus gastos."
              actionLabel="Cadastrar conta"
              onAction={() => toast.info("O cadastro de contas chega em breve.")}
            />
          </Card>
        </div>
      </PageContent>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Novo lançamento"
        size="form"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Salvar lançamento</Button>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <MoneyInput value={amount} onChange={setAmount} />
          <TextField label="Descrição" />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Excluir este lançamento?"
        description="O lançamento sai da sua lista e dos totais do mês. Não dá para desfazer."
        confirmLabel="Excluir"
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
    </AppShell>
  );
}

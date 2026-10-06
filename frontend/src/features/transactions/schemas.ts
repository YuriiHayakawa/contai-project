// Validação do formulário de lançamento. Cada mensagem diz o que fazer, e não só o que falhou.
import { z } from "zod";

export const SAME_ACCOUNT_MESSAGE = "Escolha duas contas diferentes: a de origem e a de destino.";
export const INSTALLMENT_TOO_SMALL_MESSAGE =
  "O valor total precisa dar pelo menos R$ 0,01 em cada parcela.";

export const transactionSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer"]),
    /** Inteiro em centavos, sempre positivo; o sinal vem do tipo. Na compra parcelada, o total. */
    amountCents: z.number().int().positive("Informe um valor maior que zero."),
    description: z
      .string()
      .trim()
      .min(1, "Escreva o que foi, como o nome da loja.")
      .max(200, "Use uma descrição com até 200 caracteres."),
    /** Só em despesa e receita. */
    categoryId: z.string(),
    accountId: z.string(),
    /** "1" é à vista; de "2" a "48", compra parcelada no cartão. */
    installments: z.string(),
    /** Só em transferência: de onde sai e para onde vai o dinheiro. */
    fromAccountId: z.string(),
    toAccountId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data do lançamento."),
    notes: z.string().trim().max(1000, "Use uma observação com até 1.000 caracteres."),
  })
  .superRefine((values, context) => {
    const missing = (path: string, message: string): void => {
      context.addIssue({ code: "custom", path: [path], message });
    };
    if (values.type === "transfer") {
      if (!values.fromAccountId) missing("fromAccountId", "Escolha de onde sai o dinheiro.");
      if (!values.toAccountId) missing("toAccountId", "Escolha para onde vai o dinheiro.");
      if (values.fromAccountId && values.fromAccountId === values.toAccountId) {
        missing("toAccountId", SAME_ACCOUNT_MESSAGE);
      }
      return;
    }
    if (!values.categoryId) missing("categoryId", "Escolha uma categoria.");
    if (!values.accountId) missing("accountId", "Escolha uma conta.");
    const installments = Number(values.installments);
    if (installments > 1 && values.amountCents > 0 && values.amountCents < installments) {
      missing("amountCents", INSTALLMENT_TOO_SMALL_MESSAGE);
    }
  });

export type TransactionFormValues = z.infer<typeof transactionSchema>;

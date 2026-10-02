// Validação do formulário de lançamento. Cada mensagem diz o que fazer, e não só o que falhou.
import { z } from "zod";

export const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  /** Inteiro em centavos, sempre positivo; o sinal vem do tipo. */
  amountCents: z.number().int().positive("Informe um valor maior que zero."),
  description: z
    .string()
    .trim()
    .min(1, "Escreva o que foi, como o nome da loja.")
    .max(200, "Use uma descrição com até 200 caracteres."),
  categoryId: z.string().min(1, "Escolha uma categoria."),
  accountId: z.string().min(1, "Escolha uma conta."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data do lançamento."),
  notes: z.string().trim().max(1000, "Use uma observação com até 1.000 caracteres."),
});

export type TransactionFormValues = z.infer<typeof transactionSchema>;

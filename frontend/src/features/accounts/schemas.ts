// Validação do formulário de conta. Cada mensagem diz o que fazer, e não só o que falhou.
import { z } from "zod";

const DAY_PATTERN = /^([1-9]|[12]\d|3[01])$/;
const DAY_MESSAGE = "Escreva um dia de 1 a 31.";

export const accountSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Dê um nome à conta, como o do banco ou do cartão.")
      .max(60, "Use um nome com até 60 caracteres."),
    type: z.enum(["checking", "credit_card", "cash", "savings", "investment"]),
    institution: z.string().trim().max(60, "Use até 60 caracteres."),
    /**
     * Sempre positivo. Em cartão é quanto já se deve nele; nas outras contas, o saldo inicial,
     * com o sinal em `negative`.
     */
    balanceCents: z.number().int().min(0),
    /** Só fora de cartão: no cartão o valor é sempre uma dívida. */
    negative: z.boolean(),
    /** Só em cartão; zero é "sem limite informado". */
    limitCents: z.number().int().min(0),
    balanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data deste saldo."),
    /** Só em cartão de crédito; nos outros tipos ficam vazios e não são enviados. */
    closingDay: z.string().trim(),
    dueDay: z.string().trim(),
  })
  .superRefine((values, context) => {
    if (values.type !== "credit_card") return;
    for (const field of ["closingDay", "dueDay"] as const) {
      if (!DAY_PATTERN.test(values[field])) {
        context.addIssue({ code: "custom", path: [field], message: DAY_MESSAGE });
      }
    }
  });

export type AccountFormValues = z.infer<typeof accountSchema>;

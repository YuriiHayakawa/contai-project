// Validação das telas de importação. Cada mensagem diz o que fazer, e não só o que falhou.
import { z } from "zod";

/** Tamanho máximo do arquivo, igual ao do servidor (FR-037). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TOO_LARGE_MESSAGE =
  "Este arquivo tem mais de 10 MB. Exporte um período menor no banco e envie de novo.";
export const FILE_EMPTY_MESSAGE =
  "Este arquivo está vazio. Exporte o extrato de novo no banco e envie outra vez.";
export const FILE_REQUIRED_MESSAGE = "Escolha o arquivo do extrato.";

/**
 * O que uma linha da revisão vira: despesa, receita, estorno (uma receita na categoria de
 * despesa da compra, FR-084) ou transferência para outra conta, como o pagamento de uma fatura.
 */
export const LINE_KINDS = ["expense", "income", "refund", "transfer"] as const;

/** Uma linha da revisão, como será salva. Só as linhas marcadas precisam passar por aqui. */
export const reviewLineSchema = z
  .object({
    kind: z.enum(LINE_KINDS),
    amountCents: z.number().int().positive("Informe um valor maior que zero."),
    description: z
      .string()
      .trim()
      .min(1, "Escreva o que foi, como o nome da loja.")
      .max(200, "Use uma descrição com até 200 caracteres."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data do lançamento."),
    /** Só em despesa, receita e estorno. */
    categoryId: z.string(),
    /** Só em transferência: a outra conta. */
    counterAccountId: z.string(),
  })
  .superRefine((values, context) => {
    if (values.kind === "transfer") {
      if (!values.counterAccountId) {
        context.addIssue({
          code: "custom",
          path: ["counterAccountId"],
          message: "Escolha a outra conta da transferência.",
        });
      }
      return;
    }
    if (!values.categoryId) {
      context.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "Escolha uma categoria.",
      });
    }
  });

export type ReviewLineValues = z.infer<typeof reviewLineSchema>;
export type LineKind = ReviewLineValues["kind"];

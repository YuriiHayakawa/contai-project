// Validação do formulário de categoria. Cada mensagem diz o que fazer, e não só o que falhou.
import { z } from "zod";

export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome à categoria.")
    .max(40, "Use um nome com até 40 caracteres."),
  kind: z.enum(["expense", "income"]),
  /** Vazio em uma categoria principal. */
  parentId: z.string(),
  icon: z.string().min(1, "Escolha um ícone."),
  color: z.string().min(1, "Escolha uma das oito cores."),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

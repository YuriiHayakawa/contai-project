// Validação dos formulários de acesso. Cada mensagem diz o que fazer, e não só o que falhou.
// A recusa de senhas comuns é do servidor, que tem a lista; a resposta dele aparece no campo.
import { z } from "zod";

export const PRIVACY_POLICY_REQUIRED_MESSAGE =
  "Para criar a conta, é preciso aceitar a política de privacidade.";

// O mesmo formato conferido pela API: algo antes do @, um domínio com ponto e nenhum espaço.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const email = z
  .string()
  .trim()
  .min(1, "Escreva seu e-mail.")
  .max(254, "Esse e-mail é longo demais. Confira se está certo.")
  .regex(EMAIL_PATTERN, "Escreva o e-mail completo, como nome@exemplo.com.");

const newPassword = z
  .string()
  .min(8, "Use uma senha com pelo menos 8 caracteres.")
  .max(128, "Use uma senha com no máximo 128 caracteres.");

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Escreva seu nome.")
    .max(100, "Use um nome com até 100 caracteres."),
  email,
  password: newPassword,
  acceptPrivacyPolicy: z
    .boolean()
    .refine((accepted) => accepted, { message: PRIVACY_POLICY_REQUIRED_MESSAGE }),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Escreva seu e-mail."),
  password: z.string().min(1, "Escreva sua senha."),
});

export const emailOnlySchema = z.object({ email });

export const resetPasswordSchema = z.object({ newPassword });

export type RegisterFormValues = z.infer<typeof registerSchema>;
export type LoginFormValues = z.infer<typeof loginSchema>;
export type EmailOnlyFormValues = z.infer<typeof emailOnlySchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

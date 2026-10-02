/** Endereços das telas. Rotas e links usam estas constantes, nunca o texto solto. */
export const paths = {
  home: "/",
  transactions: "/lancamentos",
  accounts: "/contas",
  categories: "/categorias",
  imports: "/importacoes",
  assistant: "/assistente",
  settings: "/configuracoes",
  login: "/entrar",
  register: "/criar-conta",
  // Os dois caminhos abaixo estão nos links dos e-mails enviados pelo backend
  // (backend/app/modules/auth/emails.py): mudar aqui exige mudar lá.
  verifyEmail: "/confirmar-email",
  resetPassword: "/redefinir-senha",
  forgotPassword: "/esqueci-a-senha",
  privacy: "/privacidade",
} as const;

/** Estado de navegação levado à tela de entrada pelo guard de rotas. */
export interface LoginLocationState {
  /** Endereço em que o usuário estava; é para lá que ele volta depois de entrar. */
  from: string;
}

/**
 * Para onde ir depois do login: a rota de origem, se veio do guard, ou o início. Só aceita
 * caminhos do próprio app, para um endereço montado por terceiros não levar a outro site.
 */
export function returnPathFrom(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) return paths.home;
  const { from } = state;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return paths.home;
  return from === paths.login ? paths.home : from;
}

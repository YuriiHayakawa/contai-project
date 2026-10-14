/** Endereços das telas. Rotas e links usam estas constantes, nunca o texto solto. */
export const paths = {
  home: "/",
  transactions: "/lancamentos",
  accounts: "/contas",
  cards: "/cartoes",
  categories: "/categorias",
  imports: "/importacoes",
  importNew: "/importacoes/nova",
  // Andamento, colunas e revisão de uma importação; `:importId` é o id dela.
  importDetail: "/importacoes/:importId",
  importReview: "/importacoes/:importId/revisao",
  assistant: "/assistente",
  // O chat: sem `:conversationId`, uma conversa nova; com ele, uma conversa do histórico.
  assistantChat: "/assistente/:conversationId?",
  settings: "/configuracoes",
  // Tela única de quem entrou com a conta em exclusão: mostra a data e deixa cancelar.
  pendingDeletion: "/conta/exclusao",
  login: "/entrar",
  register: "/criar-conta",
  // Segunda etapa do login (código do app) e o pedido de desativação para quem perdeu o acesso.
  twoFactorLogin: "/entrar/duas-etapas",
  twoFactorResetRequest: "/entrar/recuperar-acesso",
  // Os caminhos abaixo estão nos links dos e-mails enviados pelo backend
  // (backend/app/modules/auth/emails.py): mudar aqui exige mudar lá.
  verifyEmail: "/confirmar-email",
  resetPassword: "/redefinir-senha",
  forgotPassword: "/esqueci-a-senha",
  twoFactorResetConfirm: "/desativar-duas-etapas/confirmar",
  twoFactorResetCancel: "/desativar-duas-etapas/cancelar",
  privacy: "/privacidade",
} as const;

/** Parâmetros do endereço da tela de cartões: o cartão e a fatura abertos nela. */
export const CARD_PARAM = "cartao";
export const INVOICE_PARAM = "fatura";

/**
 * Endereço da tela de um cartão. Sem `invoice`, ela abre na fatura a pagar ou, sem nenhuma, na
 * atual; com ele (o mês em que a fatura fecha, `AAAA-MM`), já abre nela.
 */
export function cardPath(cardId: string, invoice?: string): string {
  const params = new URLSearchParams({ [CARD_PARAM]: cardId });
  if (invoice) params.set(INVOICE_PARAM, invoice);
  return `${paths.cards}?${params.toString()}`;
}

/** Endereço do andamento de uma importação, que leva ao mapeamento ou à revisão. */
export function importPath(importId: string): string {
  return `${paths.imports}/${importId}`;
}

/** Endereço da revisão de uma importação. */
export function importReviewPath(importId: string): string {
  return `${importPath(importId)}/revisao`;
}

/** Endereço de uma conversa com o assistente. */
export function conversationPath(conversationId: string): string {
  return `${paths.assistant}/${conversationId}`;
}

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

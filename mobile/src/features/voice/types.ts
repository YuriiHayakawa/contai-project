// Tokens pessoais da Siri (contracts/rest-api.md, "Tokens pessoais").

export interface AccountRef {
  id: string;
  name: string;
}

/** Um token ativo, como a API mostra: nunca o segredo nem o hash. */
export interface PersonalToken {
  id: string;
  name: string;
  default_account: AccountRef | null;
  /** A conta padrão foi arquivada ou apagada: frases sem conta não são lançadas. */
  needs_default_account: boolean;
  created_at: string;
  last_used_at: string | null;
}

/** A criação: a única resposta que traz o token completo. */
export interface PersonalTokenCreated extends PersonalToken {
  token: string;
}

export interface PersonalTokenList {
  items: PersonalToken[];
}

export interface PersonalTokenInput {
  name: string;
  default_account_id: string;
}

/** No máximo 5 ativos por usuário. */
export const MAX_ACTIVE_TOKENS = 5;

/** O endereço que o atalho chama; o atalho só funciona com a produção. */
export const SIRI_URL = "https://contai-project.vercel.app/api/siri";

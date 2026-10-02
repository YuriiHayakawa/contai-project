// Tipos das rotas de Auth e do perfil (contracts/rest-api.md). Os nomes dos campos são os da API.

/** Perfil devolvido por `GET /users/me`. */
export interface CurrentUser {
  name: string;
  email: string;
  status: "active" | "pending_deletion";
  two_factor_enabled: boolean;
  ai_documents_consent: boolean;
  /** Instante ISO 8601 em que a conta será apagada, quando há um pedido de exclusão. */
  deletion_scheduled_at: string | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  accept_privacy_policy: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  token: string;
  new_password: string;
}

/** Resposta do login e do refresh. O refresh token vai só no cookie `httpOnly`. */
export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

/** Resposta genérica dos pedidos que não revelam se um e-mail tem conta. */
export interface MessageResponse {
  message: string;
}

/** Estado de navegação levado à tela de confirmação depois do cadastro. */
export interface VerifyEmailLocationState {
  email: string;
}

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

/** Resposta do refresh e da segunda etapa do login. O refresh token vai só no cookie. */
export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

/**
 * Resposta do login: ou as credenciais, ou o desafio da segunda etapa. Com a verificação em
 * duas etapas ativa, a senha correta devolve `two_factor_required` e um `challenge_token`.
 */
export interface LoginResponse {
  access_token: string | null;
  token_type: "bearer" | null;
  two_factor_required: boolean;
  challenge_token: string | null;
}

/** Segunda etapa do login: o desafio e um código do app ou de recuperação. */
export interface TwoFactorLoginInput {
  challenge_token: string;
  code?: string;
  recovery_code?: string;
}

/** Resposta de `POST /auth/2fa/reset/confirm`: quando a desativação passa a valer. */
export interface TwoFactorResetConfirmResponse {
  effective_at: string;
}

/** Começo da ativação: o segredo em texto e o `otpauth://` que o QR code representa. */
export interface TwoFactorSetup {
  otpauth_uri: string;
  secret: string;
}

/** Os 10 códigos de recuperação, devolvidos uma única vez. */
export interface RecoveryCodes {
  recovery_codes: string[];
}

/** Uma sessão ativa na tela de dispositivos conectados. */
export interface SessionInfo {
  id: string;
  device: string;
  last_used_at: string;
  is_current: boolean;
}

/** Estado de navegação levado à etapa do código e ao pedido de recuperação. */
export interface TwoFactorLocationState {
  challengeToken: string;
  /** Endereço para onde voltar depois de concluir a entrada. */
  from?: string;
}

/** Resposta genérica dos pedidos que não revelam se um e-mail tem conta. */
export interface MessageResponse {
  message: string;
}

/** Estado de navegação levado à tela de confirmação depois do cadastro. */
export interface VerifyEmailLocationState {
  email: string;
}

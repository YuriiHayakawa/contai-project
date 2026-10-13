// Entradas das rotas de conta (contracts/rest-api.md). As saídas reaproveitam os tipos de auth.

export interface UpdateProfileInput {
  name: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

/** Desativar a verificação em duas etapas ou gerar novos códigos: exige senha e um código. */
export interface TwoFactorPasswordCode {
  password: string;
  code: string;
}

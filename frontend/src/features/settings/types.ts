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

/** Pedido de exclusão da conta: exige a senha e, com as duas etapas ativas, o código. */
export interface AccountDeletionInput {
  password: string;
  code?: string;
}

/** Resposta ao pedido de exclusão: quando a conta será apagada de vez. */
export interface AccountDeletion {
  deletion_scheduled_at: string;
}

/** Perfil devolvido por `GET /users/me` (contracts/rest-api.md). */
export interface CurrentUser {
  name: string;
  email: string;
  status: "active" | "pending_deletion";
  two_factor_enabled: boolean;
  ai_documents_consent: boolean;
  /** Instante ISO 8601 em que a conta será apagada, quando há um pedido de exclusão. */
  deletion_scheduled_at: string | null;
}

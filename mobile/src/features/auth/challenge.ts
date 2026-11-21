// O desafio da segunda etapa, entre a tela da senha e a do código. Fica só em memória, e não no
// endereço da rota: ele vale 5 minutos e não deve aparecer em logs de navegação.
let pendingChallenge: string | null = null;

export function setPendingChallenge(token: string | null): void {
  pendingChallenge = token;
}

export function readPendingChallenge(): string | null {
  return pendingChallenge;
}

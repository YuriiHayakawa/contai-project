// Valor em reais por extenso, para o VoiceOver: "R$ 45,90" lido como "45 reais e 90 centavos".
// Sem ponto flutuante: o valor chega em centavos inteiros (Princípio VIII).

const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function reaisPart(reais: number): string {
  return reais === 1 ? "1 real" : `${integerFormat.format(reais)} reais`;
}

function centavosPart(centavos: number): string {
  return centavos === 1 ? "1 centavo" : `${centavos} centavos`;
}

/** `4590` vira "45 reais e 90 centavos"; `-100` vira "menos 1 real". */
export function spokenBRL(cents: number): string {
  const absolute = Math.abs(Math.trunc(cents));
  const reais = Math.trunc(absolute / 100);
  const centavos = absolute % 100;

  let spoken: string;
  if (centavos === 0) spoken = reaisPart(reais);
  else if (reais === 0) spoken = centavosPart(centavos);
  else spoken = `${reaisPart(reais)} e ${centavosPart(centavos)}`;

  return cents < 0 ? `menos ${spoken}` : spoken;
}

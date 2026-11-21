import { spokenBRL } from "./spoken-money";

describe("valor por extenso para o VoiceOver", () => {
  it.each([
    [4590, "45 reais e 90 centavos"],
    [4500, "45 reais"],
    [100, "1 real"],
    [101, "1 real e 1 centavo"],
    [90, "90 centavos"],
    [1, "1 centavo"],
    [123400, "1.234 reais"],
    [0, "0 reais"],
    [-4590, "menos 45 reais e 90 centavos"],
  ])("%i centavos: %s", (cents, spoken) => {
    expect(spokenBRL(cents)).toBe(spoken);
  });
});

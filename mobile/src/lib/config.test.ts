import { readConfig } from "./config";

describe("configuração do app", () => {
  it("aceita a produção e tira a barra do fim", () => {
    const config = readConfig(
      { apiUrl: "https://contai-project.vercel.app/", shortcutUrl: "" },
      false,
    );
    expect(config).toEqual({ apiUrl: "https://contai-project.vercel.app", shortcutUrl: null });
  });

  it("recusa http fora do desenvolvimento", () => {
    expect(() =>
      readConfig({ apiUrl: "http://192.168.0.10:8080", shortcutUrl: "" }, false),
    ).toThrow("mobile/.env");
  });

  it("aceita a API local por http no desenvolvimento", () => {
    const config = readConfig({ apiUrl: "http://192.168.0.10:8080", shortcutUrl: undefined }, true);
    expect(config.apiUrl).toBe("http://192.168.0.10:8080");
  });

  it("guarda o link do atalho quando existe", () => {
    const config = readConfig(
      {
        apiUrl: "https://contai-project.vercel.app",
        shortcutUrl: "https://www.icloud.com/shortcuts/abc",
      },
      false,
    );
    expect(config.shortcutUrl).toBe("https://www.icloud.com/shortcuts/abc");
  });

  it("exige o endereço da API", () => {
    expect(() => readConfig({ apiUrl: undefined, shortcutUrl: undefined }, true)).toThrow();
  });
});

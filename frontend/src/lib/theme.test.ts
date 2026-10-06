import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeChoice,
  resolveTheme,
  setThemeChoice,
} from "./theme";

function stubSystemTheme(dark: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: dark && query === "(prefers-color-scheme: dark)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tema", () => {
  it("sem escolha salva, vale Automático", () => {
    expect(getThemeChoice()).toBe("auto");
  });

  it("grava Claro ou Escuro e aplica no <html> na hora", () => {
    expect(setThemeChoice("dark")).toBe("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getThemeChoice()).toBe("dark");
  });

  it("Automático apaga a escolha e segue o sistema", () => {
    setThemeChoice("light");
    stubSystemTheme(true);

    expect(setThemeChoice("auto")).toBe("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resolve Automático pela preferência do sistema", () => {
    stubSystemTheme(false);
    expect(resolveTheme("auto")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("ignora um valor desconhecido no armazenamento", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "roxo");

    expect(getThemeChoice()).toBe("auto");
  });

  it("continua funcionando com o armazenamento bloqueado", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Bloqueado", "SecurityError");
    });

    expect(getThemeChoice()).toBe("auto");
    expect(setThemeChoice("dark")).toBe("dark");
    expect(applyTheme("light")).toBe("light");
  });
});

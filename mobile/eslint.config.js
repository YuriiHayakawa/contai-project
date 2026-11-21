// Lint do app. Mesmo rigor do site (Princípio II): zero `any`.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// O app só reaproveita do site código puro: dinheiro, datas, caminhos, tipos e schemas
// (research, seção 4). Qualquer outra importação de `@web/` é proibida.
const WEB_IMPORT_ALLOWED = "^@web/(?!(lib/(money|dates|paths)|features/[^/]+/(types|schemas))$)";

module.exports = defineConfig([
  expoConfig,
  { ignores: ["dist/*", "coverage/*", ".expo/*", "node_modules/*"] },
  {
    // Arquivos de configuração rodam no Node.
    files: ["*.config.js"],
    languageOptions: {
      globals: { __dirname: "readonly", require: "readonly", module: "writable" },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: WEB_IMPORT_ALLOWED,
              message:
                "Do site, o app só importa lib/money, lib/dates, lib/paths e os types e schemas das features.",
            },
          ],
        },
      ],
    },
  },
]);

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", "public"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    rules: {
      // Princípio II da constituição: zero any, implícito ou explícito.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // A configuração e a função da Siri na Vercel (`api/`) rodam no Node.
    files: ["vite.config.ts", "eslint.config.js", "api/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);

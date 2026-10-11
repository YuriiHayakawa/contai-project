import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // No contêiner de desenvolvimento, o volume não propaga eventos de arquivo no Windows.
    watch: { usePolling: process.env.VITE_USE_POLLING === "true" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    // Em paralelo, uma tela com `import()` próprio pode demorar mais para a primeira pintura; os
    // limites acomodam o `asyncUtilTimeout` de 5s do test-setup, sem reduzir o paralelismo.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

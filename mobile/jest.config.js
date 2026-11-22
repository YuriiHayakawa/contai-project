// Testes do app com jest-expo. `@web/*` aponta para o código puro do site e `zod` sempre
// resolve para a cópia do app (research, seção 4).
const path = require("node:path");

const mobileZod = path.dirname(require.resolve("zod/package.json", { paths: [__dirname] }));

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@web/(.*)$": "<rootDir>/../frontend/src/$1",
    "^zod$": mobileZod,
  },
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/app/"],
  // No CI, os arquivos rodam em paralelo num contêiner pequeno: um teste com folhas e toques
  // pode passar dos 5 s padrão sem estar errado. O site usa o mesmo limite.
  testTimeout: 20000,
};

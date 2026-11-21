// Metro do app. O app importa código puro do site (dinheiro, datas, tipos e schemas) pelo
// apelido `@web/*`, que aponta para `frontend/src` (research, seção 4).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const webSource = path.resolve(__dirname, "../frontend/src");
const mobileZod = path.dirname(require.resolve("zod/package.json", { paths: [__dirname] }));

config.watchFolders = [...(config.watchFolders ?? []), webSource];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Uma cópia só do zod: os schemas do site resolvem para o zod do app, e não para o do
  // `frontend/node_modules` (research, seção 4).
  if (moduleName === "zod" || moduleName.startsWith("zod/")) {
    const target = moduleName === "zod" ? mobileZod : path.join(mobileZod, moduleName.slice(4));
    return context.resolveRequest(context, target, platform);
  }
  if (moduleName.startsWith("@web/")) {
    const target = path.join(webSource, moduleName.slice("@web/".length));
    return context.resolveRequest(context, target, platform);
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;

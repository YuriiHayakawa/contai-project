# Imagem do frontend: servidor do Vite em desenvolvimento, build estático em produção.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Desenvolvimento: servidor do Vite com recarga automática; o código vem por volume.
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Build de produção.
FROM deps AS build
COPY . .
RUN npm run build

# Produção: só os arquivos estáticos, servidos por Caddy.
FROM caddy:2-alpine AS prod
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80

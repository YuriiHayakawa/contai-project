# Imagem do frontend para o ambiente local: servidor do Vite com recarga automática.
# Em produção, a Vercel faz o build e serve os arquivos estáticos (frontend/vercel.json).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# O código vem por volume.
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

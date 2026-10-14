# Contaí

Controle financeiro pessoal em português do Brasil: lançar e importar gastos e receitas, ver para
onde o dinheiro vai, acompanhar contas e cartões e conversar com um assistente que responde com os
próprios números da sua conta — sempre com os dados de cada pessoa isolados dos demais.

> Projeto do MVP `001-contai-mvp`. A especificação completa, o plano e as tarefas estão em
> [`specs/001-contai-mvp/`](specs/001-contai-mvp/); as decisões técnicas, em
> [`docs/adr/`](docs/adr/).

## Visão

O Contaí nasceu para ser um controle financeiro que uma pessoa leiga entende e confia:

- **Lançar é rápido**: à mão, por texto para o assistente, ou importando extratos e comprovantes
  (OFX, CSV, planilha, PDF e imagem).
- **Os números nunca mentem**: saldo e fatura são sempre calculados a partir das transações, e o
  assistente só afirma valores que vieram das ferramentas do próprio sistema.
- **Privacidade em primeiro lugar**: cada pessoa vê só os próprios dados; a IA recebe o mínimo
  necessário; os documentos enviados são apagados depois de lidos; dá para baixar tudo e excluir a
  conta.
- **Acessível**: interface em 320px e desktop, temas claro e escuro, navegação por teclado,
  contraste conferido e suporte a movimento reduzido.

As dez histórias de usuário do MVP (cadastro e conta, lançamentos, contas, cartões, importação,
assistente, categorias, painel, proteção da conta em duas etapas, e exportar/excluir a conta)
estão todas implementadas.

## Capturas de tela

As imagens ficam em [`docs/screenshots/`](docs/screenshots/). Veja ali como gerá-las.

| Tela | Imagem |
|------|--------|
| Painel | ![Painel](docs/screenshots/painel.png) |
| Lançamentos | ![Lançamentos](docs/screenshots/lancamentos.png) |
| Importação (revisão) | ![Revisão da importação](docs/screenshots/importacao-revisao.png) |
| Assistente | ![Assistente](docs/screenshots/assistente.png) |
| Configurações | ![Configurações](docs/screenshots/configuracoes.png) |

## Arquitetura

Tudo roda atrás de um único proxy (Caddy), na mesma origem, orquestrado por `docker compose`.

```text
                 ┌─────────────┐
   navegador ──► │    Caddy    │  HTTPS, CSP/HSTS, limite de 10 MB
                 └──────┬──────┘
          /api/* ───────┤──────── / (resto)
                 ┌──────▼──────┐        ┌──────────────┐
                 │     API     │        │   frontend   │  React + Vite + TS
                 │  (FastAPI)  │        └──────────────┘
                 └──────┬──────┘
          ┌─────────────┼───────────────┐
   ┌──────▼─────┐  ┌────▼─────┐   ┌──────▼──────┐
   │ PostgreSQL │  │  worker  │   │ volume de   │
   │   (17)     │  │ (fila de │   │  uploads    │  privado, fora do backup
   │            │  │  jobs)   │   │             │
   └────────────┘  └──────────┘   └─────────────┘
```

- **Frontend** ([`frontend/`](frontend/)): React + TypeScript + Vite, Tailwind com tokens próprios,
  React Router, TanStack Query, Recharts e Motion. Organizado por feature em
  `src/features/<domínio>/` (components, hooks, services, types).
- **Backend** ([`backend/`](backend/)): FastAPI + SQLAlchemy assíncrono + Pydantic. Organizado por
  domínio em `app/modules/<domínio>/`, cada um com `router → service → repository → models/schemas`.
  Só o repositório acessa o banco, e todo método que lida com dados do usuário exige o `user_id`.
- **Worker** ([`backend/app/worker/`](backend/app/worker/)): consome uma fila de jobs no próprio
  PostgreSQL (e-mails, importações, exclusões e limpezas periódicas). Sem broker externo.
- **Banco**: PostgreSQL 17, migrações com Alembic (rodam na subida da API).
- **Proxy**: Caddy serve o frontend e encaminha `/api/*` para a API, na mesma origem.
- **Dev**: Mailpit captura os e-mails; o Vite serve o frontend com recarga.

## Decisões técnicas

As decisões de arquitetura ficam registradas como ADRs em [`docs/adr/`](docs/adr/):

- [0001 — Fila de jobs no PostgreSQL](docs/adr/0001-fila-de-jobs-no-postgresql.md)
- [0002 — Sessões, access token e refresh token](docs/adr/0002-sessoes-e-tokens.md)
- [0003 — Camada de IA e garantia numérica](docs/adr/0003-camada-de-ia-e-garantia-numerica.md)
- [0004 — Dinheiro em centavos e saldo calculado](docs/adr/0004-dinheiro-em-centavos-e-saldo-calculado.md)
- [0005 — Importadores e duplicatas](docs/adr/0005-importadores-e-duplicatas.md)
- [0006 — Uploads em volume privado](docs/adr/0006-uploads-em-volume-privado.md)
- [0007 — Backup cifrado](docs/adr/0007-backup-cifrado.md)
- [0008 — Política de segurança de conteúdo](docs/adr/0008-politica-de-seguranca-de-conteudo.md)
- [0009 — Módulo `categorization`](docs/adr/0009-modulo-categorization.md)

O contexto completo de cada escolha está em [`specs/001-contai-mvp/research.md`](specs/001-contai-mvp/research.md).

## Como rodar localmente

Pré-requisitos: **Docker** e **Docker Compose**.

1. Copie o arquivo de exemplo de variáveis de ambiente:

   ```sh
   cp .env.example .env
   ```

   Os valores padrão já servem para desenvolvimento. Para usar a IA de verdade, defina
   `AI_PROVIDER=gemini`, `AI_API_KEY` e os modelos; sem isso, o provedor simulado (`fake`) responde
   sem acessar a rede.

2. Suba tudo:

   ```sh
   docker compose up --build
   ```

   A API aplica as migrações na subida; o worker só sobe com a API saudável.

3. Abra o app:

   - App: <http://localhost:8080>
   - E-mails (Mailpit): <http://localhost:8025> — é onde chegam os links de confirmação e de
     recuperação em desenvolvimento.

   > Em desenvolvimento use **Chrome ou Firefox**: o cookie de sessão é `Secure`, e o Safari pode
   > não guardá-lo em `http://localhost`.

### Dados de demonstração (opcional)

Para encher um ambiente local com um usuário e 5.000 lançamentos fictícios:

```sh
docker compose run --rm api python -m scripts.seed_demo
```

Entra com `demo@contai.local` / `conta demonstracao 2026`. O seed recusa-se a rodar em produção.

### Testes e qualidade

```sh
# Backend (dentro do contêiner da API)
docker compose exec api python -m pytest        # testes
docker compose exec api ruff check app tests     # lint
docker compose exec api ruff format --check app tests

# Frontend (dentro do contêiner do frontend)
docker compose exec frontend npx vitest run      # testes
docker compose exec frontend npm run lint
docker compose exec frontend npm run format:check
```

## Produção

O `docker-compose.prod.yml`, o `Caddyfile`, o serviço de backup cifrado e o deploy fazem parte da
fase de infraestrutura (ver os ADRs 0007 e 0008 e a seção 24 de
[`research.md`](specs/001-contai-mvp/research.md)). Em produção, todo segredo é gerado de novo,
`/api/docs` fica desligado e o HTTPS é automático pelo domínio configurado.

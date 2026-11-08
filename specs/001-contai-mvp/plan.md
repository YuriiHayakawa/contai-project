# Implementation Plan: Contaí — controle financeiro pessoal com assistente de IA

**Branch**: `001-contai-mvp` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Revisão**: atualizado em 2026-10-01, depois da aprovação do `design-system.md`, e em
2026-11-02, com a hospedagem em planos gratuitos (constituição 2.0.0, ADRs 0010 e 0011).

**Input**: Feature specification from `/specs/001-contai-mvp/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

O Contaí é uma aplicação web multiusuário de finanças pessoais: cada usuário cadastra contas e
categorias, lança transações à mão ou importando documentos de qualquer banco, acompanha um
painel mensal e faz perguntas em português a um assistente de IA.

A abordagem técnica é uma API FastAPI organizada por domínio (router → service → repository),
um worker embutido no processo da API que consome uma fila em tabela do PostgreSQL para
importações, e-mails e tarefas agendadas, e um frontend React servido como build estático, na
mesma origem que a API. Em produção, o site fica na Vercel, que repassa `/api` à API no Render;
no ambiente local, um Caddy faz esse papel. Três decisões sustentam os requisitos mais difíceis:

- **Números corretos**: dinheiro em centavos inteiros, saldos e faturas sempre calculados por
  consulta, e um único serviço de relatórios usado pelo painel e pelas ferramentas do assistente.
- **IA sob controle**: o modelo só chama ferramentas somente leitura, o `user_id` é injetado
  pelo backend, períodos são resolvidos por código, e o texto final só é exibido depois que cada
  valor é conferido contra os resultados das ferramentas.
- **Isolamento por construção**: todo método de repositório exige `user_id`, e um teste percorre
  todas as rotas exigindo um caso de acesso cruzado para cada uma.

Os detalhes estão em [research.md](./research.md), [data-model.md](./data-model.md) e
[contracts/](./contracts/).

## Technical Context

**Language/Version**: Python 3.12+ (backend e worker); TypeScript em modo estrito (frontend)

**Primary Dependencies**:

- Backend: FastAPI, SQLAlchemy 2.0 assíncrono com asyncpg, Alembic, Pydantic v2 e
  pydantic-settings, argon2-cffi, PyJWT, pyotp, cryptography, slowapi, ofxtools, openpyxl,
  filetype, google-genai; gerenciado com uv
- Frontend: React 19, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form com
  Zod, Recharts, lucide-react, Motion, qrcode.react; fontes Besley e Atkinson Hyperlegible Next
  servidas pelo próprio app

**Storage**: PostgreSQL (dados, fila de jobs e, até o processamento, os arquivos enviados, que
ficam fora do backup); backups cifrados guardados como artifacts num repositório privado do
GitHub

**Testing**: pytest, pytest-asyncio, httpx e pytest-cov, com PostgreSQL real em contêiner;
Vitest e Testing Library no frontend; `FakeLLMProvider` no lugar da IA

**Target Platform**: produção em planos gratuitos, sem cartão: Vercel (build estático e
repasse de `/api`), Render (API em contêiner, em Ohio) e Neon (PostgreSQL, em Ohio); ambiente
local com Docker Compose atrás do Caddy; navegadores atuais, no celular e no computador

**Project Type**: aplicação web (backend com o worker embutido, e frontend)

**Performance Goals**: painel em até 3 segundos com 5.000 transações (SC-013); 90% das perguntas
ao assistente respondidas em até 10 segundos (SC-014); lançamento manual em menos de 15 segundos
(SC-005)

**Constraints**: plano gratuito do provedor de IA (cota compartilhada entre todos os usuários);
API em instância única, com limite de frequência em memória; sem Redis nem broker externo;
planos gratuitos do Render (512 MB, serviço que dorme depois de 15 minutos sem acesso, sem disco
permanente e sem SMTP) e do Neon (100 CU-horas por mês, 1 GB);
arquivos de até 10 MB; telas a partir de 320px; WCAG 2.1 AA; interface em português do Brasil

**Scale/Scope**: dezenas de usuários, cada um com alguns milhares de transações por ano; 10
histórias de usuário, 83 requisitos funcionais, 17 tabelas, cerca de 70 endpoints, 8 features de
frontend

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano atende | Situação |
|-----------|---------------------|----------|
| I. Qualidade de código — backend | mypy strict e Ruff no CI; schemas `Create`/`Update`/`Read` por módulo; rotas só validam, chamam o serviço e formatam; exceções de domínio convertidas em `core/errors.py` | Passa |
| II. Qualidade de código — frontend | `strict: true`; componentes funcionais; `types.ts` por feature; HTTP só em `services/`, consumido por hooks do TanStack Query; formulários com Zod; ESLint e Prettier no CI | Passa |
| III. Arquitetura — backend | módulos por domínio com `router/service/repository/models/schemas`; todo repositório exige `user_id`; importadores plugáveis ([contracts/internal-interfaces.md](./contracts/internal-interfaces.md)); fila em tabela `jobs` com worker embutido na API; configurações por `pydantic-settings` | Passa, com um desvio registrado (módulo `categorization`) |
| IV. Arquitetura — frontend | `src/features/<feature>/` com `components`, `hooks`, `services`, `types.ts`; `src/components/ui`; um único guard de rotas | Passa |
| V. Segurança | Argon2id e lista de senhas comuns; JWT de 15 min em memória; refresh em cookie `httpOnly`, `Secure`, `SameSite=Strict`, com rotação e detecção de reutilização; CSRF no refresh; confirmação de e-mail; TOTP com códigos de recuperação; bloqueio e limite de frequência; uploads validados e descartados; logs por lista permitida; cabeçalhos e CORS; `pip-audit` e `npm audit` | Passa |
| VI. Inteligência artificial | ferramentas somente leitura com schemas Pydantic; sem SQL gerado; `user_id` injetado; propostas confirmadas pelo usuário; conferência de totais; dados delimitados; `LLMProvider`; prompts em arquivos; `ai_usage` e limites; backoff | Passa |
| VII. Privacidade e LGPD | OFX, CSV e planilhas lidos por código; só descrições vão à IA para categoria; aviso antes do primeiro PDF ou imagem; exportação e exclusão com cascata; backups sem os arquivos enviados; dados nos EUA informados na política de privacidade | Passa |
| VIII. Dados financeiros | `BIGINT` em centavos em todas as camadas; formatação só na exibição; `DATE` e `timestamptz`; fuso `America/Sao_Paulo`; idempotência por identificador externo e impressão digital; transferências fora dos totais; confirmação e desfazer em transação única | Passa |
| IX. Design e UX | mobile-first desde 320px; tokens em `globals.css`; claro e escuro; estados de carregamento, erro e vazio; confirmação em ações destrutivas | Passa: `design-system.md` foi criado e aprovado em 2026-10-01, depois de uma prévia estática em `design-preview/` |
| X. Testes | pytest com PostgreSQL real; testes obrigatórios listados; IA sempre falsa; cobertura de 80% imposta no CI; Vitest para hooks e componentes com lógica | Passa |
| XI. Observabilidade | logs JSON com id da requisição; `/health` e `/health/worker`; erros inesperados com pilha e sem dados sensíveis | Passa |
| XII. Deploy e infraestrutura | Compose no ambiente local; produção na Vercel, no Render e no Neon, com uma única origem, a API atrás do proxy com segredo e a mesma imagem Docker; build estático; migrações automáticas; tarefas agendadas por disparo externo; backup diário cifrado fora do Neon, com retenção de 14 dias e restauração testada; deploy dependente do CI | Passa (constituição 2.0.0) |
| XIII. Documentação | README, ADRs em `docs/adr/` e OpenAPI automático previstos | Passa |
| Stack e dependências | stack da constituição mantida; cada dependência adicional está justificada na seção 25 de [research.md](./research.md) | Passa |
| Processo | spec aprovada e esclarecida; abstrações limitadas às exigidas pela constituição | Passa |

**Resultado antes da Fase 0**: aprovado, com um desvio justificado em Complexity Tracking. A
condição que existia, a aprovação do `design-system.md`, foi cumprida em 2026-10-01.

**Reavaliação depois da Fase 1**: aprovado. O desenho não criou novos desvios. Três pontos foram
conferidos de novo contra a constituição:

- A sessão é conferida a cada requisição, além do JWT. Isso reforça o Princípio V e não exige
  ADR de enfraquecimento.
- Arquivos de CSV e planilha à espera do mapeamento de colunas ficam guardados por até 24 horas.
  O Princípio V pede a exclusão "após o processamento", e o processamento só termina depois do
  mapeamento; o arquivo continua fora de qualquer pasta pública e fora do backup.
- O limite de frequência em memória zera quando a API reinicia. O bloqueio por tentativas
  erradas, que é o requisito da spec, fica no banco.
- A política de segurança de conteúdo libera estilos no atributo `style`
  (`style-src-attr 'unsafe-inline'`), porque o Motion e o Recharts dependem disso. Scripts e
  folhas de estilo continuam restritos à própria origem. Como é uma concessão de segurança, o
  Princípio V exige que seja documentada e justificada em ADR, e ela está na lista abaixo.

**Reavaliação em 2026-11-02 (constituição 2.0.0)**: aprovado. A hospedagem em planos gratuitos
(ADR 0010) mudou o Princípio XII e o worker do Princípio III, por emenda. Pontos conferidos:

- A API recusa o que não chega pela Vercel, e o IP do visitante, usado nos limites de
  frequência, vem da primeira entrada do `X-Forwarded-For`, que a Vercel substitui. Isso foi
  validado no Render (seção 29 de [research.md](./research.md)).
- Os arquivos enviados ficam no banco até o processamento, fora do backup (ADR 0011). O
  Princípio V continua atendido: fora de pasta pública, apagados depois do processamento.
- Os limites de frequência em memória zeram também quando o serviço dorme; o bloqueio de login
  continua no banco.
- As tarefas com prazo atrasam até 3 horas, como a spec passou a admitir (FR-013, FR-017 e
  SC-011).

**ADRs a escrever durante a implementação** (Princípio XIII): fila de jobs no PostgreSQL; modelo
de sessão e tokens; camada de IA e garantia numérica do assistente; dinheiro em centavos e saldo
calculado; importadores plugáveis e detecção de duplicatas; arquivos enviados em volume privado;
backup cifrado e restauração; política de segurança de conteúdo e a concessão para estilos no
atributo `style`. Depois, em 2026-11-02: hospedagem em planos gratuitos (0010) e arquivos
enviados no banco (0011, que substitui o 0006).

## Project Structure

### Documentation (this feature)

```text
specs/001-contai-mvp/
├── plan.md              # Este arquivo
├── research.md          # Fase 0: decisões técnicas
├── data-model.md        # Fase 1: tabelas, regras e transições
├── quickstart.md        # Fase 1: como subir e validar
├── contracts/
│   ├── rest-api.md              # endpoints, erros e convenções
│   ├── assistant-tools.md       # ferramentas do assistente
│   └── internal-interfaces.md   # Importer e LLMProvider
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks; não é criado por /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml          # com uv.lock e .python-version (3.12)
├── Dockerfile              # estágios dev e prod; entrypoint.sh aplica as migrações
├── .dockerignore           # tests/ e scripts/ nunca entram na imagem
├── scripts/                # só desenvolvimento local (seed de demonstração)
├── alembic/
├── app/
│   ├── main.py                  # cria o app, registra routers, middlewares e cabeçalhos
│   ├── models_registry.py       # importa os modelos de todos os módulos (Alembic e testes)
│   ├── core/
│   │   ├── config.py            # settings via variáveis de ambiente
│   │   ├── database.py
│   │   ├── security.py          # hash de senha, JWT, TOTP, cifra do segredo
│   │   ├── errors.py            # exceções de domínio → respostas HTTP padronizadas
│   │   ├── rate_limit.py
│   │   ├── logging.py           # logs JSON com id da requisição
│   │   ├── money.py             # centavos, divisão de parcelas, formatação em reais
│   │   ├── clock.py             # "hoje" e períodos em America/Sao_Paulo
│   │   └── health.py            # /health e /health/worker
│   ├── modules/                 # cada um: router.py, service.py, repository.py, models.py, schemas.py
│   │   ├── auth/
│   │   ├── users/               # perfil, sessões, 2FA, exportação e exclusão
│   │   ├── accounts/
│   │   ├── categories/
│   │   ├── transactions/
│   │   ├── imports/
│   │   │   └── importers/       # base.py, ofx.py, tabular.py, statement_ai.py, receipt_ai.py
│   │   ├── categorization/      # regras aprendidas e sugestão por IA
│   │   ├── dashboard/           # serviço de relatórios, usado também pelo assistente
│   │   └── assistant/
│   │       ├── tools/           # ferramentas somente leitura
│   │       └── prompts/         # prompts de sistema versionados
│   ├── ai/                      # provider.py (LLMProvider), gemini.py, fake.py, factory.py,
│   │                            # models.py, repository.py e usage.py (uso e limites)
│   ├── email/                   # envio por SMTP (local) ou pela API do Brevo (produção) e modelos de texto
│   └── worker/
│       ├── main.py              # laço do worker (embutido na API) e batimento
│       ├── models.py            # Job e WorkerHeartbeat
│       ├── repository.py        # único acesso às tabelas da fila e do batimento
│       ├── queue.py             # regras da fila: backoff e jobs travados
│       └── jobs/                # importações, e-mails e tarefas periódicas
└── tests/
    ├── unit/                    # dinheiro, parcelas, faturas, saldos, importadores, duplicatas, ferramentas
    ├── integration/             # todos os endpoints, com PostgreSQL real
    ├── isolation/               # acesso cruzado entre usuários em todas as rotas
    └── fixtures/                # OFX, CSV e XLSX fictícios de vários bancos

frontend/
├── package.json
├── Dockerfile                  # ambiente local (servidor do Vite)
├── vercel.json                 # produção: repasse de /api, cabeçalhos de segurança e cache
├── public/
│   └── theme-init.js            # define o tema antes da primeira pintura
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── router.tsx               # rotas e guard único
    ├── assets/fonts/            # Besley e Atkinson Hyperlegible Next (.woff2)
    ├── lib/                     # api-client.ts, money.ts, dates.ts, motion.ts
    ├── components/
    │   ├── ui/                  # Button, Input, Modal, Card, MoneyInput, EmptyState...
    │   └── layout/              # AppShell, barra inferior no celular, lateral no desktop
    ├── features/                # cada uma: components/, hooks/, services/, types.ts
    │   ├── auth/
    │   ├── settings/            # perfil, 2FA, sessões, exportar e excluir conta
    │   ├── accounts/
    │   ├── categories/
    │   ├── transactions/
    │   ├── imports/
    │   ├── dashboard/
    │   └── assistant/
    └── styles/
        └── globals.css          # tokens de design e temas claro e escuro

infra/
├── Caddyfile.dev                # ambiente local: uma única origem, como a Vercel em produção
├── postgres/                    # init-test-db.sql (banco de testes)
└── backup/                      # restore.sh, backup.yml de referência e instruções (o backup
                                 # roda no repositório privado contai-backups)

docs/adr/
.github/workflows/
├── ci.yml                       # CI e, na main, o deploy pelos deploy hooks
└── scheduled-tasks.yml          # disparo das tarefas agendadas a cada 3 horas
docker-compose.yml               # ambiente local (inclui mailpit)
.env.example
design-system.md
design-preview/                  # prévia estática do design; fora do build e do deploy
README.md
```

**Structure Decision**: aplicação web com `backend/` e `frontend/` na raiz do repositório,
seguindo a árvore fornecida na entrada do plano. O backend é um único pacote Python que gera
a API com o worker embutido, a partir da mesma imagem no ambiente local e em produção; o worker
ainda pode rodar sozinho (`python -m app.worker.main`). Foram acrescentados à árvore fornecida
`core/money.py` e `core/clock.py` (regras de centavos e de fuso em um só lugar), a separação de
`tests/` em `unit`, `integration`, `isolation` e `fixtures` e os `Dockerfile`.
O design system aprovado acrescentou `frontend/public/theme-init.js`,
`frontend/src/assets/fonts/` e `frontend/src/lib/motion.ts` (seção 26 de
[research.md](./research.md)).

Além dos cinco arquivos padrão, um módulo pode ter arquivos auxiliares de regra pura, como
`transactions/invoices.py`, `imports/duplicates.py` e `assistant/validation.py`. Eles não
acessam o banco: só repositórios acessam, inclusive em `ai` e em `worker`, e os jobs do worker
chamam serviços.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Módulo `categorization`, fora da lista de domínios do Princípio III (`auth`, `users`, `accounts`, `categories`, `transactions`, `imports`, `dashboard`, `assistant`) | A sugestão de categoria é usada por três módulos: `imports` (linhas propostas), `transactions` (aprender com correções) e `assistant` (lançamento por texto). Foi pedido na entrada do plano. | Colocar dentro de `categories` misturaria o cadastro de categorias com regras aprendidas e chamadas à IA; colocar dentro de `imports` obrigaria `transactions` e `assistant` a depender de `imports`. A emenda PATCH que inclui o módulo na lista é a tarefa T055, feita antes da Phase 7. |
| CI fora do GitHub Actions e deploy sem a trava automática do CI verde (Princípio XII), temporário desde 2026-11-08 | Os Actions da conta falham antes de começar ("account is locked due to a billing issue"), e o mantenedor não vai cadastrar cartão. O CI roda por `infra/ci-local.sh` antes de cada push; o Render e a Vercel publicam a cada merge na `main`; o cron-job.org acorda a API a cada 3 horas para as tarefas agendadas (ADR 0010). | Cadastrar cartão (risco de cobrança que o mantenedor não aceita); outro CI hospedado (mais uma conta, planos gratuitos que costumam pedir cartão); tarefas só quando alguém usa o app (prazos de exclusão poderiam atrasar dias). |
| Sem backup diário fora do provedor do banco (Princípio XII), temporário desde 2026-11-08 | A conta do GitHub não tem cartão, e o orçamento de US$ 0 bloqueia os Actions do repositório privado `contai-backups`. O mantenedor priorizou colocar o app em uso; até lá, vale o histórico de poucas horas do Neon. Termina com a T216 rodando e a T217 registrada (ADR 0007). | Rodar o backup no repositório principal, que fica público, deixaria os artifacts ao alcance de qualquer conta do GitHub; cartão ou armazenamento que o exige vão contra a regra de só usar planos gratuitos sem cartão. |

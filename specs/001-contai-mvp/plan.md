# Implementation Plan: Contaí — controle financeiro pessoal com assistente de IA

**Branch**: `001-contai-mvp` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-contai-mvp/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

O Contaí é uma aplicação web multiusuário de finanças pessoais: cada usuário cadastra contas e
categorias, lança transações à mão ou importando documentos de qualquer banco, acompanha um
painel mensal e faz perguntas em português a um assistente de IA.

A abordagem técnica é uma API FastAPI organizada por domínio (router → service → repository),
um worker que consome uma fila em tabela do PostgreSQL para importações, e-mails e tarefas
agendadas, e um frontend React servido como build estático, todos atrás de um Caddy na mesma
origem. Três decisões sustentam os requisitos mais difíceis:

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
  Zod, Recharts, lucide-react, Motion, qrcode.react

**Storage**: PostgreSQL (dados e fila de jobs); volume privado para arquivos enviados, que são
temporários; armazenamento de objetos externo apenas para backups cifrados

**Testing**: pytest, pytest-asyncio, httpx e pytest-cov, com PostgreSQL real em contêiner;
Vitest e Testing Library no frontend; `FakeLLMProvider` no lugar da IA

**Target Platform**: VPS Linux com Docker Compose, atrás do Caddy com HTTPS automático;
navegadores atuais, no celular e no computador

**Project Type**: aplicação web (backend, worker e frontend)

**Performance Goals**: painel em até 3 segundos com 5.000 transações (SC-013); 90% das perguntas
ao assistente respondidas em até 10 segundos (SC-014); lançamento manual em menos de 15 segundos
(SC-005)

**Constraints**: plano gratuito do provedor de IA (cota compartilhada entre todos os usuários);
API em instância única, com limite de frequência em memória; sem Redis nem broker externo;
arquivos de até 10 MB; telas a partir de 320px; WCAG 2.1 AA; interface em português do Brasil

**Scale/Scope**: dezenas de usuários, cada um com alguns milhares de transações por ano; 10
histórias de usuário, 82 requisitos funcionais, 17 tabelas, cerca de 70 endpoints, 8 features de
frontend

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano atende | Situação |
|-----------|---------------------|----------|
| I. Qualidade de código — backend | mypy strict e Ruff no CI; schemas `Create`/`Update`/`Read` por módulo; rotas só validam, chamam o serviço e formatam; exceções de domínio convertidas em `core/errors.py` | Passa |
| II. Qualidade de código — frontend | `strict: true`; componentes funcionais; `types.ts` por feature; HTTP só em `services/`, consumido por hooks do TanStack Query; formulários com Zod; ESLint e Prettier no CI | Passa |
| III. Arquitetura — backend | módulos por domínio com `router/service/repository/models/schemas`; todo repositório exige `user_id`; importadores plugáveis ([contracts/internal-interfaces.md](./contracts/internal-interfaces.md)); fila em tabela `jobs` com worker; configurações por `pydantic-settings` | Passa, com um desvio registrado (módulo `categorization`) |
| IV. Arquitetura — frontend | `src/features/<feature>/` com `components`, `hooks`, `services`, `types.ts`; `src/components/ui`; um único guard de rotas | Passa |
| V. Segurança | Argon2id e lista de senhas comuns; JWT de 15 min em memória; refresh em cookie `httpOnly`, `Secure`, `SameSite=Strict`, com rotação e detecção de reutilização; CSRF no refresh; confirmação de e-mail; TOTP com códigos de recuperação; bloqueio e limite de frequência; uploads validados e descartados; logs por lista permitida; cabeçalhos e CORS; `pip-audit` e `npm audit` | Passa |
| VI. Inteligência artificial | ferramentas somente leitura com schemas Pydantic; sem SQL gerado; `user_id` injetado; propostas confirmadas pelo usuário; conferência de totais; dados delimitados; `LLMProvider`; prompts em arquivos; `ai_usage` e limites; backoff | Passa |
| VII. Privacidade e LGPD | OFX, CSV e planilhas lidos por código; só descrições vão à IA para categoria; aviso antes do primeiro PDF ou imagem; exportação e exclusão com cascata; backups fora do volume de uploads | Passa |
| VIII. Dados financeiros | `BIGINT` em centavos em todas as camadas; formatação só na exibição; `DATE` e `timestamptz`; fuso `America/Sao_Paulo`; idempotência por identificador externo e impressão digital; transferências fora dos totais; confirmação e desfazer em transação única | Passa |
| IX. Design e UX | mobile-first desde 320px; tokens em `globals.css`; claro e escuro; estados de carregamento, erro e vazio; confirmação em ações destrutivas | Passa, condicionado: `design-system.md` foi criado em 2026-10-01 e precisa ser aprovado antes de qualquer tarefa de interface |
| X. Testes | pytest com PostgreSQL real; testes obrigatórios listados; IA sempre falsa; cobertura de 80% imposta no CI; Vitest para hooks e componentes com lógica | Passa |
| XI. Observabilidade | logs JSON com id da requisição; `/health` e `/health/worker`; erros inesperados com pilha e sem dados sensíveis | Passa |
| XII. Deploy e infraestrutura | Compose em dev e produção; Caddy; build estático; migrações automáticas; backup diário cifrado com retenção de 14 dias e restauração testada; deploy dependente do CI | Passa |
| XIII. Documentação | README, ADRs em `docs/adr/` e OpenAPI automático previstos | Passa |
| Stack e dependências | stack da constituição mantida; cada dependência adicional está justificada na seção 25 de [research.md](./research.md) | Passa |
| Processo | spec aprovada e esclarecida; abstrações limitadas às exigidas pela constituição | Passa |

**Resultado antes da Fase 0**: aprovado, com um desvio justificado em Complexity Tracking e uma
condição (a aprovação do `design-system.md`).

**Reavaliação depois da Fase 1**: aprovado. O desenho não criou novos desvios. Três pontos foram
conferidos de novo contra a constituição:

- A sessão é conferida a cada requisição, além do JWT. Isso reforça o Princípio V e não exige
  ADR de enfraquecimento.
- Arquivos de CSV e planilha à espera do mapeamento de colunas ficam guardados por até 24 horas.
  O Princípio V pede a exclusão "após o processamento", e o processamento só termina depois do
  mapeamento; o arquivo continua fora de qualquer pasta pública e fora do backup.
- O limite de frequência em memória zera quando a API reinicia. O bloqueio por tentativas
  erradas, que é o requisito da spec, fica no banco.

**ADRs a escrever durante a implementação** (Princípio XIII): fila de jobs no PostgreSQL; modelo
de sessão e tokens; camada de IA e garantia numérica do assistente; dinheiro em centavos e saldo
calculado; importadores plugáveis e detecção de duplicatas; arquivos enviados em volume privado;
backup cifrado e restauração.

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
├── pyproject.toml
├── Dockerfile
├── alembic/
├── app/
│   ├── main.py                  # cria o app, registra routers, middlewares e cabeçalhos
│   ├── core/
│   │   ├── config.py            # settings via variáveis de ambiente
│   │   ├── database.py
│   │   ├── security.py          # hash de senha, JWT, TOTP, cifra do segredo
│   │   ├── errors.py            # exceções de domínio → respostas HTTP padronizadas
│   │   ├── rate_limit.py
│   │   ├── logging.py           # logs JSON com id da requisição
│   │   ├── money.py             # centavos, divisão de parcelas, formatação em reais
│   │   └── clock.py             # "hoje" e períodos em America/Sao_Paulo
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
│   ├── ai/                      # provider.py (LLMProvider), gemini.py, fake.py
│   ├── email/                   # envio por SMTP e modelos de texto
│   └── worker/
│       ├── main.py              # laço do worker e batimento
│       └── jobs/                # importações, e-mails e tarefas periódicas
└── tests/
    ├── unit/                    # dinheiro, parcelas, faturas, saldos, importadores, duplicatas, ferramentas
    ├── integration/             # todos os endpoints, com PostgreSQL real
    ├── isolation/               # acesso cruzado entre usuários em todas as rotas
    └── fixtures/                # OFX, CSV e XLSX fictícios de vários bancos

frontend/
├── package.json
├── Dockerfile
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── router.tsx               # rotas e guard único
    ├── lib/                     # api-client.ts, money.ts, dates.ts
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
├── Caddyfile
├── deploy.sh
└── backup/                      # backup.sh, restore.sh e instruções

docs/adr/
.github/workflows/ci.yml
docker-compose.yml               # desenvolvimento (inclui mailpit)
docker-compose.prod.yml          # produção (inclui backup)
.env.example
design-system.md
README.md
```

**Structure Decision**: aplicação web com `backend/` e `frontend/` na raiz do repositório,
seguindo a árvore fornecida na entrada do plano. O backend é um único pacote Python que gera
dois processos, API e worker, a partir da mesma imagem. Foram acrescentados à árvore fornecida
`core/money.py` e `core/clock.py` (regras de centavos e de fuso em um só lugar), a separação de
`tests/` em `unit`, `integration`, `isolation` e `fixtures`, os `Dockerfile` e `infra/deploy.sh`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Módulo `categorization`, fora da lista de domínios do Princípio III (`auth`, `users`, `accounts`, `categories`, `transactions`, `imports`, `dashboard`, `assistant`) | A sugestão de categoria é usada por três módulos: `imports` (linhas propostas), `transactions` (aprender com correções) e `assistant` (lançamento por texto). Foi pedido na entrada do plano. | Colocar dentro de `categories` misturaria o cadastro de categorias com regras aprendidas e chamadas à IA; colocar dentro de `imports` obrigaria `transactions` e `assistant` a depender de `imports`. Recomenda-se uma emenda PATCH à constituição para incluir o módulo na lista. |

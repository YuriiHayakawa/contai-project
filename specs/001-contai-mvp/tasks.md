---

description: "Lista de tarefas para a implementação do Contaí (feature 001-contai-mvp)"
---

# Tasks: Contaí — controle financeiro pessoal com assistente de IA

**Input**: Design documents from `/specs/001-contai-mvp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, e o
`design-system.md` na raiz

**Tests**: incluídos. O Princípio X da constituição torna os testes obrigatórios (cálculos
financeiros, cada importador, duplicatas, autenticação, isolamento entre usuários e cada
ferramenta da IA), com cobertura mínima de 80% nos módulos de domínio. Em cada história, os
testes são escritos primeiro e devem falhar antes da implementação.

**Organization**: as tarefas são agrupadas por história de usuário, para que cada história
possa ser implementada, testada e entregue de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem depender de tarefa incompleta)
- **[Story]**: história de usuário da spec (US1 a US10)
- Toda tarefa cita o caminho exato dos arquivos

## Path Conventions

- Backend: `backend/app/` e `backend/tests/`
- Frontend: `frontend/src/`; os testes ficam ao lado do arquivo testado (`*.test.ts` e
  `*.test.tsx`)
- Cada módulo de `backend/app/modules/<módulo>/` tem `router.py`, `service.py`,
  `repository.py`, `models.py` e `schemas.py`
- Cada feature de `frontend/src/features/<feature>/` tem `components/`, `hooks/`, `services/`
  e `types.ts`

## Regras que valem para todas as tarefas

- Só repositórios acessam o banco. Serviços, rotas, dependências e jobs do worker chamam
  repositórios (os jobs, por meio dos serviços); os repositórios de `ai` e do worker seguem a
  mesma regra.
- Todo método de repositório de dados do usuário recebe `user_id` como parâmetro obrigatório.
- Dinheiro é sempre inteiro em centavos; `float` é proibido para valores monetários.
- Rotas só validam a entrada, chamam o serviço e formatam a resposta.
- Toda rota autenticada nova ganha um caso no registro de isolamento (T038), ou o teste de
  cobertura de rotas falha.
- Textos exibidos ao usuário em português do Brasil; nomes no código em inglês.
- Toda tela segue o `design-system.md` e passa na lista da seção 11 dele.
- Logs nunca contêm senhas, tokens, conteúdo de documentos, descrições ou valores.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: iniciar o repositório, os dois projetos e o ambiente local com um único comando

- [ ] T001 Criar a estrutura de pastas do plano (`backend/app/{core,modules,ai,email,worker/jobs}`, `backend/tests/{unit,integration,isolation,fixtures}`, `frontend/src/{lib,components/ui,components/layout,features,styles,assets/fonts}`, `frontend/public`, `infra/backup`, `docs/adr`, `.github/workflows`) e o `.gitignore` na raiz, ignorando `.env`, `.venv`, `__pycache__`, `node_modules`, `dist`, cobertura e o diretório de uploads
- [ ] T002 Criar `backend/pyproject.toml` com uv e Python 3.12+: dependências `fastapi`, `uvicorn`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pydantic`, `pydantic-settings`, `argon2-cffi`, `PyJWT`, `pyotp`, `cryptography`, `slowapi`, `python-multipart`, `ofxtools`, `openpyxl`, `filetype`, `google-genai`, `tzdata`; grupo de desenvolvimento com `pytest`, `pytest-asyncio`, `pytest-cov`, `httpx`, `ruff`, `mypy`, `pip-audit`
- [ ] T003 Configurar em `backend/pyproject.toml` o Ruff (lint e formatação), o mypy em modo `strict`, o pytest com `asyncio_mode = "auto"` e a cobertura medida em `app/modules`
- [ ] T004 Criar o projeto frontend com Vite, React 19 e TypeScript em `frontend/` (`package.json`, `index.html`, `vite.config.ts`) com as dependências `react-router`, `@tanstack/react-query`, `react-hook-form`, `zod`, `@hookform/resolvers`, `recharts`, `lucide-react`, `motion`, `qrcode.react`, `tailwindcss` e `@tailwindcss/vite`
- [ ] T005 Configurar as ferramentas do frontend: `frontend/tsconfig.json` com `strict: true`, `frontend/eslint.config.js` proibindo `any` explícito, `frontend/.prettierrc`, Vitest com `jsdom` e Testing Library em `frontend/vite.config.ts` e `frontend/src/test-setup.ts`, e os scripts `lint`, `format:check`, `typecheck` e `test` em `frontend/package.json`
- [ ] T006 [P] Criar `.env.example` na raiz, com um comentário por variável: banco, segredo do JWT, chave de cifra do TOTP, origem do app, SMTP, `AI_PROVIDER`, `AI_MODEL_CHAT`, `AI_MODEL_EXTRACTION`, chave do provedor de IA, limites diários de IA (30 perguntas, 10 extrações), limites de frequência, tamanho máximo de upload (10 MB), diretório de uploads e parâmetros de backup
- [ ] T007 [P] Criar `backend/Dockerfile` (Python 3.12 slim, uv, usuário sem privilégios) e `backend/entrypoint.sh`, que roda `alembic upgrade head` antes de iniciar a API; o worker usa a mesma imagem com o comando `python -m app.worker.main`
- [ ] T008 [P] Criar `frontend/Dockerfile` em estágios: `dev` (servidor do Vite) e `prod` (build estático servido por Caddy como servidor de arquivos)
- [ ] T009 Criar `docker-compose.yml` de desenvolvimento e `infra/Caddyfile.dev`: serviços `caddy` (porta 8080; `/api/*` para a API, o resto para o frontend), `frontend`, `api`, `worker`, `postgres` e `mailpit` (porta 8025); volume privado de uploads montado só em `api` e `worker`; `healthcheck` em `api`, `worker` e `postgres`; o worker só sobe com a API saudável; o `postgres` cria também o banco de testes `contai_test` por `infra/postgres/init-test-db.sql`, usado em `TEST_DATABASE_URL`
- [ ] T010 [P] Criar `.github/workflows/ci.yml` com dois jobs a cada push: backend (`ruff check`, `ruff format --check`, `mypy app`, `pytest --cov=app/modules --cov-fail-under=80` com PostgreSQL em `services`, `pip-audit`) e frontend (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm audit`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestrutura que todas as histórias usam: núcleo do backend, fila e worker,
e-mail, camada de IA, base de testes, tokens de design, componentes base e navegação

**⚠️ CRITICAL**: nenhuma história começa antes de esta fase terminar

### Núcleo do backend

- [ ] T011 Implementar `backend/app/core/config.py`: classe `Settings` do `pydantic-settings` com todas as variáveis do `.env.example`, sem valor padrão para segredos
- [ ] T012 Implementar `backend/app/core/database.py`: engine e sessão assíncronos, `Base` declarativa com convenção de nomes de restrições, mixins de chave primária UUID e de `created_at`/`updated_at` em `timestamptz` UTC, e a dependência `get_session`
- [ ] T013 Configurar o Alembic assíncrono em `backend/alembic.ini` e `backend/alembic/env.py`, importando o metadata de todos os módulos
- [ ] T014 [P] Escrever `backend/tests/unit/test_clock.py` e implementar `backend/app/core/clock.py`: `today()` e `now()` em `America/Sao_Paulo`, limites de um mês e `add_months` com ajuste para o último dia em meses curtos
- [ ] T015 [P] Escrever `backend/tests/unit/test_money.py` e implementar `backend/app/core/money.py`: `split_installments(total_cents, n)` com o resto de centavos na primeira parcela e soma exata, `format_brl(cents)` no padrão `R$ 1.234,56` e `parse_brl(text)` com `Decimal`, sem `float`
- [ ] T016 [P] Implementar `backend/app/core/logging.py`: formatador JSON, `contextvar` do id da requisição, middleware que o gera e o devolve em `X-Request-ID`, e registro só de campos de uma lista permitida (rota, método, status, duração, ids e códigos de erro)
- [ ] T017 [P] Implementar `backend/app/core/errors.py`: exceções de domínio (`NotFound`, `Conflict`, `ValidationFailed`, `Unauthenticated`, `Forbidden`, `RateLimited`, `PayloadTooLarge`, `AiLimitReached`, `AiUnavailable`) e os handlers que as convertem no formato de erro de `contracts/rest-api.md`, com mensagens em português que dizem o que fazer e o `request_id`
- [ ] T018 Escrever `backend/tests/unit/test_security.py` e implementar `backend/app/core/security.py` com `backend/app/core/data/common_passwords.txt`: hash e verificação com Argon2id (`argon2-cffi`, com re-hash quando necessário), política de senha (mínimo de 8 caracteres, recusa de senhas comuns), geração de token aleatório de 32 bytes e seu hash SHA-256, e emissão e validação do access token JWT de 15 minutos (`sub`, `sid`) e do `challenge_token` de 5 minutos com finalidade própria
- [ ] T019 [P] Criar `backend/app/modules/users/models.py` com `User`: `name` (1 a 100 caracteres), `email` (minúsculas, único), `password_hash`, `email_verified_at`, `status` (`active`, `pending_deletion`), `deletion_requested_at`, `deletion_scheduled_at`, `totp_secret_encrypted`, `totp_enabled_at`, `totp_last_used_step`, `failed_login_count`, `locked_until`, `privacy_policy_version`, `privacy_policy_accepted_at`, `ai_documents_consent_at`
- [ ] T020 [P] Criar `backend/app/modules/auth/models.py` com `Session` (`refresh_token_hash`, `user_agent`, `ip`, `last_used_at`, `expires_at`, `revoked_at`, `revoked_reason` em `logout`, `user_revoked`, `password_changed`, `password_reset`, `token_reuse`, `two_factor_reset`, `account_deletion`) e `EmailToken` (`type` em `email_verification`, `password_reset`, `two_factor_reset_confirm`, `two_factor_reset_cancel`; `token_hash` único; `expires_at`; `used_at`), ambos com `user_id` em `ON DELETE CASCADE`
- [ ] T021 [P] Criar `backend/app/worker/models.py` com `Job` (`type` em `process_import`, `send_email`; `payload` JSONB só com identificadores; `status` em `queued`, `running`, `succeeded`, `failed`; `attempts`; `max_attempts`; `run_at`; `locked_at`; `last_error_code`; `user_id` opcional em cascata; índice parcial em `run_at` onde `status = 'queued'`) e `WorkerHeartbeat` (`worker_id`, `last_seen_at`)
- [ ] T022 [P] Criar `backend/app/ai/models.py` com `AiUsage`: `user_id`, `task` (`chat`, `text_entry`, `categorization`, `statement_extraction`, `receipt_extraction`), `model`, `input_tokens`, `output_tokens`, `counts_toward_limit`, `usage_date` (dia no fuso de Brasília)
- [ ] T023 Criar a migração `backend/alembic/versions/0001_core.py` com as tabelas `users`, `sessions`, `email_tokens`, `jobs`, `worker_heartbeats` e `ai_usage`
- [ ] T024 Implementar a primeira parte de `backend/tests/conftest.py`: banco de `TEST_DATABASE_URL` com o esquema criado pelas migrações, cada teste em uma transação desfeita ao final, relógio controlável e um servidor SMTP falso que captura as mensagens enviadas
- [ ] T025 [P] Implementar `backend/app/modules/users/repository.py`: buscar por id e por e-mail, criar, atualizar e apagar usuário
- [ ] T026 [P] Implementar `backend/app/modules/auth/repository.py`: criar, buscar, rotacionar e revogar sessões; criar, buscar pelo hash, marcar como usado e invalidar tokens de e-mail. Só as buscas por credencial (id da sessão no refresh, hash do token no link) dispensam `user_id`; todos os outros métodos o exigem
- [ ] T027 Implementar `backend/app/modules/auth/dependencies.py`: dependência `get_current_user`, que valida o JWT e, só pelos repositórios de `auth` e `users` (nenhuma consulta direta ao banco), confere a cada requisição que a sessão do `sid` não foi revogada nem expirou, responde `403 email_not_verified` para e-mail não confirmado e `403 account_pending_deletion` para conta em exclusão (liberando só `GET /users/me` e `DELETE /users/me/deletion`)
- [ ] T028 [P] Implementar `backend/app/core/rate_limit.py`: `slowapi` em memória, chave por IP do cliente (cabeçalho do Caddy, aceito só da rede interna) e por usuário, limites vindos das configurações e resposta `429 rate_limited` com `Retry-After` no formato de erro padrão
- [ ] T029 Escrever `backend/tests/integration/test_job_queue.py` e implementar `backend/app/worker/repository.py` (único ponto de acesso às tabelas `jobs` e `worker_heartbeats`: enfileirar, reservar com `SELECT ... FOR UPDATE SKIP LOCKED`, concluir, falhar, devolver à fila os jobs travados, cancelar os jobs pendentes de um usuário, apagar jobs concluídos antigos, gravar e ler o batimento) e `backend/app/worker/queue.py` (regras da fila sobre o repositório: backoff exponencial até `max_attempts` e tempo limite de job travado)
- [ ] T030 Implementar `backend/app/worker/main.py` (laço que consome a fila por `backend/app/worker/queue.py`, registro de handlers por tipo de job, registro de tarefas periódicas por intervalo, batimento a cada 15 segundos gravado pelo repositório do worker, logs JSON de `backend/app/core/logging.py` e desligamento limpo) e `backend/app/worker/health.py` (checagem usada pelo `healthcheck` do contêiner, lendo o batimento pelo repositório)
- [ ] T031 Escrever `backend/tests/integration/test_send_email_job.py` (job executado contra o SMTP falso: destinatário, assunto, link com token válido, só o hash do token gravado e nova tentativa quando o SMTP falha) e implementar o envio de e-mails: `backend/app/email/sender.py` (`smtplib` e `email.message` em `asyncio.to_thread`), `backend/app/email/templates.py` (modelos de texto em `backend/app/email/templates/` preenchidos com `string.Template`) e `backend/app/worker/jobs/send_email.py`, que gera o token do link dentro do job e grava só o hash pelo repositório de `auth`
- [ ] T032 Implementar `backend/app/core/health.py` (`GET /api/v1/health` para API e banco, com a checagem de conexão feita por uma função de `backend/app/core/database.py`; `GET /api/v1/health/worker`, saudável se o último batimento, lido pelo repositório do worker, tem menos de 60 segundos) e `backend/app/main.py`: fábrica do app com middleware de id da requisição, cabeçalhos de segurança, CORS com lista de origens das configurações, handlers de erro, limitador, inclusão dos routers e OpenAPI em `/api/docs`

### Camada de IA

- [ ] T033 [P] Implementar `backend/app/ai/provider.py` conforme `contracts/internal-interfaces.md`: protocolo `LLMProvider` (`chat` e `generate_structured`), os tipos próprios `LLMMessage`, `ToolSpec`, `ToolCall`, `Attachment` e `LLMUsage`, e as exceções `LLMRateLimited`, `LLMUnavailable` e `LLMInvalidResponse`
- [ ] T034 [P] Implementar `backend/app/ai/fake.py`: `FakeLLMProvider` com respostas roteirizadas e registro das chamadas recebidas, para os testes
- [ ] T035 Implementar `backend/app/ai/gemini.py` (SDK `google-genai` assíncrono, execução automática de funções desligada, saída estruturada validada com Pydantic, erros do fornecedor convertidos nas exceções próprias) e `backend/app/ai/factory.py`, que escolhe o provedor por `AI_PROVIDER`
- [ ] T036 Escrever `backend/tests/integration/test_ai_usage.py` e implementar `backend/app/ai/repository.py` (único ponto de acesso à tabela `ai_usage`, com `user_id` obrigatório: gravar o uso de tokens por tarefa e contar as linhas contáveis por usuário e `usage_date`) e `backend/app/ai/usage.py` (regras dos limites diários sobre o repositório: 30 perguntas somando `chat` e `text_entry`, 10 extrações, dia contado no fuso de Brasília e o horário em que o limite zera)

### Base de testes do backend

- [ ] T037 Completar `backend/tests/conftest.py`: cliente `httpx` contra o app, fábricas de usuário confirmado, clientes autenticados para dois usuários (A e B), `FakeLLMProvider` no lugar do provedor e um auxiliar que executa os jobs de e-mail pendentes contra o SMTP falso e devolve o link enviado, já que o token do link é gerado dentro do job
- [ ] T038 [P] Implementar `backend/tests/isolation/registry.py` e `backend/tests/isolation/test_all_routes_covered.py`: o teste percorre todas as rotas registradas no app e falha se uma rota autenticada não tiver um caso de isolamento registrado (o usuário A cria o recurso e o usuário B recebe `404`) ou uma justificativa explícita de rota sem recurso de outro usuário
- [ ] T039 [P] Escrever `backend/tests/integration/test_health.py`: `/health` responde `200` com o banco disponível e `503` sem ele; `/health/worker` responde `200` com batimento de menos de 60 segundos e `503` com batimento antigo ou ausente

### Base do frontend

- [ ] T040 [P] Copiar `AtkinsonHyperlegibleNext-Variable.woff2` e `Besley-Variable.woff2` de `design-preview/fonts/` para `frontend/src/assets/fonts/`, junto com os arquivos de licença das duas fontes
- [ ] T041 Implementar `frontend/src/styles/globals.css` conforme a seção 10 do `design-system.md`: `@font-face`, todos os tokens das seções 2, 3, 5 e 9 em `:root` e em `:root[data-theme="dark"]`, a ponte `@theme inline` com `--color-*: initial`, os tokens fixos em `@theme`, os utilitários `money` e `marca-texto`, o fundo de papel e a regra de `prefers-reduced-motion`
- [ ] T042 [P] Criar `frontend/public/theme-init.js` (define `data-theme` antes da primeira pintura, pela escolha salva ou pela preferência do sistema) e ajustar `frontend/index.html`: `lang="pt-BR"`, o script no `<head>` e o pré-carregamento da fonte de texto
- [ ] T043 [P] Escrever `frontend/src/lib/money.test.ts` e implementar `frontend/src/lib/money.ts`: formatação `R$ 1.234,56` com `Intl.NumberFormat`, sinal `−` (U+2212), conversão de texto colado para centavos e a operação de digitação pela direita usada pelo campo de dinheiro
- [ ] T044 [P] Escrever `frontend/src/lib/dates.test.ts` e implementar `frontend/src/lib/dates.ts`: "hoje" em `America/Sao_Paulo`, rótulos "Hoje", "Ontem" e "seg., 28 de set.", nome do mês e conversão para `YYYY-MM-DD`
- [ ] T045 [P] Implementar `frontend/src/lib/motion.ts` (durações, curvas e a mola da seção 9.1 do `design-system.md`) e `frontend/src/lib/theme.ts` (ler e gravar a escolha Claro, Escuro ou Automático)
- [ ] T046 Escrever `frontend/src/lib/api-client.test.ts` e implementar `frontend/src/lib/api-client.ts`: `fetch` sobre `/api/v1`, access token só em memória, refresh em um `401` serializado entre abas com `navigator.locks` e com o cabeçalho `X-Contai-Client: web`, uma única repetição da requisição e conversão do formato de erro em `ApiError` (`code`, `message`, `details`, `requestId`). Quando o refresh falha, a sessão é limpa e o cliente sinaliza sessão expirada, para o usuário ser levado à tela de entrada com a mensagem "Sua sessão expirou. Entre de novo para continuar.", sem tela de erro técnico; o teste cobre a expiração no meio do envio de um lançamento
- [ ] T047 [P] Implementar `frontend/src/components/ui/Button.tsx` conforme a seção 6.1 do `design-system.md`: variantes `primary`, `secondary`, `ghost` e `danger`, alturas de 48 e 40px, estados desativado e carregando (`aria-busy`), e a versão só de ícone com `aria-label` obrigatório
- [ ] T048 [P] Implementar `frontend/src/components/ui/TextField.tsx`, `Select.tsx` e `SegmentedControl.tsx` conforme a seção 6.2: rótulo sempre visível, "(opcional)" no rótulo, ajuda, erro com `aria-invalid` e `aria-describedby`, altura de 48px e texto de 16px
- [ ] T049 [P] Escrever `frontend/src/components/ui/MoneyInput.test.tsx` e implementar `frontend/src/components/ui/MoneyInput.tsx` conforme a seção 6.3: prefixo `R$`, digitação de caixa registradora, colar `1.234,56`, valor inteiro em centavos, `inputmode="numeric"` e `aria-label="Valor em reais"`
- [ ] T050 [P] Implementar `frontend/src/components/ui/Card.tsx`, `EmptyState.tsx` (primeira vez, sem resultados e erro), `Skeleton.tsx` e `CategoryChip.tsx` com o mapa de ícones de categoria em `frontend/src/components/ui/category-icons.ts`, conforme as seções 6.4, 6.7 e 2.3
- [ ] T051 [P] Implementar `frontend/src/components/ui/Modal.tsx` (folha no celular, diálogo a partir de `md`, foco preso, `Esc`, retorno do foco, animação com Motion) e `frontend/src/components/ui/ConfirmDialog.tsx` (pergunta com o objeto, consequência, foco inicial em "Cancelar", ação em `danger`), conforme a seção 6.5
- [ ] T052 [P] Implementar `frontend/src/components/ui/Toast.tsx` com `ToastProvider` e `useToast`: posição por tamanho de tela, 5 segundos (8 com ação), pausa no foco, `role="status"` ou `role="alert"`, conforme a seção 6.8
- [ ] T053 Implementar `frontend/src/components/layout/AppShell.tsx`, `BottomNav.tsx`, `Sidebar.tsx` e `PageHeader.tsx` conforme a seção 6.9: barra inferior até `lg` com o botão central "Lançar", barra lateral de 248px a partir de `lg`, `aria-current="page"` e a folha "Mais"
- [ ] T054 Implementar `frontend/src/features/auth/hooks/useAuth.tsx` (`AuthProvider` com o access token em memória, o usuário atual e o refresh silencioso ao carregar), `frontend/src/router.tsx` (rotas públicas e um único guard `RequireAuth`), `frontend/src/App.tsx` (`QueryClientProvider`, `AuthProvider`, `MotionConfig reducedMotion="user"`, `ToastProvider` e limite de erro) e `frontend/src/main.tsx`; o `AuthProvider` trata o sinal de sessão expirada do `api-client`, levando à tela de entrada com a mensagem e voltando à rota de origem depois do login

### Governança

- [ ] T055 Fazer, antes de qualquer tarefa do módulo `categorization` (Phase 7), a emenda PATCH da constituição que inclui o módulo `categorization` na lista de domínios do Princípio III, com o comando `/speckit-constitution`

**Checkpoint**: `docker compose up` sobe tudo, os dois endpoints de saúde respondem `200`, o
CI passa e a casca do app aparece nos dois temas

---

## Phase 3: User Story 1 - Criar conta e entrar com segurança (Priority: P1) 🎯 MVP

**Goal**: o visitante lê a política de privacidade, cria a conta, confirma o e-mail, entra,
permanece conectado, sai e recupera a senha sozinho

**Independent Test**: uma pessoa cria a conta, confirma o e-mail pelo Mailpit, entra, sai,
redefine a senha e entra de novo, sem ajuda

### Tests for User Story 1 ⚠️

- [ ] T056 [P] [US1] Escrever `backend/tests/integration/test_auth_register_verify.py`: cadastro exige aceitar a política; resposta `202` idêntica para e-mail novo e já cadastrado (com aviso por e-mail ao dono); `422 weak_password`; link de confirmação de uso único e válido por 24 horas; reenvio; conta não confirmada recebe `403` em qualquer rota
- [ ] T057 [P] [US1] Escrever `backend/tests/integration/test_auth_login_refresh.py`: cookie `httpOnly`, `Secure`, `SameSite=Strict` com `Path=/api/v1/auth/refresh`; `401` genérico para e-mail inexistente e senha errada; bloqueio de 15 minutos após 5 erros, mesmo com a senha certa; rotação do refresh; token antigo reutilizado revoga a sessão; refresh sem `X-Contai-Client` ou com `Origin` errado é recusado; sessão expira após 30 dias sem uso; logout revoga
- [ ] T058 [P] [US1] Escrever `backend/tests/integration/test_auth_password_reset.py`: resposta `202` idêntica exista ou não o e-mail; link de uso único válido por 1 hora; a redefinição encerra todas as sessões
- [ ] T059 [P] [US1] Escrever `frontend/src/features/auth/components/RegisterForm.test.tsx` e `LoginForm.test.tsx`: validação com Zod, aceite obrigatório da política, mensagens de erro que dizem o que fazer e estado de carregando

### Implementation for User Story 1

- [ ] T060 [P] [US1] Implementar `backend/app/modules/users/schemas.py` (`UserRead`)
- [ ] T061 [P] [US1] Implementar `backend/app/modules/auth/schemas.py` com as entradas e saídas das rotas de Auth de `contracts/rest-api.md`
- [ ] T062 [US1] Implementar em `backend/app/modules/auth/service.py` o cadastro, a confirmação de e-mail e o reenvio, enfileirando os e-mails por job e sem revelar se o e-mail existe (FR-001, FR-003 a FR-005, FR-008)
- [ ] T063 [US1] Implementar em `backend/app/modules/auth/service.py` o login, o bloqueio por tentativas no banco, o refresh com rotação e detecção de reutilização, a janela de 30 dias e o logout (FR-006, FR-007, FR-009)
- [ ] T064 [US1] Implementar em `backend/app/modules/auth/service.py` o pedido e a conclusão da redefinição de senha, encerrando todas as sessões (FR-010)
- [ ] T065 [US1] Implementar `backend/app/modules/auth/router.py` com as rotas `/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password/forgot` e `/auth/password/reset`, os limites de frequência, o cookie de refresh e a proteção CSRF do refresh; registrar em `backend/app/main.py`
- [ ] T066 [US1] Implementar `backend/app/modules/users/service.py` e `backend/app/modules/users/router.py` com `GET /users/me`; registrar em `backend/app/main.py` e no registro de isolamento
- [ ] T067 [P] [US1] Criar os modelos de e-mail em `backend/app/email/templates/`: `verify_email.txt`, `already_registered.txt` e `password_reset.txt`, em linguagem simples
- [ ] T068 [P] [US1] Implementar `frontend/src/features/auth/types.ts`, `frontend/src/features/auth/schemas.ts` (Zod) e `frontend/src/features/auth/services/authService.ts`
- [ ] T069 [US1] Implementar os hooks em `frontend/src/features/auth/hooks/`: `useRegister.ts`, `useLogin.ts`, `useLogout.ts`, `useVerifyEmail.ts`, `useResendVerification.ts`, `useForgotPassword.ts` e `useResetPassword.ts`
- [ ] T070 [US1] Implementar em `frontend/src/features/auth/components/` as telas `RegisterForm.tsx`, `LoginForm.tsx`, `VerifyEmailPage.tsx` (aguardando confirmação, reenvio e chegada pelo link), `ForgotPasswordPage.tsx` e `ResetPasswordPage.tsx`
- [ ] T071 [P] [US1] Implementar `frontend/src/features/auth/components/PrivacyPolicyPage.tsx` como rota pública, com a versão da política em `frontend/src/features/auth/privacy-policy.ts` e as seções exigidas pelo FR-002 (dados tratados, o que vai ao serviço de IA, uso dos dados pelo provedor, cópias de segurança por 14 dias)
- [ ] T072 [US1] Registrar as rotas públicas e a saída da conta em `frontend/src/router.tsx` e em `frontend/src/components/layout/Sidebar.tsx`

**Checkpoint**: a história 1 funciona sozinha; SC-001 (parte de acesso) e SC-003 conferidos

---

## Phase 4: User Story 2 - Organizar contas e lançar gastos à mão (Priority: P1)

**Goal**: cadastrar contas, usar categorias prontas e registrar, buscar, editar e excluir
despesas e receitas rapidamente, inclusive no celular

**Independent Test**: um usuário novo cadastra uma conta, lança uma despesa e uma receita, vê o
saldo atualizado, encontra os lançamentos pela busca, edita um e exclui outro

### Tests for User Story 2 ⚠️

- [ ] T073 [P] [US2] Escrever `backend/tests/unit/test_balance.py`: saldo igual ao saldo inicial mais receitas, menos despesas, mais transferências recebidas e menos enviadas; só transações entre a data de referência (inclusive) e hoje; transações anteriores e futuras não alteram o saldo
- [ ] T074 [P] [US2] Escrever `backend/tests/integration/test_accounts.py`: criar, editar, arquivar e desarquivar; excluir conta com transações responde `409 account_has_transactions`; o tipo não muda com transações; a data de referência padrão é o dia do cadastro
- [ ] T075 [P] [US2] Escrever `backend/tests/integration/test_categories.py`: categorias padrão criadas na confirmação do e-mail; dois níveis; `color` fora dos 8 nomes da paleta responde `422`; a categoria "Outros" não pode ser arquivada; arquivar a mãe arquiva as filhas
- [ ] T076 [P] [US2] Escrever `backend/tests/integration/test_transactions.py`: criar despesa e receita; valor maior que zero; conta e categoria ativas e do tipo compatível; filtros combinados por período, conta, categoria (com subcategorias), tipo e texto; paginação; editar e excluir
- [ ] T077 [P] [US2] Escrever `backend/tests/isolation/test_accounts_categories_transactions.py` e registrar os casos de todas as rotas de contas, categorias e transações
- [ ] T078 [P] [US2] Escrever `frontend/src/features/transactions/components/TransactionForm.test.tsx`: data preenchida com hoje, conta com a última usada, valor em centavos, categoria obrigatória e envio

### Implementation for User Story 2

- [ ] T079 [P] [US2] Criar `backend/app/modules/accounts/models.py` com `Account`: `type` (`checking`, `credit_card`, `cash`, `savings`, `investment`), `name` (1 a 60 caracteres, único entre as contas ativas do usuário), `institution` opcional, `initial_balance_cents` com sinal, `initial_balance_date`, `closing_day` e `due_day` (1 a 31; obrigatórios para cartão, nulos nos demais) e `archived_at`
- [ ] T080 [P] [US2] Criar `backend/app/modules/categories/models.py` com `Category`: `name` (1 a 40 caracteres, único entre irmãs ativas), `kind` (`expense`, `income`), `parent_id` (a mãe não pode ter mãe e tem o mesmo `kind`), `icon`, `color` (um dos 8 nomes da paleta; `ardosia` só em "Outros"), `is_fallback` e `archived_at`
- [ ] T081 [P] [US2] Criar `backend/app/modules/transactions/models.py` com `Transaction`, com todos os campos e índices de `data-model.md`: `type` (`expense`, `income`, `transfer`), `transfer_direction`, `amount_cents` maior que zero, `date`, `description` (1 a 200 caracteres), `description_normalized`, `notes`, `category_id`, `transfer_group_id`, `installment_group_id`, `installment_number`, `installment_count` (2 a 48), `import_id`, `external_id`, `fingerprint`, `source` (`manual`, `import`, `assistant`) e o índice único parcial em `(account_id, external_id)`
- [ ] T082 [US2] Criar a migração `backend/alembic/versions/0002_finance.py` com `accounts`, `categories` e `transactions`, incluindo as restrições `CHECK` e os índices
- [ ] T083 [P] [US2] Implementar `backend/app/modules/transactions/normalize.py` com teste em `backend/tests/unit/test_normalize.py`: descrição normalizada (minúsculas, sem acentos, sem pontuação e sem trechos numéricos ou de data) e `fingerprint` (hash de conta, data, tipo, valor e descrição normalizada)
- [ ] T084 [US2] Implementar `backend/app/modules/accounts/schemas.py`, `repository.py` (com a consulta de saldo do FR-023), `service.py` e `router.py` (rotas de Contas de `contracts/rest-api.md`); registrar em `backend/app/main.py`
- [ ] T085 [US2] Implementar `backend/app/modules/categories/schemas.py`, `repository.py`, `service.py` (lista de categorias padrão do FR-024 com ícone e cor, validação das 8 cores, dois níveis e regras de arquivamento) e `router.py`; registrar em `backend/app/main.py`
- [ ] T086 [US2] Chamar a criação das categorias padrão na confirmação de e-mail, na mesma transação de banco, em `backend/app/modules/auth/service.py`
- [ ] T087 [US2] Implementar `backend/app/modules/transactions/schemas.py`, `repository.py` (filtros combináveis, busca por texto em descrição e observação, paginação por cursor e `total_count`) e `service.py` (criar, editar e excluir despesa e receita, com descrição normalizada e `fingerprint`)
- [ ] T088 [US2] Implementar `backend/app/modules/transactions/router.py` com `GET /transactions`, `POST /transactions`, `GET`, `PATCH` e `DELETE /transactions/{id}`; registrar em `backend/app/main.py`
- [ ] T089 [P] [US2] Implementar `frontend/src/features/accounts/` (`types.ts`, `services/accountsService.ts`, `hooks/useAccounts.ts`, `components/AccountsPage.tsx` e `components/AccountForm.tsx`), com os estados de carregamento, erro e vazio e a confirmação ao excluir
- [ ] T090 [P] [US2] Implementar `frontend/src/features/categories/` (`types.ts`, `services/categoriesService.ts`, `hooks/useCategories.ts`, `components/CategoriesPage.tsx`, `components/CategoryForm.tsx` e `components/ColorPicker.tsx`): a escolha de cor oferece só as 8 amostras da paleta, cada uma com o nome ao lado
- [ ] T091 [P] [US2] Implementar `frontend/src/features/transactions/types.ts`, `services/transactionsService.ts` e os hooks `hooks/useTransactions.ts` (lista paginada com filtros), `hooks/useCreateTransaction.ts`, `hooks/useUpdateTransaction.ts` e `hooks/useDeleteTransaction.ts`
- [ ] T092 [US2] Implementar `frontend/src/features/transactions/components/TransactionList.tsx` conforme a seção 6.6 do `design-system.md`: grupos por dia com cabeçalho fixo e total, pauta e linha de margem, despesa em tinta comum com `−`, receita em `--income` com `+`, descrição em até duas linhas, esqueleto, vazio e erro
- [ ] T093 [US2] Implementar `frontend/src/features/transactions/components/TransactionForm.tsx` (seletor Despesa ou Receita, `MoneyInput`, descrição, categoria, conta, data e observação opcional, com React Hook Form e Zod) e abri-lo em folha pelo botão "Lançar" de `frontend/src/components/layout/BottomNav.tsx` e pelo "Novo lançamento" de `Sidebar.tsx`
- [ ] T094 [US2] Implementar `frontend/src/features/transactions/components/TransactionsPage.tsx` (busca, período e filtros: um botão "Filtros" até `sm`, três seletores a partir de `sm`) e `TransactionDetail.tsx` (editar e excluir com confirmação); registrar as rotas de contas, categorias e lançamentos em `frontend/src/router.tsx`

**Checkpoint**: histórias 1 e 2 funcionam; SC-001 completo, SC-005 (manual) e SC-009 conferidos

---

## Phase 5: User Story 3 - Entender o mês pelo painel (Priority: P1)

**Goal**: ao entrar, ver o resumo do mês, o saldo de cada conta, os gastos por categoria, a
evolução de 6 meses e os maiores gastos, com troca de mês e orientação para quem não tem
dados

**Independent Test**: com transações em dois meses, abrir o painel, conferir os totais com a
lista de transações, trocar de mês e abrir uma categoria

### Tests for User Story 3 ⚠️

- [ ] T095 [P] [US3] Escrever `backend/tests/unit/test_reports.py`: entradas, saídas e saldo do período; transferências fora dos totais; gastos por categoria com as subcategorias somadas na mãe e percentuais; evolução de 6 meses; maiores gastos; transação das 23h30 do último dia do mês em Brasília conta naquele mês
- [ ] T096 [P] [US3] Escrever `backend/tests/integration/test_dashboard.py` e os casos de isolamento em `backend/tests/isolation/test_dashboard.py`: as quatro rotas, o período padrão no mês atual de Brasília e a soma das transações de uma categoria igual ao valor do painel
- [ ] T097 [P] [US3] Escrever `frontend/src/features/dashboard/hooks/useDashboard.test.ts`: troca de mês, estados de carregamento e erro e painel vazio

### Implementation for User Story 3

- [ ] T098 [US3] Implementar `backend/app/modules/dashboard/schemas.py`, `repository.py` (consultas agregadas por período) e `service.py` (`ReportingService`, a única fonte de números do painel e do assistente: resumo, por categoria, evolução e maiores gastos)
- [ ] T099 [US3] Implementar `backend/app/modules/dashboard/router.py` com `GET /dashboard/summary`, `/dashboard/categories`, `/dashboard/trend` e `/dashboard/top-expenses`; registrar em `backend/app/main.py`
- [ ] T100 [P] [US3] Implementar `frontend/src/features/dashboard/types.ts`, `services/dashboardService.ts` e `hooks/useDashboard.ts`
- [ ] T101 [P] [US3] Implementar `frontend/src/features/dashboard/components/MonthSummary.tsx` (saldo do mês em `money-hero` com `marca-texto`, entradas e saídas com seta e rótulo) e `PeriodPicker.tsx` (título do mês como botão; setas a partir de 480px); o painel escolhe só o mês (FR-059), sem intervalo de datas
- [ ] T102 [P] [US3] Implementar `frontend/src/features/dashboard/components/CategoryRanking.tsx` conforme a seção 7.2 do `design-system.md`: barras ordenadas, no máximo 6 linhas com "Outras" em `ardosia`, selo, nome, percentual e valor; cada linha abre os lançamentos da categoria no período
- [ ] T103 [P] [US3] Implementar `frontend/src/features/dashboard/components/TrendChart.tsx` com Recharts conforme as seções 7.1 e 7.3: barras agrupadas de entradas e saídas, legenda, tooltip, `role="img"` com resumo, "Ver como tabela", toque em um mês muda o mês do painel e animação desligada com movimento reduzido
- [ ] T104 [P] [US3] Implementar `frontend/src/features/dashboard/components/AccountsCard.tsx`, `TopExpenses.tsx` e `FirstSteps.tsx` (orientações de primeiros passos para quem não tem dados, FR-060)
- [ ] T105 [US3] Implementar `frontend/src/features/dashboard/components/DashboardPage.tsx` com a entrada orquestrada da seção 9.2 do `design-system.md` (cascata de 60ms e o traço do marca-texto) e registrá-la como rota inicial em `frontend/src/router.tsx`

**Checkpoint**: as três histórias P1 funcionam juntas; é o MVP utilizável no dia a dia

---

## Phase 6: User Story 4 - Cartão de crédito, parcelas e transferências (Priority: P2)

**Goal**: informar fechamento e vencimento do cartão, lançar compras parceladas, registrar
transferências (inclusive pagamento de fatura) e ver a fatura atual e as parcelas futuras

**Independent Test**: cadastrar um cartão com dia de fechamento, lançar uma compra em 3
parcelas e uma transferência, e conferir fatura atual, parcelas futuras e resumo do mês

### Tests for User Story 4 ⚠️

- [ ] T106 [P] [US4] Escrever `backend/tests/unit/test_invoices.py`: compra no dia 9 entra na fatura que fecha no dia 10 e compra no dia 10 entra na seguinte; fechamento nos dias 29, 30 e 31 em mês curto usa o último dia; fatura atual é a que contém hoje; parcelas futuras são as das faturas posteriores à atual
- [ ] T107 [P] [US4] Escrever `backend/tests/integration/test_installments_transfers.py`: R$ 100,00 em 3 parcelas gera R$ 33,34, R$ 33,33 e R$ 33,33 nas datas certas; parcelamento só em cartão, de 2 a 48 parcelas; edição e exclusão com escopo `single` ou `group`; transferência cria duas linhas, altera os dois saldos, não muda entradas nem saídas e é editada e excluída nos dois lados; compra de 28 de setembro conta em setembro
- [ ] T108 [P] [US4] Registrar em `backend/tests/isolation/test_accounts_categories_transactions.py` os casos de `POST /transactions/installments`, `POST /transactions/transfers` e `GET /dashboard/cards`
- [ ] T109 [P] [US4] Escrever `frontend/src/features/transactions/components/TransactionForm.installments.test.tsx`: a compra parcelada só aparece para conta de cartão; de 2 a 48 parcelas; a prévia mostra o valor de cada parcela com o resto de centavos na primeira (R$ 100,00 em 3 mostra R$ 33,34 e 2 de R$ 33,33)

### Implementation for User Story 4

- [ ] T110 [P] [US4] Implementar `backend/app/modules/transactions/invoices.py`: funções puras de data de fechamento, período, vencimento, fatura atual e parcelas futuras, conforme a seção 17 de `research.md`
- [ ] T111 [US4] Implementar em `backend/app/modules/transactions/service.py` e `repository.py` a compra parcelada (grupo, número e total de parcelas, com `split_installments` e `add_months`) e a edição e exclusão com escopo (FR-030, FR-032)
- [ ] T112 [US4] Implementar em `backend/app/modules/transactions/service.py` e `repository.py` a transferência entre contas próprias (duas linhas com o mesmo `transfer_group_id`, `out` e `in`, contas diferentes) e sua edição e exclusão nos dois lados (FR-033, FR-034)
- [ ] T113 [US4] Acrescentar `POST /transactions/installments`, `POST /transactions/transfers` e o parâmetro `scope` de `PATCH` e `DELETE` em `backend/app/modules/transactions/router.py` e `schemas.py`
- [ ] T114 [US4] Implementar o resumo de cartões em `backend/app/modules/dashboard/service.py` e `repository.py` e a rota `GET /dashboard/cards` em `backend/app/modules/dashboard/router.py` (fatura atual e parcelas futuras por mês e no total, FR-058)
- [ ] T115 [P] [US4] Acrescentar dia de fechamento e de vencimento, só para cartão, em `frontend/src/features/accounts/components/AccountForm.tsx`
- [ ] T116 [US4] Acrescentar em `frontend/src/features/transactions/components/TransactionForm.tsx` a opção "Transferência" (conta de origem e de destino) e a compra parcelada (número de parcelas e prévia do valor de cada uma), com os hooks `hooks/useCreateInstallments.ts` e `hooks/useCreateTransfer.ts`
- [ ] T117 [US4] Implementar `frontend/src/features/transactions/components/ScopeDialog.tsx` ("só esta parcela" ou "todas as parcelas") e usá-lo em `TransactionDetail.tsx`; mostrar transferência e "3/10" em `TransactionList.tsx`
- [ ] T118 [US4] Implementar `frontend/src/features/dashboard/components/CardsCard.tsx` (fatura atual, fechamento, parcelas futuras e o gráfico de série única da seção 7.4 do `design-system.md`) e incluí-lo em `DashboardPage.tsx`

**Checkpoint**: histórias 1 a 4 funcionam; números de cartão e transferências batem com o painel

---

## Phase 7: User Story 5 - Importar extratos em OFX, CSV ou planilha (Priority: P2)

**Goal**: enviar um OFX, CSV ou planilha de qualquer banco, revisar tudo antes de salvar, com
categorias sugeridas e duplicatas sinalizadas, e poder desfazer a importação

**Independent Test**: importar um OFX, confirmar, importar de novo sem duplicar; importar um CSV
desconhecido mapeando as colunas uma vez; desfazer uma importação

### Tests for User Story 5 ⚠️

- [ ] T119 [P] [US5] Criar em `backend/tests/fixtures/` arquivos com dados fictícios: OFX no formato de pelo menos três bancos (incluindo um fora do padrão e um com saldo informado), CSV com `;` e com `,`, com datas e decimais em formatos diferentes e com colunas separadas de entrada e saída, e um XLSX
- [ ] T120 [P] [US5] Escrever `backend/tests/unit/test_importer_ofx.py`: leitura de cada fixture, `FITID` como identificador externo, saldo informado, arquivo fora do padrão lido após o pré-processamento e arquivo ilegível com código de erro
- [ ] T121 [P] [US5] Escrever `backend/tests/unit/test_importer_tabular.py`: detecção de delimitador e codificação, `MappingRequired` com prévia quando não há modelo, aplicação de um mapeamento, formatos de data e de decimal, convenção de sinal, colunas de entrada e saída, e XLSX
- [ ] T122 [P] [US5] Escrever `backend/tests/unit/test_duplicates.py`: identificador externo já existente é `exact`; `fingerprint` comparado por contagem; mesma conta, tipo e valor com até 3 dias de diferença é `probable`, inclusive contra lançamento manual; `exact` e `probable` chegam desmarcadas
- [ ] T123 [P] [US5] Escrever `backend/tests/unit/test_categorization.py`: regra do usuário vence; cache da IA; lote à IA só com as descrições distintas e a lista de categorias; resposta inválida cai em "Outros"; correção do usuário grava regra `user` que a IA não sobrescreve; regra de categoria arquivada é ignorada
- [ ] T124 [P] [US5] Escrever `backend/tests/unit/test_upload_validation.py` e `backend/tests/unit/test_invoice_payment_detection.py`: limite de 10 MB, tipo real pelo conteúdo, arquivo vazio ou de tipo trocado recusado, nome gerado pelo sistema; linhas de pagamento de fatura sugeridas como transferência
- [ ] T125 [P] [US5] Escrever `backend/tests/integration/test_imports_flow.py`: envio cria job; processamento leva a `awaiting_review` sem salvar transações; confirmação grava só as linhas marcadas, com as correções, em uma transação; reimportação do mesmo arquivo gera zero duplicatas; mapeamento salvo é reaplicado; importar histórico anterior à data de referência não muda o saldo; aviso de divergência de saldo; desfazer remove tudo de uma vez; arquivo apagado após o processamento; falha não salva nada; importação em `awaiting_review` há mais de 7 dias e em `awaiting_mapping` há mais de 24 horas expira com `review_expired` e `mapping_expired`, sem salvar nada (FR-083)
- [ ] T126 [P] [US5] Escrever `backend/tests/isolation/test_imports.py` e registrar os casos de todas as rotas de importação
- [ ] T127 [P] [US5] Escrever `frontend/src/features/imports/hooks/useImportReview.test.ts`: marcar e desmarcar, marcar todas, editar linha, duplicatas desmarcadas por padrão e montagem do corpo da confirmação

### Implementation for User Story 5

- [ ] T128 [P] [US5] Criar `backend/app/modules/imports/models.py` com `Import` (`kind` em `statement`, `receipt`; `format` em `ofx`, `csv`, `xlsx`, `pdf`, `image`; `status` em `queued`, `processing`, `awaiting_mapping`, `awaiting_review`, `completed`, `undone`, `failed`; `file_hash`; `stored_filename`; `error_code`; `mapping_preview`; totais do documento; saldo informado e sua data; contagens), `ImportItem` (`duplicate_status` em `none`, `exact`, `probable`; `category_source` em `user_rule`, `ai`, `fallback`; `selected_by_default`) e `ImportTemplate` (`header_signature` único por usuário; `mapping`)
- [ ] T129 [P] [US5] Criar `backend/app/modules/categorization/models.py` com `CategorizationRule`: `description_normalized` único por usuário, `category_id` em cascata e `source` (`user`, `ai`)
- [ ] T130 [US5] Criar a migração `backend/alembic/versions/0003_imports.py` com `imports`, `import_items`, `import_templates` e `categorization_rules`, e a chave estrangeira de `transactions.import_id` com `ON DELETE SET NULL`
- [ ] T131 [P] [US5] Implementar `backend/app/modules/imports/storage.py`: leitura em blocos com limite de 10 MB, tipo real com `filetype` e inspeção de conteúdo para OFX e CSV, nome UUID, gravação no volume privado, hash SHA-256 e exclusão
- [ ] T132 [P] [US5] Implementar `backend/app/modules/imports/importers/base.py` conforme `contracts/internal-interfaces.md`: protocolo `Importer` (`detect`, `extract`, `normalize`), `ImportContext`, `RawDocument`, `ProposedTransaction`, `MappingRequired`, `ImportError` e o registro de importadores
- [ ] T133 [P] [US5] Implementar `backend/app/modules/imports/importers/ofx.py` com `ofxtools` e pré-processamento tolerante (codificação, cabeçalho e datas fora do padrão), extraindo `FITID` e o saldo informado
- [ ] T134 [P] [US5] Implementar `backend/app/modules/imports/importers/tabular.py`: `csv` da biblioteca padrão com detecção de delimitador e codificação, `openpyxl` em modo somente leitura, assinatura do cabeçalho, sugestão de colunas por heurística, prévia das primeiras linhas e aplicação do mapeamento
- [ ] T135 [P] [US5] Implementar `backend/app/modules/imports/duplicates.py` com os três níveis da seção 14 de `research.md`
- [ ] T136 [P] [US5] Implementar `backend/app/modules/imports/detection.py` conforme o FR-081: uma linha é sugerida como pagamento de fatura, e portanto como transferência entre a conta e o cartão, quando é uma saída e a descrição normalizada contém um dos termos `pagamento fatura`, `pag fatura`, `pgto fatura`, `pagto cartao` ou `fatura cartao` (lista em uma constante do módulo); com mais de um cartão, sugere o cartão cuja fatura em aberto tem o valor mais próximo do valor da linha; sem cartão cadastrado, não sugere nada
- [ ] T137 [US5] Escrever o prompt versionado `backend/app/modules/categorization/prompts/categorize_v1.md` e implementar `backend/app/modules/categorization/repository.py` e `service.py`: sugestão em ordem (regra do usuário, cache da IA, lote à IA só com descrições distintas e a lista de categorias, usando o prompt do arquivo, e por fim "Outros"), gravação do uso em `ai_usage` pelo repositório de `ai` e aprendizado com correções por correspondência exata da descrição normalizada (FR-048)
- [ ] T138 [US5] Chamar o aprendizado de categoria ao criar e ao editar uma transação em `backend/app/modules/transactions/service.py` (FR-048)
- [ ] T139 [US5] Implementar `backend/app/modules/imports/schemas.py` e `repository.py` (importações, itens e modelos de colunas)
- [ ] T140 [US5] Implementar em `backend/app/modules/imports/service.py` o envio (validação, hash, criação da importação e do job) e o processamento (escolha do importador, descrição normalizada e `fingerprint`, duplicatas, categorias, pagamento de fatura, gravação dos `import_items`, estados `awaiting_mapping`, `awaiting_review` e `failed`, exclusão do arquivo)
- [ ] T141 [US5] Implementar em `backend/app/modules/imports/service.py` o envio do mapeamento (salva o `ImportTemplate` e reenfileira), a leitura com `total_check` e `balance_check` (FR-082), a confirmação em uma única transação de banco (transações, transferências sugeridas, regras aprendidas e exclusão dos itens), o desfazer em uma única transação, o descarte e o histórico
- [ ] T142 [US5] Implementar `backend/app/worker/jobs/process_import.py` e registrá-lo em `backend/app/worker/main.py`
- [ ] T143 [US5] Implementar em `backend/app/modules/imports/repository.py` e `service.py` a expiração do FR-083 (importações em `awaiting_mapping` há mais de 24 horas e em `awaiting_review` há mais de 7 dias viram `failed` com `mapping_expired` ou `review_expired`, e os arquivos órfãos são apagados) e a tarefa periódica `backend/app/worker/jobs/cleanup.py`, que só chama esse serviço, sem consulta direta ao banco; registrá-la em `backend/app/worker/main.py`
- [ ] T144 [US5] Implementar `backend/app/modules/imports/router.py` com as rotas de Importações de `contracts/rest-api.md` e o limite de frequência de envio; registrar em `backend/app/main.py`
- [ ] T145 [P] [US5] Implementar `frontend/src/features/imports/types.ts`, `services/importsService.ts` e os hooks `hooks/useUploadImport.ts`, `hooks/useImport.ts` (consulta a cada 2 segundos enquanto o estado não é final), `hooks/useImportReview.ts`, `hooks/useConfirmImport.ts`, `hooks/useUndoImport.ts` e `hooks/useImports.ts`
- [ ] T146 [US5] Implementar `frontend/src/features/imports/components/UploadPage.tsx` (arquivo, conta de destino, andamento e mensagens de erro que dizem o que fazer) e `MappingStep.tsx` (escolha das colunas de data, descrição e valor, formato de data, separador decimal e prévia das primeiras linhas interpretadas); a etapa de mapeamento avisa que o arquivo fica guardado por 24 horas (FR-083)
- [ ] T147 [US5] Implementar `frontend/src/features/imports/components/ReviewPage.tsx` com o modo de revisão da seção 6.6 do `design-system.md`: marcar e desmarcar linhas e todas de uma vez, corrigir valor, data, descrição e categoria, selos "Possível duplicata" e "Já importada", sugestão de transferência, avisos de divergência de total e de saldo com os dois valores, e confirmação; a tela mostra até quando a importação fica disponível para revisão (7 dias, FR-083)
- [ ] T148 [US5] Implementar `frontend/src/features/imports/components/ImportHistoryPage.tsx` (data, arquivo, conta, quantidade e situação; desfazer com confirmação) e registrar as rotas de importação em `frontend/src/router.tsx` e na folha "Mais"; importações expiradas aparecem como "Expirada", com a orientação de enviar o arquivo de novo

**Checkpoint**: SC-006, SC-007 e SC-008 conferidos com as fixtures

---

## Phase 8: User Story 6 - Perguntar ao assistente sobre as finanças (Priority: P2)

**Goal**: perguntar em português e receber números exatos, com as transações que compõem o
valor, perguntas de continuação, histórico e sugestões

**Independent Test**: com dados conhecidos, fazer as seis perguntas de exemplo da spec e
comparar cada número com o painel e com a lista de transações

### Tests for User Story 6 ⚠️

- [ ] T149 [P] [US6] Escrever `backend/tests/unit/test_periods.py`: cada `preset` de `contracts/assistant-tools.md` resolvido em datas no fuso de Brasília, com rótulo em português
- [ ] T150 [P] [US6] Escrever `backend/tests/unit/test_assistant_tools.py`, com um bloco por ferramenta (`get_spending_summary`, `get_income_summary`, `compare_periods`, `get_top_expenses`, `search_transactions`, `get_account_balances`, `get_card_invoices`): resultado idêntico ao do `ReportingService`, valor em centavos e formatado, `transaction_ids`, transferências fora dos totais, parâmetro inválido devolvido como erro descritivo e ids de outro usuário tratados como inexistentes
- [ ] T151 [P] [US6] Escrever `backend/tests/unit/test_answer_validation.py`: texto com valor ou percentual ausente dos resultados das ferramentas é recusado; texto só com valores presentes passa; a resposta de reserva é montada dos resultados
- [ ] T152 [P] [US6] Escrever `backend/tests/integration/test_assistant.py` com o `FakeLLMProvider`: resposta com transações; continuação com contexto; pedido de esclarecimento; recusa fora do tema; período sem dados; descrição com instrução embutida não muda o comportamento; `429 ai_limit_reached` com `resets_at`; `503 ai_unavailable`; no máximo 5 rodadas de ferramentas; `user_id` sempre vindo da sessão; números iguais aos do painel
- [ ] T153 [P] [US6] Escrever `backend/tests/isolation/test_assistant.py` e registrar os casos de todas as rotas do assistente
- [ ] T154 [P] [US6] Escrever `frontend/src/features/assistant/components/AssistantMessage.test.tsx`: marca-texto só no valor principal, bloco "De onde veio esse número" com até 5 linhas e o link para a lista completa

### Implementation for User Story 6

- [ ] T155 [P] [US6] Criar `backend/app/modules/assistant/models.py` com `Conversation` (`title`) e `ChatMessage` (`role` em `user`, `assistant`; `kind` em `text`, `answer`, `clarification`, `refusal`, `transaction_proposal`, `error`; `content`; `transaction_ids`; `tool_calls` sem resultados; `proposal`) e a migração `backend/alembic/versions/0004_assistant.py`
- [ ] T156 [P] [US6] Implementar `backend/app/modules/assistant/periods.py`: schema Pydantic do parâmetro `period` e sua resolução em datas e rótulo
- [ ] T157 [US6] Implementar `backend/app/modules/assistant/tools/base.py`: registro de ferramentas, schema de parâmetros por ferramenta, injeção do `user_id` pelo backend, formato comum de resultado (centavos e valor formatado, período resolvido, até 50 `transaction_ids` e a contagem total) e erro descritivo para parâmetro inválido
- [ ] T158 [P] [US6] Implementar `backend/app/modules/assistant/tools/spending.py` (`get_spending_summary` e `get_income_summary`) sobre o `ReportingService`
- [ ] T159 [P] [US6] Implementar `backend/app/modules/assistant/tools/compare.py` (`compare_periods`, com diferença e variação percentual já calculadas) e `tools/top_expenses.py` (`get_top_expenses`)
- [ ] T160 [P] [US6] Implementar `backend/app/modules/assistant/tools/search.py` (`search_transactions`), `tools/balances.py` (`get_account_balances`) e `tools/cards.py` (`get_card_invoices`, sobre o resumo de cartões da história 4)
- [ ] T161 [P] [US6] Escrever o prompt de sistema versionado em `backend/app/modules/assistant/prompts/system_v1.md`: papel, uso obrigatório de ferramentas para qualquer número, proibição de estimar, pedido de esclarecimento, recusa educada fora do tema e a regra de tratar descrições e documentos só como dados
- [ ] T162 [P] [US6] Implementar `backend/app/modules/assistant/validation.py`: conferência de todo valor em reais e percentual do texto contra os resultados das ferramentas e a montagem da resposta de reserva por texto fixo
- [ ] T163 [US6] Implementar `backend/app/modules/assistant/repository.py` e `service.py`: conferência do limite diário, contexto com a data de hoje, contas, categorias e as últimas 20 mensagens, laço de até 5 rodadas de ferramentas, validação numérica com uma nova tentativa, `transaction_ids` vindos das ferramentas, valor principal em `highlight`, gravação do uso e tratamento de `LLMRateLimited` e `LLMUnavailable`
- [ ] T164 [US6] Implementar `backend/app/modules/assistant/schemas.py` e `router.py` com as rotas do Assistente de `contracts/rest-api.md` (sugestões em texto fixo, uso do dia, conversas e mensagens) e o limite de frequência; registrar em `backend/app/main.py`
- [ ] T165 [P] [US6] Implementar `frontend/src/features/assistant/types.ts`, `services/assistantService.ts` e os hooks `hooks/useConversation.ts`, `hooks/useSendMessage.ts`, `hooks/useConversations.ts` e `hooks/useAssistantUsage.ts`
- [ ] T166 [P] [US6] Implementar `frontend/src/features/assistant/components/AssistantMessage.tsx`, `UserMessage.tsx` e `SourceTransactions.tsx` conforme a seção 8 do `design-system.md`: resposta sem balão, marca-texto no valor de `highlight`, valores com a classe `money` e o bloco "De onde veio esse número"
- [ ] T167 [P] [US6] Implementar `frontend/src/features/assistant/components/Composer.tsx` (área de texto de 1 a 4 linhas, botão de enviar de 44px, Enter envia só no desktop, aviso "Restam N perguntas hoje" e aviso de limite atingido) e `Suggestions.tsx` (sugestões e respostas rápidas)
- [ ] T168 [US6] Implementar `frontend/src/features/assistant/components/ChatPage.tsx` (lista com `aria-live="polite"`, estado "Consultando seus lançamentos…", chat vazio com sugestões, erro com "Tentar de novo", faixa do campo de escrita com fundo próprio e folga de 20px) e `ConversationHistory.tsx` (ver, apagar uma conversa e apagar todas, com confirmação); registrar a rota em `frontend/src/router.tsx`

**Checkpoint**: SC-010 conferido com as seis perguntas de exemplo; SC-014 medido com o provedor
real

---

## Phase 9: User Story 7 - Importar PDF de extrato, fatura ou comprovante (Priority: P3)

**Goal**: enviar PDF de extrato ou fatura, ou foto e PDF de comprovante, com aviso antes do
primeiro envio, a mesma revisão das outras importações e a conferência do total do documento

**Independent Test**: enviar o PDF de uma fatura com total conhecido e a foto de um recibo, ver
o aviso no primeiro envio, revisar as propostas e conferir a comparação com o total

### Tests for User Story 7 ⚠️

- [ ] T169 [P] [US7] Escrever `backend/tests/unit/test_importer_statement_ai.py` e `backend/tests/unit/test_importer_receipt_ai.py` com o `FakeLLMProvider`: linhas e total extraídos, valores em texto convertidos com `Decimal`, soma diferente do total registrada como divergência, comprovante gera uma única proposta e resposta inválida vira erro com código
- [ ] T170 [P] [US7] Escrever `backend/tests/integration/test_imports_ai_flow.py`: PDF ou imagem sem aceite responde `403 ai_consent_required`; limite diário responde `429 ai_limit_reached`; PDF cifrado é recusado; `LLMRateLimited` reenfileira com backoff sem reenvio do arquivo; documento ilegível termina em `failed` sem salvar nada; o uso é gravado como extração
- [ ] T171 [P] [US7] Escrever `frontend/src/features/imports/components/AiConsentDialog.test.tsx`: o aviso aparece antes do primeiro envio de PDF ou imagem; cancelar não envia nada; aceitar registra o consentimento e segue com o envio; depois do aceite o aviso não aparece de novo

### Implementation for User Story 7

- [ ] T172 [US7] Implementar `POST /users/me/consents/ai-documents` em `backend/app/modules/users/service.py` e `router.py`, gravando `ai_documents_consent_at` (FR-044)
- [ ] T173 [P] [US7] Escrever os prompts versionados `backend/app/modules/imports/prompts/statement_v1.md` e `receipt_v1.md` e os schemas Pydantic de saída em `backend/app/modules/imports/importers/ai_schemas.py` (linhas com data, descrição e valor em texto; total do documento opcional)
- [ ] T174 [P] [US7] Implementar `backend/app/modules/imports/importers/statement_ai.py`: PDF de extrato ou fatura enviado ao modelo de extração com saída estruturada, com o conteúdo tratado só como dado
- [ ] T175 [P] [US7] Implementar `backend/app/modules/imports/importers/receipt_ai.py`: foto ou PDF de comprovante gerando uma única transação proposta
- [ ] T176 [US7] Estender `backend/app/modules/imports/storage.py` (PDF, JPG e PNG; PDF cifrado detectado pelo marcador `/Encrypt`) e `backend/app/modules/imports/service.py` (aceite e limite diário conferidos no envio, comparação da soma extraída com o total do documento e gravação do uso)
- [ ] T177 [US7] Tratar `LLMRateLimited` e `LLMUnavailable` em `backend/app/worker/jobs/process_import.py`: nova tentativa com backoff e estado visível ao usuário (FR-072)
- [ ] T178 [P] [US7] Implementar `frontend/src/features/imports/components/AiConsentDialog.tsx` (aviso de que o conteúdo será processado por um serviço de IA externo, que pode usar os dados para melhorar seus modelos; aceitar ou cancelar) e `hooks/useAiConsent.ts`
- [ ] T179 [US7] Estender `frontend/src/features/imports/components/UploadPage.tsx` (escolha entre extrato ou fatura e comprovante; PDF e imagem; aviso antes do primeiro envio; mensagem amigável enquanto o serviço de IA está indisponível) e `ReviewPage.tsx` (aviso de divergência entre a soma extraída e o total do documento)

**Checkpoint**: PDF e imagem passam pelo mesmo fluxo de revisão da história 5

---

## Phase 10: User Story 8 - Lançar um gasto escrevendo uma frase (Priority: P3)

**Goal**: escrever "gastei 45 no ifood ontem no cartão" e receber a transação preenchida para
confirmar ou ajustar

**Independent Test**: escrever três frases de gastos, conferir as propostas, ajustar uma e
confirmar; as transações aparecem na lista

### Tests for User Story 8 ⚠️

- [ ] T180 [P] [US8] Escrever `backend/tests/unit/test_propose_transaction.py`: valor em texto (`"45"`, `"45,90"`) convertido com `Decimal`; `today`, `yesterday` e data explícita resolvidos em Brasília; conta e categoria encontradas pelas dicas; dois cartões deixam a conta em aberto; frase sem valor devolve o que falta; nada é gravado
- [ ] T181 [P] [US8] Acrescentar em `backend/tests/integration/test_assistant.py` os casos de lançamento por texto: mensagem `transaction_proposal`, nenhuma transação criada antes da confirmação, uso contado como pergunta e a proposta marcada como salva
- [ ] T182 [P] [US8] Escrever `frontend/src/features/assistant/components/ProposalCard.test.tsx`: mostra valor, data, conta e categoria; "Conferir e salvar" abre o formulário preenchido; nada é salvo antes da confirmação; "Descartar" remove a proposta; depois de salvo mostra "Lançamento salvo"

### Implementation for User Story 8

- [ ] T183 [US8] Implementar `backend/app/modules/assistant/tools/propose.py` (`propose_transaction`, sem gravação) e tratar o tipo `transaction_proposal` em `backend/app/modules/assistant/service.py`
- [ ] T184 [US8] Implementar `POST /assistant/messages/{id}/proposal/saved` em `backend/app/modules/assistant/router.py` e `service.py`: marca a proposta como salva com o id de uma transação do próprio usuário; registrar o caso de isolamento
- [ ] T185 [P] [US8] Implementar `frontend/src/features/assistant/components/ProposalCard.tsx` conforme a seção 8 do `design-system.md`: valor, data, conta e categoria, "Conferir e salvar" e "Descartar"; depois de salvo, mostra "Lançamento salvo" com o link
- [ ] T186 [US8] Abrir `frontend/src/features/transactions/components/TransactionForm.tsx` preenchido a partir da proposta, salvar com `source = assistant` e marcar a proposta como salva, em `frontend/src/features/assistant/hooks/useSaveProposal.ts`

**Checkpoint**: SC-005 (por texto, em menos de 10 segundos) conferido com o provedor real

---

## Phase 11: User Story 9 - Reforçar a proteção da conta (Priority: P3)

**Goal**: ativar a verificação em duas etapas com códigos de recuperação, ver e encerrar
sessões, alterar nome e senha, e recuperar o acesso por e-mail com espera de 72 horas

**Independent Test**: ativar as duas etapas, sair, entrar com o código, usar um código de
recuperação, encerrar uma sessão de outro navegador e trocar a senha

### Tests for User Story 9 ⚠️

- [ ] T187 [P] [US9] Escrever `backend/tests/unit/test_totp.py`: código do passo atual e de um passo de tolerância aceitos, reuso do mesmo passo recusado, e o segredo cifrado e decifrado com a chave das configurações
- [ ] T188 [P] [US9] Escrever `backend/tests/integration/test_two_factor.py`: preparar e ativar com um código; 10 códigos de recuperação exibidos uma vez; com as duas etapas ativas, senha correta devolve `challenge_token` e não dá acesso; código de recuperação é de uso único; erro de código conta para o bloqueio; desativar exige senha e código; gerar novos códigos invalida os anteriores
- [ ] T189 [P] [US9] Escrever `backend/tests/integration/test_two_factor_reset.py`: o pedido exige o `challenge_token`; o link cria o pedido com efeito em 72 horas e envia o aviso; lembrete 24 horas antes; cancelamento pelo link e por login com código válido; no prazo, o worker desativa as duas etapas, apaga os códigos e encerra todas as sessões
- [ ] T190 [P] [US9] Escrever `backend/tests/integration/test_sessions_profile.py` e `backend/tests/isolation/test_sessions.py`: listar sessões com a atual marcada; encerrar uma e todas as outras; sessão encerrada perde o acesso na requisição seguinte; alterar nome; trocar senha exige a senha atual e encerra as outras sessões; a sessão de outro usuário responde `404`
- [ ] T191 [P] [US9] Escrever `frontend/src/features/settings/components/TwoFactorSection.test.tsx`: mostra o QR code e o segredo em texto; código errado mostra erro que diz o que fazer; código certo ativa e exibe os 10 códigos de recuperação com o aviso de guardá-los

### Implementation for User Story 9

- [ ] T192 [P] [US9] Acrescentar `RecoveryCode` (`code_hash`, `used_at`) e `TwoFactorResetRequest` (`requested_at`, `effective_at`, `reminder_sent_at`, `cancelled_at`, `applied_at`; no máximo um em aberto por usuário) em `backend/app/modules/auth/models.py` e criar a migração `backend/alembic/versions/0005_two_factor.py`
- [ ] T193 [P] [US9] Acrescentar em `backend/app/core/security.py` o TOTP com `pyotp` (tolerância de um passo e bloqueio de reuso), a cifra do segredo com Fernet e a geração dos códigos de recuperação
- [ ] T194 [US9] Implementar em `backend/app/modules/users/service.py` e `router.py` as rotas `/users/me/2fa/setup`, `/2fa/enable`, `/2fa/disable` e `/2fa/recovery-codes` (FR-011, FR-013)
- [ ] T195 [US9] Implementar em `backend/app/modules/auth/service.py` e `router.py` a segunda etapa do login (`challenge_token` e `POST /auth/login/2fa`) e o cancelamento de pedido em aberto ao entrar com código válido (FR-012)
- [ ] T196 [US9] Implementar em `backend/app/modules/auth/service.py` e `router.py` as rotas `/auth/2fa/reset/request`, `/confirm` e `/cancel`, com os modelos de e-mail `two_factor_reset_link.txt`, `two_factor_reset_notice.txt`, `two_factor_reset_reminder.txt` e `two_factor_reset_applied.txt` em `backend/app/email/templates/`
- [ ] T197 [US9] Implementar em `backend/app/modules/auth/service.py` e `repository.py` o envio do lembrete 24 horas antes e a aplicação dos pedidos vencidos (desativa as duas etapas, apaga os códigos de recuperação e encerra todas as sessões), e a tarefa periódica `backend/app/worker/jobs/two_factor_reset.py`, que só chama esse serviço, sem consulta direta ao banco; registrá-la em `backend/app/worker/main.py`
- [ ] T198 [US9] Implementar em `backend/app/modules/users/service.py` e `router.py` as rotas `PATCH /users/me`, `POST /users/me/password`, `GET /users/me/sessions`, `DELETE /users/me/sessions/{id}` e `DELETE /users/me/sessions` (FR-014, FR-015); o rótulo do dispositivo é derivado do user-agent no formato "Navegador no Sistema" (por exemplo, "Chrome no Android"), com "Dispositivo desconhecido" quando não for reconhecido
- [ ] T199 [P] [US9] Implementar `frontend/src/features/settings/types.ts`, `services/settingsService.ts` e os hooks `hooks/useProfile.ts`, `hooks/useSessions.ts` e `hooks/useTwoFactor.ts`
- [ ] T200 [P] [US9] Implementar `frontend/src/features/settings/components/TwoFactorSection.tsx`: QR code com `qrcode.react` e o segredo em texto, confirmação por código, exibição dos 10 códigos de recuperação com o aviso sobre a recuperação por e-mail em 72 horas, desativar e gerar novos códigos
- [ ] T201 [P] [US9] Implementar `frontend/src/features/settings/components/ProfileSection.tsx`, `PasswordSection.tsx`, `SessionsSection.tsx` (encerrar com confirmação) e `ThemeSection.tsx` (Claro, Escuro e Automático)
- [ ] T202 [US9] Implementar `frontend/src/features/settings/components/SettingsPage.tsx` e registrar a rota em `frontend/src/router.tsx`
- [ ] T203 [US9] Acrescentar em `frontend/src/features/auth/components/` a etapa do código em `TwoFactorStep.tsx` (campo com `inputmode="numeric"` e `autocomplete="one-time-code"`, opção de código de recuperação) e as telas `TwoFactorResetRequestPage.tsx`, `TwoFactorResetConfirmPage.tsx` e `TwoFactorResetCancelPage.tsx`

**Checkpoint**: SC-004 conferido

---

## Phase 12: User Story 10 - Levar os dados embora ou excluir a conta (Priority: P3)

**Goal**: baixar todos os dados em um arquivo e excluir a conta, com 7 dias para desistir

**Independent Test**: baixar os dados e conferir o conteúdo; pedir a exclusão, cancelar dentro
do prazo, pedir de novo e, passados os 7 dias, não conseguir mais entrar

### Tests for User Story 10 ⚠️

- [ ] T204 [P] [US10] Escrever `backend/tests/integration/test_export.py`: o ZIP contém perfil, contas, categorias, transações, importações e conversas do próprio usuário e nada de outro usuário
- [ ] T205 [P] [US10] Escrever `backend/tests/integration/test_account_deletion.py`: o pedido exige a senha, desativa a conta na hora, encerra as sessões, cancela os jobs pendentes e envia o e-mail com a data; durante os 7 dias só `GET /users/me` e o cancelamento funcionam; o cancelamento restaura tudo; no prazo, o worker apaga o usuário e, em cascata, todas as tabelas e os arquivos; depois disso não é possível entrar
- [ ] T206 [P] [US10] Escrever `frontend/src/features/settings/components/DeleteAccountSection.test.tsx`: mostra o aviso do prazo de 7 dias e o convite a baixar os dados; exige a senha; pede confirmação antes de enviar; senha errada mostra o erro sem fechar o diálogo

### Implementation for User Story 10

- [ ] T207 [P] [US10] Implementar `backend/app/modules/users/export.py`: ZIP gerado com `zipfile` e `csv` da biblioteca padrão (CSV para contas, categorias, transações e importações; JSON para perfil e conversas), lendo os dados só pelos repositórios de `users`, `accounts`, `categories`, `transactions`, `imports` e `assistant`, sempre com `user_id`
- [ ] T208 [US10] Implementar em `backend/app/modules/users/service.py` e `router.py` as rotas `GET /users/me/export`, `POST /users/me/deletion` e `DELETE /users/me/deletion`, com o modelo `backend/app/email/templates/account_deletion_scheduled.txt` (FR-016, FR-017)
- [ ] T209 [US10] Implementar em `backend/app/modules/users/service.py` a exclusão definitiva das contas vencidas (apaga o usuário pelo repositório de `users`, com cascata no banco, e remove os arquivos remanescentes) e a tarefa periódica `backend/app/worker/jobs/account_deletion.py`, que só chama esse serviço, sem consulta direta ao banco; registrá-la em `backend/app/worker/main.py`
- [ ] T210 [P] [US10] Implementar `frontend/src/features/settings/components/ExportSection.tsx` e `DeleteAccountSection.tsx` (aviso do prazo de 7 dias, convite a baixar os dados antes e confirmação com a senha) e incluí-las em `SettingsPage.tsx`
- [ ] T211 [US10] Implementar `frontend/src/features/settings/components/PendingDeletionPage.tsx` (data da exclusão e botão de cancelar) e direcionar para ela em `frontend/src/features/auth/hooks/useAuth.tsx` quando a conta está em exclusão

**Checkpoint**: SC-011 conferido adiantando o prazo em ambiente de teste

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: produção, operação, documentação e as conferências que cruzam todas as histórias

- [ ] T212 Acrescentar a `backend/app/worker/jobs/cleanup.py` a limpeza periódica de tokens de e-mail expirados, de sessões expiradas ou revogadas há mais de 30 dias e de jobs concluídos antigos, chamando o serviço de `auth` e a fila do worker, que usam os repositórios de `auth` e do worker; nenhuma consulta direta ao banco no job
- [ ] T213 [P] Escrever `backend/tests/integration/test_security_headers.py` e `backend/tests/integration/test_log_redaction.py`: cabeçalhos `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options` e `Referrer-Policy` nas respostas; nenhum log com senha, token, descrição, valor ou conteúdo de documento
- [ ] T214 [P] Escrever `backend/tests/integration/test_rate_limits.py`: resposta `429 rate_limited` com o cabeçalho `Retry-After` ao exceder o limite em login, cadastro, reenvio de confirmação, recuperação de senha, envio de arquivo e mensagens ao assistente (FR-009)
- [ ] T215 Criar `docker-compose.prod.yml` e `infra/Caddyfile`: HTTPS automático pelo domínio das configurações, política de segurança de conteúdo da seção 26 de `research.md`, HSTS, limite de 10 MB no envio, `postgres` sem porta publicada e o volume de uploads fora de qualquer pasta servida
- [ ] T216 [P] Criar o serviço de backup em `infra/backup/`: `Dockerfile`, `backup.sh` (`pg_dump` diário, compactado, cifrado com `age` por chave pública e enviado com `rclone` a um armazenamento de objetos; retenção de 14 dias), `restore.sh` e `README.md` com o procedimento de restauração
- [ ] T217 Executar o procedimento de restauração de `infra/backup/README.md` contra um banco temporário e registrar o resultado no próprio arquivo
- [ ] T218 Criar `infra/deploy.sh` (atualiza o código, constrói as imagens e sobe `docker-compose.prod.yml`) e o job de deploy em `.github/workflows/ci.yml`, dependente dos jobs de CI e restrito à branch principal
- [ ] T219 [P] Escrever os ADRs em `docs/adr/`: `0001-fila-de-jobs-no-postgresql.md`, `0002-sessoes-e-tokens.md`, `0003-camada-de-ia-e-garantia-numerica.md`, `0004-dinheiro-em-centavos-e-saldo-calculado.md`, `0005-importadores-e-duplicatas.md`, `0006-uploads-em-volume-privado.md`, `0007-backup-cifrado.md` e `0008-politica-de-seguranca-de-conteudo.md`
- [ ] T220 [P] Escrever o texto final da política de privacidade em `frontend/src/features/auth/privacy-policy.ts`, depois de conferir os termos atuais do provedor de IA (seção 27 de `research.md`)
- [ ] T221 [P] Criar `backend/scripts/seed_demo.py`, que gera um usuário de demonstração com 5.000 transações fictícias pelos serviços dos módulos (sem consulta direta ao banco), e conferir com ele que o painel aparece em até 3 segundos (SC-013)
- [ ] T222 Conferir os itens da seção 27 de `research.md` e ajustar `.env.example`: ids atuais dos modelos e cotas do plano gratuito, limites diários compatíveis com a cota, tolerância do `ofxtools` com arquivos reais e cookies `Secure` em `http://localhost`
- [ ] T223 Passar a lista da seção 11 do `design-system.md` em todas as telas de `frontend/src/features/`, em 320px e em desktop, nos dois temas, com teclado, com leitor de tela e com movimento reduzido, corrigindo o que falhar
- [ ] T224 Conferir a cobertura de 80% em `backend/app/modules` e que `backend/tests/isolation/test_all_routes_covered.py` passa com todas as rotas registradas, completando os testes que faltarem
- [ ] T225 [P] Escrever `README.md` na raiz: visão do projeto, capturas de tela, arquitetura, decisões técnicas com links para os ADRs e instruções para rodar localmente com `docker compose up`
- [ ] T226 Executar o roteiro completo de `specs/001-contai-mvp/quickstart.md`, incluindo a validação com o provedor de IA real (SC-005, SC-010 e SC-014), e corrigir o que falhar

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende do Setup e bloqueia todas as histórias
- **US1 (Phase 3)**: depende da Foundational; todas as outras histórias precisam de um usuário
  autenticado, então a US1 vem antes de qualquer uma
- **US2 (Phase 4)**: depende da US1
- **US3 (Phase 5)**: depende da US2 (precisa de contas e transações)
- **US4 (Phase 6)**: depende da US2; o cartão do painel (T114, T118) depende da US3
- **US5 (Phase 7)**: depende da US2 e da US4 (a confirmação da importação cria as transferências
  sugeridas, com o serviço de transferências da US4)
- **US6 (Phase 8)**: depende da US3 (o `ReportingService`); a ferramenta de cartões (T160)
  depende da US4
- **US7 (Phase 9)**: depende da US5
- **US8 (Phase 10)**: depende da US6 e do formulário da US2
- **US9 (Phase 11)**: depende só da US1
- **US10 (Phase 12)**: depende da US1; a exportação fica completa com as histórias de dados já
  implementadas
- **Polish (Phase 13)**: depende das histórias que forem entregues

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬─ US2 ─┬─ US3 ───────┬─ US6 ── US8
                            │       └─ US4 ─┬─────┘
                            │               └─ US5 ── US7
                            ├─ US9
                            └─ US10
```

US9 e US10 não dependem das histórias de dados e podem ser feitas em paralelo com elas, logo
depois da US1.

### Within Each User Story

- Os testes são escritos primeiro e devem falhar antes da implementação
- Modelos e migração antes de repositórios e serviços
- Serviços antes de rotas
- Backend antes das telas que o consomem; `types.ts` e `services/` antes de hooks; hooks antes
  de componentes
- A história termina no seu checkpoint, antes de passar para a próxima prioridade

### Parallel Opportunities

- No Setup, T006, T007, T008 e T010 rodam juntos depois de T001
- Na Foundational, os blocos de backend (T014 a T017, T019 a T022, T025, T026, T033 e T034) e de frontend
  (T040, T042 a T045 e T047 a T052) são independentes entre si
- Em cada história, todas as tarefas de teste marcadas [P] rodam juntas, e o trabalho de
  frontend que só depende do contrato pode avançar em paralelo com o backend
- US9 e US10 podem ser feitas por outra pessoa enquanto as histórias de dados avançam
- Dentro da US6, as ferramentas (T158 a T160) são arquivos separados e rodam juntas depois de
  T157

---

## Parallel Example: User Story 2

```bash
# Todos os testes da história 2 juntos:
Task: "Escrever backend/tests/unit/test_balance.py"
Task: "Escrever backend/tests/integration/test_accounts.py"
Task: "Escrever backend/tests/integration/test_categories.py"
Task: "Escrever backend/tests/integration/test_transactions.py"
Task: "Escrever frontend/src/features/transactions/components/TransactionForm.test.tsx"

# Os três modelos juntos:
Task: "Criar backend/app/modules/accounts/models.py"
Task: "Criar backend/app/modules/categories/models.py"
Task: "Criar backend/app/modules/transactions/models.py"

# As três features de frontend juntas, a partir do contrato:
Task: "Implementar frontend/src/features/accounts/"
Task: "Implementar frontend/src/features/categories/"
Task: "Implementar types, services e hooks de frontend/src/features/transactions/"
```

---

## Implementation Strategy

### MVP First

A história 1 sozinha entrega acesso seguro, mas ainda não entrega controle financeiro. O MVP
utilizável são as três histórias P1:

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: US1 — validar o acesso de ponta a ponta
4. Phase 4: US2 — validar o lançamento manual e os saldos
5. Phase 5: US3 — validar o painel
6. **Parar e validar**: blocos 1 a 3 do `quickstart.md`, em 320px e nos dois temas
7. Colocar em produção com as tarefas T215 a T218 da Phase 13

### Incremental Delivery

1. Setup + Foundational → base pronta
2. US1 + US2 + US3 → MVP: contas, lançamentos manuais e painel
3. US4 → cartão, parcelas e transferências
4. US5 → importação de OFX, CSV e planilha
5. US6 → assistente
6. US7 e US8 → importação por IA e lançamento por texto
7. US9 e US10 → proteção da conta, exportação e exclusão
8. Polish → documentação, conferências finais e validação completa

A US9 e a US10 são P3 na spec, mas a constituição exige a verificação em duas etapas e o
direito de exclusão: elas precisam estar prontas antes de o sistema receber usuários de fora do
grupo inicial de teste.

### Parallel Team Strategy

Com mais de uma pessoa, depois da US1:

- Pessoa A: US2 → US3 → US6 → US8
- Pessoa B: US9 → US10
- Pessoa C: entra na US4 assim que a US2 terminar, e segue para US5 → US7

---

## Notes

- [P] = arquivos diferentes e nenhuma dependência de tarefa incompleta
- [Story] liga a tarefa à história da spec, para rastreabilidade
- Conferir que os testes falham antes de implementar
- Fazer commit ao fim de cada tarefa ou grupo lógico, com mensagens em Conventional Commits
- Cada checkpoint é um ponto para validar a história de forma independente
- Toda dependência nova, além das listadas na seção 25 de `research.md`, exige justificativa
  registrada antes de entrar

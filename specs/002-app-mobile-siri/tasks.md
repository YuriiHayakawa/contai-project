---

description: "Lista de tarefas do app mobile do Contaí e do lançamento por voz pela Siri (feature 002)"
---

# Tasks: App mobile do Contaí e lançamento por voz pela Siri

**Input**: Design documents from `/specs/002-app-mobile-siri/`

**Prerequisites**:

- [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md) e
  [data-model.md](data-model.md);
- os contratos [rest-api.md](contracts/rest-api.md) e
  [siri-shortcut.md](contracts/siri-shortcut.md);
- o roteiro [quickstart.md](quickstart.md);
- o `design-system.md` na raiz.

**Tests**: incluídos. O Princípio X da constituição torna os testes obrigatórios, também no app.
Em cada história, os testes são escritos primeiro e devem falhar antes da implementação.

**Organization**: as tarefas são agrupadas por história de usuário (US1 a US13 = histórias 1
a 13 da spec). As histórias da P1 vêm na ordem de construção do plano. A P2 só começa com toda a
P1 verde no roteiro do iPhone. A P3 (US13) fica para depois da entrega e não tem tarefas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo, porque mexe em arquivos diferentes e não depende de tarefa
  incompleta.
- **[Story]**: a história da spec.
- **FORA DO CÓDIGO (Mx)**: tarefa do mantenedor, que não escreve código (M1 a M10 do
  plano). Ela não pode ser feita pelo agente. O agente para e avisa quando chega numa delas.

## Path Conventions

- **Backend**:
  - código em `backend/app/` e testes em `backend/tests/` (`integration/`, `isolation/`,
    `unit/`);
  - a migração nova é `backend/alembic/versions/0010_mobile_voice.py`.
- **Site**: `frontend/src/`, com os testes ao lado do arquivo. A função da Vercel fica em
  `frontend/api/siri.ts`.
- **App**:
  - as rotas do Expo Router ficam em `mobile/app/` e só compõem a tela; nenhum teste fica em
    `mobile/app/`;
  - o código fica em `mobile/src/`, com os testes ao lado do arquivo (`*.test.ts[x]`);
  - cada `mobile/src/features/<feature>/` tem `components/`, `hooks/`, `services/` e
    `types.ts`.
- **Código do site no app**: `@web/*` é `frontend/src/*`. O app só pode importar de
  `@web/lib/money`, `@web/lib/dates`, `@web/lib/paths`, `@web/features/*/types` e
  `@web/features/*/schemas` (research, seção 4).

## Regras que valem para todas as tarefas

- As regras da constituição 2.1.0 e do ADR 0012 valem em toda tarefa. Em especial:
  - só repositórios acessam o banco, sempre com `user_id`;
  - mensagens ao usuário em português, nomes no código em inglês;
  - frase falada e token pessoal nunca aparecem em logs;
  - valores sempre em centavos inteiros.
- Os testes do backend usam PostgreSQL real e a IA falsa. Nenhum teste gasta cota do Gemini.
- Toda rota nova entra em `backend/tests/isolation/registry.py`. O
  `test_all_routes_covered.py` falha se faltar alguma.
- No app, todo elemento tocável tem `accessibilityRole` e `accessibilityLabel` e área mínima de
  44×44 pt. Nenhum `Text` limita a escala da fonte. Toda tela tem estados de carregamento, de
  erro com orientação e vazio.
- Nunca sobrescrever um `.env`. Variável nova vai só para o `.env.example` correspondente, e o
  mantenedor é avisado.
- Antes de cada push: `bash infra/ci-local.sh` verde, inclusive a formatação.

## Marcos (um por dia) e corte

| Marco | Data | Tarefas | Pronto quando |
|-------|------|---------|---------------|
| **D1** | 18–19/11 | T001–T034 | O app abre no Expo Go com tema e fontes. A prova do `@web` está decidida. O login do app funciona no backend local, com testes. |
| **D2** | 19–20/11 | T035–T048 | US1 e US2 funcionam no iPhone contra a produção, depois da M3. |
| **D3** | 20–21/11 | T049–T073 | US3: a Siri lança em produção. M4, M5 e M6 feitas. |
| **D4** | 21–22/11 | T074–T093 | US4 e US5 no app e no site. A política de privacidade está revisada (M8). |
| **D5** | 23/11 | T094–T097 e o **corte 1** (T130) | US6 pronta, ou cortada. |
| **D6** | 24/11 | **Corte 2** (T131), T098–T101 (se não cortadas) e T140–T147 | US7 pronta, ou cortada. Acabamento feito e roteiro completo (M7). |
| **D7** | 25/11 | T150–T153 | Entrega. |

**Corte explícito** (spec, "Prioridades e corte"):

- **Corte 1 (T130, 23/11 à noite)**: se o caminho entrar → lançar → Siri → desfazer → painel
  (US1 a US5) não estiver inteiro no iPhone, a **US7 (foto do comprovante) sai**. O D6 vira
  conserto desse caminho e acabamento.
- **Corte 2 (T131, 24/11 ao meio-dia)**: se ainda faltar acabamento (T140 a T146), a **US6
  (assistente) sai** também. Sem US6, a aba "Assistente" não aparece, e a entrega não mostra
  tela vazia nem quebrada.

---

## Phase 1: Setup (Marco D1)

**Purpose**: criar o projeto `mobile/`, decidir o código compartilhado e ligar o app ao CI.

- [X] T001 **FORA DO CÓDIGO (M1)**: conferir no Expo Go do iPhone a versão do SDK. Resultado em
  2026-11-18: Expo Go 58.0.5, com SDK 58.0.0, e atualizações automáticas da App Store
  desligadas até a entrega. Está registrado em `specs/002-app-mobile-siri/plan.md`.
- [ ] T002 Criar o projeto Expo SDK 58 em `mobile/` com `npx create-expo-app@latest mobile
  --template blank-typescript` (SDK 58).
  - Configurar o Expo Router: `main: "expo-router/entry"` em `mobile/package.json`.
  - Em `mobile/app.json`: nome "Contaí", `scheme: "contai"`, `userInterfaceStyle: "automatic"`,
    `ios.supportsTablet: false` e o plugin `expo-router`.
- [ ] T003 Instalar as dependências com `npx expo install`, que escolhe as versões do SDK 58, e
  registrá-las em `mobile/package.json`. A justificativa de cada uma está no plan.md, em Primary
  Dependencies.
  - **Dependências do app**: `expo-router`, `react-native-safe-area-context`,
    `react-native-screens`, `expo-linking`, `expo-constants`, `expo-secure-store`,
    `expo-font`, `expo-clipboard`, `expo-image-picker`, `expo-image-manipulator`,
    `@expo-google-fonts/besley`, `@expo-google-fonts/atkinson-hyperlegible-next`,
    `@tanstack/react-query`, `react-hook-form`, `zod` (mesma versão maior do site: 4) e
    `@hookform/resolvers`.
  - **Dependências de desenvolvimento**: `jest-expo`, `jest`, `@types/jest`,
    `@testing-library/react-native`, `eslint`, `eslint-config-expo` e `prettier`.
  - **Se o pacote da Atkinson Hyperlegible Next não existir**: converter
    `frontend/src/assets/fonts/AtkinsonHyperlegibleNext-Variable.woff2` para TTF estáticos
    (Regular, SemiBold e Bold). Guardar em `mobile/assets/fonts/` com a licença OFL.
- [ ] T004 Configurar `mobile/tsconfig.json`: `extends: "expo/tsconfig.base"`, `strict: true`,
  `noUncheckedIndexedAccess: true` e `paths`:
  - `"@/*": ["./src/*"]`;
  - `"@web/*": ["../frontend/src/*"]`;
  - `"zod": ["./node_modules/zod"]`.
- [ ] T005 Configurar `mobile/metro.config.js`, partindo de `getDefaultConfig`.
  - `watchFolders`: `path.resolve(__dirname, "../frontend/src")`.
  - `resolver.resolveRequest`: `zod` sempre resolve para `mobile/node_modules/zod`, e o resto
    segue a resolução padrão.
  - Comentário: "uma cópia só do zod (research, seção 4)".
- [ ] T006 Configurar `mobile/jest.config.js` e `mobile/jest.setup.ts`.
  - No `jest.config.js`: `preset: "jest-expo"`; `moduleNameMapper` para `^@/(.*)$`,
    `^@web/(.*)$` (`<rootDir>/../frontend/src/$1`) e `^zod$`; `transformIgnorePatterns`
    padrão do jest-expo.
  - No setup: um `expo-secure-store` falso em memória e o `fetch` global falso.
- [ ] T007 [P] Configurar o lint e a formatação.
  - `mobile/eslint.config.js`: flat config com `eslint-config-expo`.
    `@typescript-eslint/no-explicit-any: "error"`. `no-restricted-imports` permite de `@web/`
    só `lib/money`, `lib/dates`, `lib/paths`, `features/*/types` e `features/*/schemas`.
  - `mobile/.prettierrc`: igual ao do site.
  - Scripts em `mobile/package.json`: `lint`, `format`, `format:check`, `typecheck`
    (`tsc --noEmit`) e `test`.
- [ ] T008 Fazer a prova do código compartilhado, com **meio dia de limite** (constituição,
  Princípio XIV).
  - Criar `mobile/src/lib/web-imports.test.ts`. Ele importa `formatBRL` de `@web/lib/money`, as
    funções de data de `@web/lib/dates` e um schema de `@web/features/transactions/schemas`, e
    confere um valor, uma data perto da meia-noite em America/Sao_Paulo e uma validação.
  - Mostrar os mesmos três resultados numa tela temporária, `mobile/app/index.tsx`, aberta no
    Expo Go do iPhone, para conferir o `Intl` no Hermes.
  - **Se passar do meio dia**: copiar os arquivos para `mobile/src/shared/`, trocar o apelido e
    registrar o desvio temporário em `specs/002-app-mobile-siri/plan.md`, em Complexity
    Tracking, com a lista de arquivos e o plano de adequação (M10).
- [ ] T009 [P] Criar `mobile/.env.example`, com as variáveis documentadas, e
  `mobile/src/lib/config.ts`.
  - Variáveis: `EXPO_PUBLIC_API_URL=https://contai-project.vercel.app` e
    `EXPO_PUBLIC_SHORTCUT_URL=`, vazia até a M6.
  - O `config.ts` lê as variáveis e valida com zod: URL https obrigatória fora do
    desenvolvimento; link do atalho opcional.
  - Garantir `mobile/.env` no `.gitignore`.
- [ ] T010 [P] Acrescentar a etapa "Mobile: npm ci, lint, formatação, tipos, testes e auditoria"
  em `infra/ci-local.sh` e um job `mobile` equivalente em `.github/workflows/ci.yml`, que
  continua desligado no GitHub (desvio do Princípio XII).
- [ ] T011 **FORA DO CÓDIGO (M2)**: criar `mobile/.env` a partir de `mobile/.env.example` com
  `EXPO_PUBLIC_API_URL=https://contai-project.vercel.app`. Se o QR code não abrir o app,
  liberar o Metro (porta 8081) no firewall do Windows ou usar `npx expo start --tunnel`.

---

## Phase 2: Foundational (Marco D1, bloqueia todas as histórias)

**Purpose**: a migração única, os modelos, o tema, os componentes base e o cliente HTTP do app
com a sessão.

### Backend

- [ ] T012 Criar a migração `backend/alembic/versions/0010_mobile_voice.py`, com `downgrade`.
  - **`sessions.client`**: `VARCHAR(10)` NOT NULL, `server_default 'web'`, com
    `CHECK (client IN ('web', 'mobile'))`.
  - **Tabela `personal_tokens`**:
    - `id` UUID PK;
    - `user_id` UUID FK `users.id` ON DELETE CASCADE;
    - `name` `VARCHAR(60)` NOT NULL;
    - `secret_hash` `CHAR(64)` NOT NULL;
    - `default_account_id` UUID FK `accounts.id` ON DELETE SET NULL, NULL;
    - `created_at`, `last_used_at` e `revoked_at` (`timestamptz`);
    - `revoked_reason` `VARCHAR(30)`, com `CHECK` em `user_revoked`, `password_changed` e
      `password_reset`;
    - índice `ix_personal_tokens_user_active` em `(user_id)` `WHERE revoked_at IS NULL`.
  - **`transactions.source_valid`**: o `CHECK` ganha `'voice'`.
  - **`transactions.voice_phrase`**: `TEXT` NULL, com três `CHECK`:
    - `voice_phrase IS NULL OR source = 'voice'`;
    - `source <> 'voice' OR voice_phrase IS NOT NULL`;
    - `voice_phrase IS NULL OR char_length(voice_phrase) <= 300`.
- [ ] T013 Atualizar os modelos de acordo com o `data-model.md`.
  - `Session.client` em `backend/app/modules/auth/models.py`, com um `SessionClient(StrEnum)`
    `web`/`mobile`.
  - Modelo `PersonalToken`, com `PersonalTokenRevokedReason`, em
    `backend/app/modules/auth/models.py`.
  - `TransactionSource.VOICE = "voice"` e `voice_phrase: Mapped[str | None]` em
    `backend/app/modules/transactions/models.py`.
- [ ] T014 [P] Acrescentar `AiTask.VOICE_ENTRY` em `backend/app/ai/models.py` e incluí-lo no
  balde `LimitKind.QUESTION`, junto com `CHAT` e `TEXT_ENTRY`, em `backend/app/ai/usage.py`.
- [ ] T015 Rodar `backend/tests/integration/test_migrations.py` (upgrade, downgrade e upgrade) e
  ajustar o que a migração quebrar.

### App

- [ ] T016 [P] Criar `mobile/src/theme/tokens.ts`, com as cores, espaçamentos, raios e tamanhos
  de texto do `design-system.md`, nos temas claro e escuro. Criar também
  `mobile/src/theme/useTheme.ts`, que escolhe o tema por `useColorScheme()` e muda na hora.
- [ ] T017 [P] Criar `mobile/src/theme/fonts.ts`. Ele carrega Besley (títulos) e Atkinson
  Hyperlegible Next (texto) com `useFonts`, e exporta as famílias por peso.
- [ ] T018 Criar `mobile/app/_layout.tsx`. Ele carrega as fontes (com a tela de abertura
  mantida até carregar), fornece `QueryClientProvider` (cache só em memória), `SessionProvider`
  e `SafeAreaProvider`, e ajusta a barra de status pelo tema.
- [ ] T019 [P] Criar os componentes base em `mobile/src/components/ui/`, seguindo o
  `design-system.md`:
  - `Screen.tsx` (com `ScrollView`);
  - `Button.tsx`;
  - `TextField.tsx` (rótulo visível, erro no campo e `accessibilityHint`);
  - `MoneyInput.tsx`;
  - `MoneyText.tsx`, que usa `formatBRL` do `@web` e lê o valor por extenso no
    `accessibilityLabel`;
  - `LoadingState.tsx`, `ErrorState.tsx` (com o que fazer) e `EmptyState.tsx`;
  - `ConfirmDialog.tsx`;
  - `Toast.tsx`, com ação opcional e anúncio por `AccessibilityInfo.announceForAccessibility`.
- [ ] T020 [P] Criar `mobile/src/components/ui/ui.test.tsx`. Ele confere os papéis e rótulos
  acessíveis, a área de toque e o `MoneyText` lendo "45 reais e 90 centavos".
- [ ] T021 Criar `mobile/src/lib/session.test.ts`, que deve falhar primeiro.
  - O refresh token é gravado no `expo-secure-store` na chave `contai.refresh_token`, com
    `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
  - É lido na abertura e apagado no logout.
  - O access token fica só em memória e nunca passa pelo secure store.
- [ ] T022 Implementar `mobile/src/lib/session.ts`, com `saveRefreshToken`,
  `readRefreshToken`, `clearSession`, `getAccessToken` e `setAccessToken`, e
  `mobile/src/features/auth/SessionProvider.tsx`. O provedor guarda o estado
  `loading | signedOut | signedIn` e o motivo da última saída.
- [ ] T023 Criar `mobile/src/lib/api-client.test.ts`, que deve falhar primeiro.
  - Toda chamada leva `X-Contai-Client: mobile` e `Authorization` com o access token.
  - Um 401 dispara **uma única** renovação (`POST /api/v1/auth/mobile/refresh`), mesmo com
    três requisições simultâneas. Cada requisição é repetida uma vez.
  - Se a renovação falha, a sessão é apagada e `onSessionEnded("expired")` é chamado.
  - Com relógio falso, uma requisição de mais de 4 s liga o aviso "Acordando o servidor…".
  - O tempo limite é de 90 s.
  - Os erros vêm no formato padronizado, com `code` e `message`.
- [ ] T024 Implementar `mobile/src/lib/api-client.ts`, com a renovação compartilhada como uma
  promessa única, `mobile/src/lib/waking.ts` e
  `mobile/src/components/ui/WakingBanner.tsx`.
- [ ] T025 [P] Criar `mobile/src/lib/query-client.ts` (padrões de nova tentativa sem repetir
  401/403/422) e `mobile/src/lib/use-refetch-on-focus.ts`, que atualiza as consultas ao voltar
  ao app ou à tela (`AppState` e foco da navegação). O SC-004 precisa disso.

**Checkpoint**: o app abre no Expo Go com tema, fontes e cliente HTTP testado.

---

## Phase 3: User Story 1 - Entrar no app e continuar conectado (P1, marcos D1 e D2) 🎯 MVP

**Goal**: entrar com e-mail, senha e duas etapas, continuar conectado com a sessão no Keychain,
sair, e ir ao site para as ações de conta.

**Independent Test**: os quatro passos da história 1 na spec (entrar com duas etapas, reabrir,
encerrar a sessão pelo site, sair), também no [quickstart.md](quickstart.md), seção 4.

### Testes (escritos primeiro, D1)

- [ ] T026 [P] [US1] Criar `backend/tests/integration/test_auth_mobile.py`:
  - `POST /api/v1/auth/mobile/login` sem `X-Contai-Client: mobile` responde 400;
  - com o cabeçalho, devolve `access_token` e `refresh_token` no corpo e nenhum `Set-Cookie`;
  - com duas etapas, devolve um desafio com `client = mobile`;
  - `/auth/login/2fa` recusa um desafio do app, e `/auth/mobile/login/2fa` recusa um desafio
    do site;
  - `/auth/mobile/refresh` troca o token;
  - reutilizar um token antigo revoga a sessão;
  - um refresh token `mobile` no `/auth/refresh` e um `web` no `/auth/mobile/refresh` recebem
    401 **sem** revogar a sessão;
  - o rate limit e o bloqueio após 5 erros são os mesmos do login do site;
  - `POST /api/v1/auth/logout` encerra a sessão `mobile`;
  - a troca de senha revoga as sessões `mobile`;
  - `GET /api/v1/users/me/sessions` traz `client`.
- [ ] T027 [P] [US1] Registrar `POST /auth/mobile/login`, `/auth/mobile/login/2fa` e
  `/auth/mobile/refresh` como rotas públicas em `backend/tests/isolation/registry.py`.
- [ ] T028 [P] [US1] Criar `mobile/src/features/auth/hooks/useLogin.test.tsx`:
  - login sem duas etapas grava a sessão;
  - com duas etapas, leva à tela do código e aceita código ou código de recuperação;
  - credenciais erradas mostram a mensagem genérica;
  - e-mail não confirmado e bloqueio temporário mostram as mensagens do site.
- [ ] T029 [P] [US1] Criar `mobile/src/features/auth/guard.test.tsx` com `renderRouter` do
  `expo-router/testing-library`. O teste fica fora de `mobile/app/`, porque ali todo arquivo
  vira rota.
  - sem sessão, qualquer rota de `(app)` leva a `/entrar`;
  - com sessão, o painel abre;
  - quando a sessão termina, a entrada mostra o motivo ("Sua sessão foi encerrada…").

### Backend (D1)

- [ ] T030 [US1] Em `backend/app/core/security.py`, o token de desafio ganha a declaração
  `client` (`web` | `mobile`). `decode_challenge_token` devolve `(user_id, client)`. Ajustar os
  usos em `backend/app/modules/auth/service.py`.
- [ ] T031 [US1] Em `backend/app/modules/auth/repository.py` e
  `backend/app/modules/auth/service.py`:
  - `login(..., client)` e `complete_two_factor_login(..., client)` criam a sessão com o
    `client`;
  - `refresh(refresh_token, client)` recusa, com `Unauthenticated` e sem detectar reutilização,
    uma sessão de outro tipo.
- [ ] T032 [US1] Em `backend/app/modules/auth/schemas.py` e `backend/app/modules/auth/router.py`:
  - criar `MobileTokenResponse` e `MobileRefreshRequest`;
  - criar as rotas `/auth/mobile/login`, `/auth/mobile/login/2fa` e `/auth/mobile/refresh`, com
    `_login_limit` nas duas primeiras e o cabeçalho `X-Contai-Client: mobile` obrigatório;
  - os três endpoints não leem nem gravam o cookie;
  - `/auth/refresh` e `/auth/login/2fa` passam `client=web`.
- [ ] T033 [US1] Acrescentar `client` ao schema de leitura de sessões e a
  `GET /api/v1/users/me/sessions`, em `backend/app/modules/users/schemas.py` e
  `backend/app/modules/users/router.py`.
- [ ] T034 [P] [US1] Na tela de sessões do site
  (`frontend/src/features/settings/components/`, com o tipo em
  `frontend/src/features/settings/types.ts`), mostrar "App do Contaí" para `client = mobile`.
  Atualizar o teste do componente.

### App (D2)

- [ ] T035 [P] [US1] Criar `mobile/src/features/auth/types.ts`, que reaproveita
  `@web/features/auth/types` quando servir, e `mobile/src/features/auth/services/auth.ts`, com
  `login`, `loginTwoFactor`, `logout` e `refresh`, conforme `contracts/rest-api.md`.
- [ ] T036 [US1] Criar `mobile/src/features/auth/hooks/useLogin.ts`,
  `useTwoFactorLogin.ts` e `useLogout.ts`. O logout chama a API, apaga a sessão e o cache
  de consultas.
- [ ] T037 [US1] Criar `mobile/src/features/auth/components/LoginForm.tsx` e
  `TwoFactorForm.tsx`.
  - Usam React Hook Form e o schema de login de `@web/features/auth/schemas`.
  - O formulário de duas etapas alterna entre código do app e código de recuperação.
  - Criar as rotas `mobile/app/(auth)/entrar.tsx` e `mobile/app/(auth)/duas-etapas.tsx`.
- [ ] T038 [US1] Criar o guard único em `mobile/app/(app)/_layout.tsx`, que redireciona para
  `/entrar` sem sessão e mostra o motivo, e as abas em `mobile/app/(app)/(abas)/_layout.tsx`:
  Painel, Lançamentos, Assistente e Mais.
- [ ] T039 [US1] Criar `mobile/app/(app)/(abas)/mais.tsx`.
  - "Sair" com confirmação.
  - Links que abrem o site por `expo-linking`, usando `@web/lib/paths`: criar conta, esqueci a
    senha, duas etapas (configurações), sessões, exportar dados e excluir conta (FR-006).
  - Atalho para "Conectar à Siri".
  - Na tela de entrada, os links "Criar conta" e "Esqueci a senha".
- [ ] T040 **FORA DO CÓDIGO (M3)**: aprovar o merge na `main` com `infra/ci-local.sh` verde,
  para publicar o login do app no Render. A migração 0010 roda na subida da API. Depois,
  conferir no iPhone a história 1 contra a produção.

**Checkpoint**: US1 funciona no iPhone contra a produção.

---

## Phase 4: User Story 2 - Lançar e corrigir lançamentos pelo celular (P1, marco D2)

**Goal**: criar despesa ou receita, listar o mês, editar e excluir com confirmação.

**Independent Test**: os quatro passos da história 2 na spec. Lançar uma despesa precisa
levar menos de 10 s (SC-002).

### Testes

- [ ] T041 [P] [US2] Criar `mobile/src/features/transactions/components/TransactionForm.test.tsx`:
  - sugestões iniciais: conta mais usada, data de hoje em America/Sao_Paulo e categoria pela
    descrição, com "Outros" quando não há sugestão;
  - valor vazio, zero ou inválido mostra o erro no campo e não envia;
  - "Receita" troca as categorias.
- [ ] T042 [P] [US2] Criar `mobile/src/features/transactions/hooks/useTransactions.test.tsx`:
  - a lista do mês vem da mais recente para a mais antiga e muda com o mês;
  - criar, editar e excluir invalidam a lista e o painel;
  - excluir só acontece depois da confirmação.

### Implementação

- [ ] T043 [P] [US2] Criar `mobile/src/features/accounts/services/accounts.ts`,
  `mobile/src/features/accounts/hooks/useAccounts.ts`,
  `mobile/src/features/categories/services/categories.ts` e
  `mobile/src/features/categories/hooks/useCategories.ts`, só leitura, com os tipos de
  `@web/features/accounts/types` e `@web/features/categories/types`.
- [ ] T044 [US2] Criar `mobile/src/features/transactions/services/transactions.ts`: listar com
  filtros de mês e categoria, ver, criar, editar e excluir. Usa os tipos de
  `@web/features/transactions/types` e os endpoints que já existem.
- [ ] T045 [US2] Criar os hooks em `mobile/src/features/transactions/hooks/`:
  - `useTransactions.ts` (por mês);
  - `useTransaction.ts`;
  - `useSaveTransaction.ts` e `useDeleteTransaction.ts`, que invalidam a lista e o painel;
  - `useMostUsedAccount.ts`: a conta mais frequente entre os últimos 50 lançamentos, ou a
    primeira conta ativa.
- [ ] T046 [US2] Criar `mobile/src/features/transactions/components/TransactionForm.tsx`, com
  React Hook Form, `zodResolver` e o schema de `@web/features/transactions/schemas`, o seletor
  despesa/receita, o `MoneyInput`, a conta, a categoria, a data e a descrição.
- [ ] T047 [US2] Criar `mobile/app/(app)/lancamento/novo.tsx` e
  `mobile/app/(app)/lancamento/[id].tsx`.
  - Na edição, a exclusão pede confirmação.
  - Transferências e parcelas aparecem só para leitura, com "Altere pelo site" e um link (FR-011).
  - Um usuário sem contas é orientado a criar uma pelo site.
- [ ] T048 [US2] Criar `mobile/src/features/transactions/components/TransactionList.tsx`,
  `TransactionRow.tsx` e `MonthSwitcher.tsx`, e a tela
  `mobile/app/(app)/(abas)/lancamentos.tsx`.
  - A tela aceita o filtro de categoria vindo do painel.
  - Tem os estados de carregamento, erro e vazio.
  - Tem um botão flutuante "Lançar", de 56 pt.

**Checkpoint (fim do D2)**: US1 e US2 funcionam no iPhone. Cronometrar o SC-002.

---

## Phase 5: User Story 3 - Lançar um gasto falando com a Siri (P1, marco D3)

**Goal**: o token pessoal, o endpoint de voz com prazo, a função intermediária da Vercel, a tela
da Siri no app e o atalho.

**Independent Test**: os quatro passos da história 3 na spec, e o quickstart, seção 4, "Voz",
passos 1 a 5, 7 e 8.

### Testes (escritos primeiro)

- [ ] T049 [P] [US3] Criar `backend/tests/integration/test_personal_tokens.py`:
  - `POST /api/v1/personal-tokens` devolve `token` no formato `ctp_<id>.<segredo>` uma única vez,
    e o `GET` nunca devolve o token;
  - o banco guarda só `secret_hash`, com 64 caracteres hexadecimais iguais ao SHA-256 do
    segredo, e o segredo não aparece em nenhuma coluna;
  - `name` aceita de 1 a 60 caracteres;
  - o sexto token ativo recebe 409 `personal_token_limit`, inclusive com dois pedidos
    simultâneos;
  - uma conta padrão de outro usuário ou arquivada recebe 422;
  - o `PATCH` troca a conta padrão;
  - o `DELETE` revoga com `user_revoked`, e a requisição seguinte com o token já falha;
  - a troca de senha revoga com `password_changed`, e a redefinição com `password_reset`;
  - a exclusão da conta apaga os tokens;
  - `needs_default_account` vale `true` com conta padrão nula ou arquivada;
  - um token pessoal no `Authorization` dos endpoints `/personal-tokens` recebe 401.
- [ ] T050 [P] [US3] Criar `backend/tests/isolation/test_personal_token_scope.py`, a varredura
  de rotas.
  - Percorre `app.routes`.
  - Toda rota cuja árvore de dependências inclui `get_current_user` recebe
    `Authorization: Bearer <ctp_ válido>` e precisa responder 401.
  - `PersonalTokenDep` aparece em exatamente uma rota, `POST /api/v1/voice/entries`.
  - Uma rota nova entra no teste sozinha.
- [ ] T051 [P] [US3] Criar `backend/tests/integration/test_voice_entries.py`, com a IA falsa
  programada.
  - **Lançamentos que gravam (201 `saved`)**:
    - despesa com conta citada;
    - frase sem conta, que vai para a conta padrão;
    - receita;
    - "ontem".

    Em todos, `source = voice` e `voice_phrase` é a frase.
  - **Frases que não gravam nada (422)**:
    - conta citada inexistente, mesmo com conta padrão (`repeat`);
    - "no cartão" com dois cartões (`repeat`);
    - sem conta e sem conta padrão, ou com a conta padrão arquivada (`repeat`);
    - sem valor ou com valor inválido (`repeat`);
    - data futura (`repeat`);
    - dois gastos, transferência, parcelado ou pergunta (`unsupported`).
  - **Cota de perguntas esgotada**: 429 `limit`, nada gravado.
  - **Limite de frases**: a 21ª frase na hora recebe 429.
  - **Prazo** (`X-Contai-Deadline`):
    - já vencido: 503 `deadline`, sem chamar a IA e sem registrar uso;
    - vencendo entre a IA e o commit: 503, com rollback;
    - sem o cabeçalho, o prazo é a chegada mais 6,5 s.
  - **Autenticação**: token ausente, malformado, inexistente ou revogado, ou de conta excluída,
    recebe 401 com corpo idêntico em todos os casos.
  - **Uso registrado**: cada frase registra uso `VOICE_ENTRY` no balde de perguntas.
  - **O que não vaza**:
    - a `speech` não contém saldo, nem e-mail, nem outros lançamentos;
    - com `caplog`, nenhum log contém a frase ou o token.
- [ ] T052 [P] [US3] Criar `backend/tests/unit/test_voice_speech.py`, com o valor por extenso
  ("45 reais", "45 reais e 90 centavos", "1 real", "90 centavos", "1 centavo", "1.234 reais") e
  cada mensagem da tabela de `contracts/siri-shortcut.md`.
- [ ] T053 [P] [US3] Criar `frontend/api/siri.test.ts` (Vitest, com `fetch` falso).
  - Uma resposta da API em tempo é repassada com status 200, `outcome` e `speech`, sem
    `transaction_id`.
  - Mais de 8 s responde 200 `waking` com a mensagem de "acordando".
  - Erro de rede responde `waking`.
  - Sem `phrase`, ou com corpo maior que 2 KB, responde `repeat`.
  - O cabeçalho `X-Contai-Deadline` é a chegada mais 6,5 s, e `x-contai-proxy-secret` é
    enviado.
- [ ] T054 [P] [US3] Registrar as rotas novas em `backend/tests/isolation/registry.py`:
  - `/personal-tokens` (GET, POST, PATCH e DELETE), com os casos de outro usuário: o `PATCH` e o
    `DELETE` do token de outro usuário recebem 404;
  - `POST /voice/entries`, com o token de outro usuário: nunca grava na conta de outra pessoa.
- [ ] T055 [P] [US3] Criar `mobile/src/features/voice/hooks/usePersonalTokens.test.tsx` e
  `mobile/src/features/voice/components/NewTokenResult.test.tsx`:
  - o token aparece uma vez, com o botão "Copiar";
  - ao sair da tela, a área de transferência é limpa se ainda contiver o token;
  - o link do atalho só aparece com `EXPO_PUBLIC_SHORTCUT_URL`;
  - revogar pede confirmação;
  - o aviso aparece quando `needs_default_account` é verdadeiro.

### Backend

- [ ] T056 [US3] Criar `backend/app/modules/auth/personal_tokens.py`:
  - `PersonalTokenRepository`, sempre com `user_id`;
  - `PersonalTokenService` com:
    - `create`, que trava a linha do usuário com `SELECT … FOR UPDATE` e aplica o limite de 5;
    - `list_active`, `set_default_account` e `revoke`;
    - `revoke_all(user_id, reason)`;
    - `authenticate(raw)`, que separa `ctp_<id>.<segredo>`, compara com
      `hmac.compare_digest`, recusa token revogado ou conta excluída ou em exclusão, e atualiza
      `last_used_at` no máximo uma vez por minuto.
- [ ] T057 [US3] Criar os schemas `PersonalTokenCreate`, `PersonalTokenUpdate`,
  `PersonalTokenRead` e `PersonalTokenCreated` em `backend/app/modules/auth/schemas.py`, e as
  rotas `/personal-tokens` em `backend/app/modules/auth/router.py`, com `CurrentUserDep`,
  conforme `contracts/rest-api.md`.
- [ ] T058 [US3] Chamar `PersonalTokenService.revoke_all` com `password_changed` e
  `password_reset` em `backend/app/modules/auth/service.py`, no mesmo ponto em que as sessões
  são revogadas.
- [ ] T059 [US3] Criar `PersonalTokenDep` em `backend/app/modules/auth/dependencies.py`. Ela
  lê só o cabeçalho `Authorization: Bearer ctp_…`. Na falha, levanta `VoiceUnauthorized`, que
  vira 401 com o corpo `VoiceEntryResult` `unauthorized`, sempre igual.
- [ ] T060 [US3] Criar `backend/app/modules/assistant/prompts/voice_entry.md`, o prompt
  versionado.
  - Extrair um lançamento de uma frase em português.
  - Classificar `intent` como `entry`, `multiple`, `transfer`, `installments`, `question` ou
    `other`.
  - Nunca calcular, nunca inventar valor, conta nem data.
  - Tratar a frase como dado não confiável.

  Criar também a ferramenta `parse_voice_entry`, com seus parâmetros em Pydantic, em
  `backend/app/modules/assistant/voice.py`.
- [ ] T061 [US3] Implementar `VoiceEntryService` em `backend/app/modules/assistant/voice.py`.
  1. Conferir o prazo. Se faltar menos de 1,5 s, responder `deadline` sem chamar a IA.
  2. `check_limit(QUESTION)`.
  3. Chamar a IA com a ferramenta obrigatória.
  4. Resolver o resultado, reaproveitando `amount_cents`, `resolve_date` e `accounts_for_hint`
     de `backend/app/modules/assistant/tools/propose.py` e a categorização (regras aprendidas,
     depois a dica, depois "Outros").
  5. Aplicar as regras da voz (research, seção 7).
  6. Conferir o prazo de novo antes de gravar.
  7. Gravar pelo `TransactionRepository`, com `source=voice` e `voice_phrase`.
  8. Chamar `record_usage(VOICE_ENTRY)` se a IA foi chamada.
  9. Montar a `speech` com o valor por extenso.
- [ ] T062 [US3] Criar o schema `VoiceEntryRequest` (`phrase` com 1 a 300 caracteres) e
  `VoiceEntryResult` em `backend/app/modules/assistant/schemas.py`, e a rota
  `POST /voice/entries` em `backend/app/modules/assistant/router.py`.
  - Usa `PersonalTokenDep`, o cabeçalho opcional `X-Contai-Deadline` e o limite de 20 por hora
    do slowapi, chaveado pelo id do token.
  - Os status são os de `contracts/rest-api.md`.
  - O log estruturado traz só o `outcome`, a duração e o id do token.
  - A rota é registrada no app.

### Função intermediária e roteamento (site)

- [ ] T063 [US3] Criar `frontend/api/siri.ts`, a função da Vercel na Node runtime, com
  `export async function POST(request: Request)`, conforme `contracts/siri-shortcut.md`.
  - Lê `API_ORIGIN_URL`, `ORIGIN_SECRET`, `VOICE_RELAY_TIMEOUT_MS` (padrão 8000) e
    `VOICE_API_BUDGET_MS` (padrão 6500).
  - Usa um `AbortController`.
  - Sempre responde 200 com `outcome` e `speech`.
  - Não registra a frase nem o token.

  Incluir `api` no `tsconfig.json` e no `eslint.config.js` do site.
- [ ] T064 [US3] Em `frontend/vercel.json`, trocar o `src` da primeira rota de `/api/(.*)` para
  `/api/((?!siri$).*)`, mantendo o `dest` e o `transforms`. Documentar
  `API_ORIGIN_URL`, `VOICE_RELAY_TIMEOUT_MS` e `VOICE_API_BUDGET_MS` no `.env.example` da raiz,
  na seção da Vercel.
- [ ] T065 [P] [US3] Escrever o ADR `docs/adr/0013-intermediario-da-siri-com-prazo.md`:
  - **Contexto**: o limite da Siri e o Render dormindo.
  - **Decisão**: a função da Vercel com prazo absoluto e a dupla conferência na API.
  - **Alternativas rejeitadas**: chamar a API direto, manter acordado (conta do Neon) e chave de
    idempotência.
  - **Consequências**: o risco residual na fronteira do prazo.

  Referências: research, seções 1 e 2.
- [ ] T066 **FORA DO CÓDIGO (M4)**: criar na Vercel a variável `API_ORIGIN_URL` com o valor
  `https://contai-api.onrender.com`, em Production.
- [ ] T067 **FORA DO CÓDIGO (M3)**: aprovar o merge na `main` com o CI local verde. Depois do
  deploy, conferir com `curl`:
  - `POST https://contai-project.vercel.app/api/siri` sem token responde 200 com
    `outcome: unauthorized`;
  - `GET https://contai-project.vercel.app/api/v1/health` continua respondendo 200, da API.

### App

- [ ] T068 [P] [US3] Criar `mobile/src/features/voice/types.ts` e
  `mobile/src/features/voice/services/personal-tokens.ts` (listar, criar, trocar a conta padrão
  e revogar), conforme `contracts/rest-api.md`.
- [ ] T069 [US3] Criar `mobile/src/features/voice/hooks/usePersonalTokens.ts`,
  `useCreatePersonalToken.ts`, `useUpdateDefaultAccount.ts` e `useRevokePersonalToken.ts`.
- [ ] T070 [US3] Criar `mobile/src/features/voice/components/ShortcutSteps.tsx`.
  - O passo a passo manual, numerado, com o texto exato de cada ação do atalho de
    `contracts/siri-shortcut.md`: a URL de produção, o cabeçalho `Authorization` com
    `Bearer ` e o campo `speech`.
  - Quando houver `EXPO_PUBLIC_SHORTCUT_URL`, o botão "Instalar o atalho" vem antes.
- [ ] T071 [US3] Criar `mobile/src/features/voice/components/NewTokenResult.tsx` (token uma vez,
  "Copiar" com `expo-clipboard` e limpeza ao sair) e as telas:
  - `mobile/app/(app)/siri/index.tsx`: tokens ativos com conta padrão, aviso
    `needs_default_account`, trocar a conta, revogar com confirmação e o aviso de que trocar a
    senha desconecta a Siri;
  - `mobile/app/(app)/siri/novo-token.tsx`: nome e conta padrão; no limite de 5, pede para
    revogar um.
- [ ] T072 **FORA DO CÓDIGO (M5)**: com o deploy no ar, montar o atalho "Contaí" à mão, seguindo
  a tela `ShortcutSteps`.
  - Falar com a Siri e medir o tempo até a resposta, com o servidor acordado e com o servidor
    dormindo.
  - Se a Siri desistir antes de 8 s, ou tolerar mais, ajustar `VOICE_RELAY_TIMEOUT_MS` e
    `VOICE_API_BUDGET_MS` na Vercel.
  - Anotar o resultado em `specs/002-app-mobile-siri/research.md`, seção 1.
- [ ] T073 **FORA DO CÓDIGO (M6)**: no mesmo atalho, trocar o token por uma pergunta de
  importação ("Cole o token que o app do Contaí mostrou").
  - Conferir que nenhuma ação guarda um token (FR-017a).
  - Compartilhar pelo iCloud e pôr o link em `EXPO_PUBLIC_SHORTCUT_URL`, no `mobile/.env`.
  - Instalar pelo link num atalho novo e confirmar que funciona.

**Checkpoint (fim do D3)**: "E aí Siri, Contaí" lança em produção, e frases ambíguas não gravam
nada.

---

## Phase 6: User Story 4 - Ver e desfazer o que a Siri lançou (P1, marco D4)

**Goal**: o bloco "Lançados por voz", a marca "por voz", "Você disse: …" e desfazer com Refazer
por 10 s, no app e no site.

**Independent Test**: os quatro passos da história 4 na spec, e o quickstart, seção 4, "Voz",
passo 6.

### Testes (escritos primeiro)

- [ ] T074 [P] [US4] Criar `backend/tests/integration/test_voice_undo_restore.py`.
  - **Desfazer** (`undo-voice`):
    - num lançamento por voz, apaga e devolve `restore_token` e `expires_in: 10`;
    - num lançamento que não é por voz, responde 409 `not_voice_entry`;
    - num lançamento já desfeito, responde 404 `transaction_not_found`.
  - **Refazer** (`restore`):
    - recria a linha idêntica: mesmo id, `source`, `voice_phrase`, `created_at`, conta,
      categoria, valor e data;
    - no segundo pedido, responde 200 sem duplicar;
    - depois de 15 s (relógio congelado), responde 410 `restore_expired`;
    - com o token de outro usuário ou adulterado, recusa;
    - com a conta apagada, responde 409 `restore_conflict`.
  - **Separação dos tokens**: um token com `aud = voice-restore` é recusado como access token
    por `get_current_user`.
- [ ] T075 [P] [US4] Acrescentar ao `backend/tests/integration/test_transactions.py` o filtro
  `source=voice` e os campos `source` e `voice_phrase` no `TransactionRead`.
  - Editar um lançamento por voz mantém a origem e a frase.
  - Os schemas de criação e edição recusam `source` e `voice_phrase`.

  Acrescentar ao `backend/tests/integration/test_export.py` a frase e os tokens pessoais na
  exportação, sem hash.
- [ ] T076 [P] [US4] Registrar `POST /transactions/{id}/undo-voice` e
  `POST /transactions/restore` em `backend/tests/isolation/registry.py`. Desfazer o lançamento
  de outro usuário responde 404, e restaurar com o token de outro usuário é recusado.
- [ ] T077 [P] [US4] Criar
  `frontend/src/features/transactions/components/VoiceHighlights.test.tsx` e
  `frontend/src/features/transactions/hooks/useUndoVoice.test.ts`.
  - O bloco mostra os lançamentos dos últimos 7 dias, com "Você disse: …".
  - "Desfazer" não pede confirmação e mostra "Refazer" por 10 s, que restaura.
  - Desfazer de novo mostra "Esse lançamento já tinha sido desfeito."
- [ ] T078 [P] [US4] Criar `mobile/src/features/transactions/hooks/useUndoVoice.test.tsx` e
  `mobile/src/features/transactions/components/VoiceHighlights.test.tsx`, com os mesmos casos e
  mais o rótulo acessível: "Lançado por voz, 45 reais, iFood. Desfazer".

### Backend

- [ ] T079 [US4] Em `backend/app/core/security.py`:
  - criar `create_restore_token(user_id, row)` e `decode_restore_token(token)`, um JWT HS256 com
    `aud = "voice-restore"`, validade de 15 s e a linha inteira em `txn`;
  - garantir que a decodificação do access token exige o público dele e recusa
    `voice-restore`.
- [ ] T080 [US4] Em `backend/app/modules/transactions/` (`schemas.py`, `repository.py`,
  `service.py` e `router.py`):
  - o filtro `source` em `GET /transactions`;
  - `source` e `voice_phrase` no `TransactionRead`;
  - `POST /transactions/{id}/undo-voice`, que apaga numa transação de banco e devolve o
    `restore_token`;
  - `POST /transactions/restore`, que reinsere com o mesmo id, é idempotente e trata os
    conflitos 409 e 410;
  - os erros de domínio `NotVoiceEntry`, `RestoreExpired` e `RestoreConflict`.
- [ ] T081 [US4] Em `backend/app/modules/users/export.py`, incluir `source` e `voice_phrase`
  em cada lançamento e a lista de tokens pessoais (nome, conta padrão e datas, nunca o hash).

### Site

- [ ] T082 [P] [US4] Em `frontend/src/features/transactions/types.ts`, acrescentar
  `TransactionSource` com `"voice"`, `source` e `voicePhrase`, no mesmo formato de nomes que o
  arquivo já usa. O app recebe a mudança pelo `@web`.
- [ ] T083 [US4] Em `frontend/src/features/transactions/services/` e `hooks/`, criar
  `undoVoice`, `restoreTransaction`, `useUndoVoice` (com o Refazer de 10 s) e
  `useVoiceHighlights` (`source=voice&from=<hoje − 6 dias>`, com hoje em America/Sao_Paulo pelo
  `lib/dates`).
- [ ] T084 [US4] Criar `frontend/src/features/transactions/components/VoiceHighlights.tsx`,
  `VoiceBadge.tsx` e `UndoToast.tsx`.
  - Pôr o bloco no topo do painel (`frontend/src/features/dashboard/components/`).
  - Pôr a marca "por voz" e "Você disse: …" na lista e no detalhe, com o botão "Desfazer".
- [ ] T085 [US4] Atualizar `frontend/src/features/auth/components/PrivacyPolicyPage.tsx`:
  - no lançamento por voz, a frase é reconhecida pela Siri (Apple) e depois enviada ao serviço
    de IA;
  - a frase entendida fica guardada junto com o lançamento, entra na exportação e é apagada com
    ele ou com a conta.

  Atualizar o teste da página.

### App

- [ ] T086 [US4] Criar `mobile/src/features/transactions/services/voice.ts` (`undoVoice` e
  `restoreTransaction`) e os hooks `useUndoVoice.ts` e `useVoiceHighlights.ts`, em
  `mobile/src/features/transactions/hooks/`.
- [ ] T087 [US4] Criar `mobile/src/features/transactions/components/VoiceHighlights.tsx` e
  `VoiceBadge.tsx`, e usar o `Toast` com a ação "Refazer" por 10 s, anunciada ao VoiceOver.
  Pôr a marca "por voz", "Você disse: …" e "Desfazer" no `TransactionRow.tsx` e em
  `mobile/app/(app)/lancamento/[id].tsx`.
- [ ] T088 **FORA DO CÓDIGO (M8)**: revisar o texto novo da política de privacidade (T085) antes
  do deploy.
- [ ] T089 **FORA DO CÓDIGO (M3)**: aprovar o merge na `main` com o CI local verde, para publicar
  o desfazer e o destaque. Conferir o passo 6 do quickstart no app e no site.

---

## Phase 7: User Story 5 - Entender o mês pelo painel do celular (P1, marco D4)

**Goal**: entradas, saídas e saldo, gastos por categoria e saldo das contas, iguais aos do site,
com o bloco de voz no topo.

**Independent Test**: comparar o painel do app com o do site em dois meses (SC-008 pede três).

### Testes (escritos primeiro)

- [ ] T090 [P] [US5] Criar `mobile/src/features/dashboard/components/CategoryBars.test.tsx` e
  `mobile/src/features/dashboard/hooks/useDashboard.test.tsx`.
  - As barras vêm ordenadas, com largura proporcional.
  - Cada barra tem o rótulo "Alimentação, 842 reais e 30 centavos, 34% das saídas".
  - Tocar numa categoria leva aos lançamentos dela.
  - Trocar o mês refaz a consulta.
  - Sem dados, aparecem os primeiros passos.
  - Ao voltar ao app, a consulta é feita de novo.

### Implementação

- [ ] T091 [P] [US5] Criar `mobile/src/features/dashboard/services/dashboard.ts` e
  `mobile/src/features/dashboard/hooks/useDashboard.ts`, com os endpoints do painel que já
  existem e os tipos de `@web/features/dashboard/types`. Usam o
  `use-refetch-on-focus.ts` (SC-004).
- [ ] T092 [US5] Criar `mobile/src/features/dashboard/components/MonthSummary.tsx` (entradas,
  saídas e saldo), `CategoryBars.tsx` (barras com `View`, sem biblioteca), `AccountBalances.tsx`
  e `FirstSteps.tsx`.
- [ ] T093 [US5] Criar `mobile/app/(app)/(abas)/index.tsx`, o painel. Na ordem: o
  `VoiceHighlights` no topo, o `MonthSwitcher`, o resumo, as categorias e as contas, com puxar
  para atualizar. Tocar numa categoria abre `lancamentos` com o filtro.

**Checkpoint (fim do D4)**: o caminho entrar → lançar → Siri → desfazer → painel está inteiro no
iPhone.

---

## Phase 8: User Story 6 - Conversar com o assistente pelo celular (P1, marco D5; sai no corte 2)

**Goal**: perguntas, lançamento por texto com confirmação, e histórico compartilhado com o site.

**Independent Test**: os três passos da história 6 na spec.

- [ ] T094 [P] [US6] Criar `mobile/src/features/assistant/hooks/useConversation.test.tsx` e
  `mobile/src/features/assistant/components/ProposalCard.test.tsx`.
  - Enviar uma pergunta mostra "Preparando a resposta…" e depois a resposta.
  - A proposta tem "Salvar" (só com os campos completos), "Ajustar" (abre o formulário
    preenchido) e "Descartar".
  - O limite diário mostra a mensagem do site com o horário em que volta.
  - Apagar uma conversa pede confirmação.
- [ ] T095 [P] [US6] Criar `mobile/src/features/assistant/services/assistant.ts`, com
  conversas, mensagens, proposta salva e descartada, e uso, e
  `mobile/src/features/assistant/types.ts`, a partir de `@web/features/assistant/types`.
- [ ] T096 [US6] Criar `mobile/src/features/assistant/hooks/useConversations.ts`,
  `useConversation.ts`, `useAsk.ts` e `useProposalActions.ts`. Salvar invalida a lista e o
  painel.
- [ ] T097 [US6] Criar `mobile/src/features/assistant/components/MessageBubble.tsx`,
  `ProposalCard.tsx` e `Composer.tsx`, e as telas `mobile/app/(app)/(abas)/assistente.tsx`
  (histórico e nova conversa) e `mobile/app/(app)/assistente/[id].tsx` (a conversa).
  - "Ajustar" abre `lancamento/novo` preenchido.
  - O resultado volta para marcar a proposta como salva.

---

## Phase 9: User Story 7 - Fotografar um comprovante (P1, marco D6; sai no corte 1)

**Goal**: a câmera ou a galeria, o aviso de IA no primeiro envio, e a proposta para confirmar.

**Independent Test**: os quatro passos da história 7 na spec.

- [ ] T098 [P] [US7] Criar `mobile/src/features/receipts/hooks/useReceiptUpload.test.tsx`.
  - Sem o aceite (`GET /api/v1/users/me/consents/ai-documents`), o aviso aparece antes do envio,
    e recusar não envia.
  - A foto é reduzida (`expo-image-manipulator`: 2000 px no lado maior, JPEG com qualidade 0,7)
    antes do envio.
  - O andamento é acompanhado até a proposta.
  - Uma foto ilegível mostra a orientação, e nada é salvo.
  - A câmera negada mostra como liberar e oferece a galeria.
- [ ] T099 [US7] Criar `mobile/src/features/receipts/services/receipts.ts`: o aceite, o envio
  pelo mesmo endpoint de importação de comprovante do site (ver
  `frontend/src/features/imports/services/`) e a consulta do andamento.
- [ ] T100 [US7] Criar `mobile/src/features/receipts/hooks/useReceiptUpload.ts` e
  `mobile/src/features/receipts/lib/resize.ts`.
- [ ] T101 [US7] Criar `mobile/src/features/receipts/components/AiConsentSheet.tsx` e
  `ReceiptProgress.tsx`, e a tela `mobile/app/(app)/comprovante.tsx`.
  - "Tirar foto" e "Escolher da galeria" usam o `expo-image-picker`.
  - A proposta abre `lancamento/novo` preenchido para confirmar ou ajustar.
  - O acesso fica num botão "Fotografar comprovante" na tela de lançamento.

---

## Pontos de corte

- [ ] T130 **CORTE 1, 23/11 à noite**:
  1. Rodar no iPhone, em produção, o caminho entrar → lançar → Siri → desfazer → painel (US1 a
     US5).
  2. Se não estiver inteiro, **cortar a US7**: não fazer T098 a T101 e não mostrar o botão
     "Fotografar comprovante".
  3. O D6 vira conserto do caminho e acabamento.
  4. Registrar a decisão em `specs/002-app-mobile-siri/plan.md`, em Ordem de entrega e corte.
- [ ] T131 **CORTE 2, 24/11 ao meio-dia**:
  1. Se ainda faltar acabamento (T140 a T146), **cortar a US6**: tirar a aba "Assistente" de
     `mobile/app/(app)/(abas)/_layout.tsx` e as rotas `mobile/app/(app)/assistente/`.
  2. Registrar a decisão em `specs/002-app-mobile-siri/plan.md`.

> Os IDs T102 a T129, T132 a T139, T148, T149 e T154 a T159 ficam reservados para tarefas que aparecerem durante os
> marcos D4 a D6, sem renumerar o resto.

---

## Phase 10: Polish & entrega (marcos D6 e D7)

- [ ] T140 [P] Revisar o VoiceOver em todas as telas P1 de `mobile/app/`.
  - A ordem de leitura, os rótulos e os papéis estão certos.
  - Os anúncios do Toast funcionam.
  - Corrigir o que faltar nos componentes de `mobile/src/components/ui/`.
- [ ] T141 [P] Revisar o Dynamic Type no maior tamanho em todas as telas P1.
  - Nenhum valor truncado e nenhuma ação escondida, com `flexWrap` e `ScrollView` onde
    faltar.
  - Os temas claro e escuro mudam na hora.
- [ ] T142 [P] Criar `specs/002-app-mobile-siri/validation/frases-voz.md`, com 20 frases claras
  e 20 ambíguas e o resultado esperado de cada uma (valor, tipo, conta e data, ou `outcome`).
  - As ambíguas cobrem: sem valor, conta inexistente, dois cartões, dois gastos, transferência,
    parcelado, pergunta, data futura e instrução embutida.
- [ ] T143 [P] Atualizar `README.md` com uma seção sobre o app mobile e a Siri: como rodar no
  Expo Go, as variáveis, a arquitetura da voz (com o link para o ADR 0013) e capturas de tela.
- [ ] T144 Rodar `bash infra/ci-local.sh` (backend, frontend e mobile) e corrigir até ficar
  verde, inclusive a formatação e a auditoria.
- [ ] T145 **FORA DO CÓDIGO (M3)**: aprovar o merge final da P1 na `main`, com o CI local verde.
- [ ] T146 **FORA DO CÓDIGO (M7)**: rodar o roteiro completo do quickstart no iPhone, em
  produção.
  1. Antes das 40 frases, subir temporariamente `AI_DAILY_QUESTION_LIMIT` no Render (por
     exemplo, para 80).
  2. Rodar as frases de `validation/frases-voz.md` e anotar o resultado de cada uma (SC-005 e
     SC-006).
  3. **No fim, voltar `AI_DAILY_QUESTION_LIMIT` para 30.** A cota do próprio Gemini continua
     valendo.
  4. Fazer o roteiro de VoiceOver e fonte grande (SC-013).
  5. Comparar o painel com o site em três meses (SC-008).
  6. Cronometrar o SC-002, o SC-003 e o SC-012.
- [ ] T147 Registrar os resultados da T146 em
  `specs/002-app-mobile-siri/validation/resultado-roteiro.md` e abrir uma tarefa de correção
  para cada falha.
- [ ] T150 **FORA DO CÓDIGO (M1)**, 25/11: conferir no Expo Go que o SDK continua 58.
- [ ] T151 **FORA DO CÓDIGO (M9)**, 25/11:
  - Acordar o servidor alguns minutos antes da apresentação, abrindo o app.
  - Ou criar no cron-job.org um job temporário que chama
    `https://contai-project.vercel.app/api/v1/health` a cada 10 min, só durante a janela da
    apresentação, e apagá-lo depois.
- [ ] T152 **FORA DO CÓDIGO**, 25/11: conferir que o token da demonstração está ativo e que "E
  aí Siri, Contaí" responde.
- [ ] T153 **FORA DO CÓDIGO (M10)**, depois da entrega: se a T008 tiver gerado um desvio
  (cópias em `mobile/src/shared/`), decidir quando voltar ao `@web` e atualizar o
  Complexity Tracking do plano.

---

## Phases P2 (só depois de toda a P1 verde no roteiro do iPhone, T146)

### Phase 11: User Story 8 - Cartões de crédito no celular (P2)

**Independent Test**: os passos da história 8 na spec.

- [ ] T160 [P] [US8] Criar `mobile/src/features/cards/hooks/useCards.test.tsx` (fatura atual,
  fechamento, vencimento, limite disponível e parcelas futuras iguais às do site; pagamento
  registrado como transferência).
- [ ] T161 [US8] Criar `mobile/src/features/cards/services/cards.ts`, os hooks
  `useCards.ts` e `usePayInvoice.ts` (endpoints que já existem e tipos de
  `@web/features/cards/types`) e as telas `mobile/app/(app)/cartoes/index.tsx` e
  `mobile/app/(app)/cartoes/[id].tsx`. O pagamento da fatura pede a conta de origem e
  confirmação.

### Phase 12: User Story 9 - Lembrete de vencimento da fatura (P2)

- [ ] T162 [P] [US9] Criar `mobile/src/features/cards/lib/reminders.test.ts`:
  - agenda às 9h, 3 dias antes do vencimento;
  - o texto não tem valor;
  - os identificadores são `invoice-reminder:<card_id>:<due_date>`;
  - o reagendamento acontece quando as faturas mudam;
  - tudo é cancelado ao sair da conta.
- [ ] T163 [US9] Instalar `expo-notifications` com `npx expo install`.
  - Implementar `mobile/src/features/cards/lib/reminders.ts`, só com notificações locais.
  - Pôr a opção em `mais.tsx`, com o pedido de permissão e o caminho dos ajustes se for negada.
  - Gravar a preferência em `contai.prefs` no `expo-secure-store`.
  - Chamar o cancelamento no `useLogout`.

### Phase 13: User Story 10 - Proteger a abertura do app (P2)

- [ ] T164 [P] [US10] Criar `mobile/src/features/auth/lib/app-lock.test.ts`:
  - pede o desbloqueio ao abrir e depois de mais de 5 min em segundo plano;
  - a falha da biometria leva à senha do aparelho;
  - cancelar esconde os dados;
  - um aparelho sem biometria nem senha mostra o aviso.
- [ ] T165 [US10] Instalar `expo-local-authentication`. Implementar
  `mobile/src/features/auth/lib/app-lock.ts` e `mobile/src/features/auth/components/LockScreen.tsx`,
  integrados em `mobile/app/_layout.tsx`, com a opção em `mais.tsx`.

### Phase 14: User Story 11 - Importar extrato pelo celular (P2)

- [ ] T166 [P] [US11] Criar `mobile/src/features/imports/hooks/useImportFile.test.tsx`:
  - aceita OFX, CSV e PDF;
  - recusa outro tipo e arquivo acima do limite;
  - mostra o aviso de IA para PDF;
  - a revisão marca as duplicatas.
- [ ] T167 [US11] Instalar `expo-document-picker`. Criar
  `mobile/src/features/imports/services/imports.ts`, os hooks e as telas
  `mobile/app/(app)/importar/index.tsx` e `mobile/app/(app)/importar/[id].tsx`, com a mesma
  revisão do site.

### Phase 15: User Story 12 - Gerenciar tokens pessoais pelo site (P2)

- [ ] T168 [P] [US12] Criar `frontend/src/features/settings/components/PersonalTokens.test.tsx`:
  - a lista sem o token;
  - criar mostra o token uma vez;
  - revogar pede confirmação e vale na hora.
- [ ] T169 [US12] Criar `frontend/src/features/settings/services/personal-tokens.ts`, os hooks
  e `frontend/src/features/settings/components/PersonalTokens.tsx`, na tela de configurações do
  site.

### User Story 13 (P3)

Fica para depois da entrega. O atalho para o site (T039) atende até lá.

---

## Dependencies & Execution Order

### Entre fases

- **Setup (T001–T011)**: começa agora. A T008, prova do `@web`, decide o caminho do código
  compartilhado para todas as telas.
- **Foundational (T012–T025)**: depende do Setup e bloqueia todas as histórias. A migração T012
  serve à US1, à US3 e à US4.
- **US1 → US2 → US3 → US4 → US5 → US6 → US7**: a ordem de construção e de corte.
  - A US2 usa a sessão da US1.
  - A US3 (app) usa a lista de contas da US2.
  - A US4 depende da US3, porque precisa de lançamentos por voz.
  - A US5 mostra o bloco da US4.
  - A US6 e a US7 dependem só da Foundational e da US2. Por isso podem ser cortadas sem
    quebrar nada.
- **P2 (US8–US12)**: só depois da T146 verde.

### Deploys (M3) e tarefas fora do código

| Tarefa | Depende de | Destrava |
|--------|------------|----------|
| T040 (M3) | T026–T033 | Teste da US1 no iPhone contra a produção |
| T066 (M4) | — | T067 |
| T067 (M3) | T049–T065 e T066 | T072 (M5) |
| T072 (M5) | T067 e T070 | T073 (M6) e o ajuste do tempo de espera |
| T073 (M6) | T072 | O link do atalho no app (`EXPO_PUBLIC_SHORTCUT_URL`) |
| T089 (M3) | T074–T088 | Passo 6 do quickstart em produção |
| T146 (M7) | T144 e T145 | T147, corte final e P2 |

### Dentro de cada história

1. Os testes, que devem falhar primeiro.
2. Os modelos e as migrações.
3. Os serviços.
4. As rotas.
5. Os serviços e hooks do app ou do site.
6. Os componentes.
7. As telas.

## Parallel Example: User Story 3

```text
# Testes, juntos e em arquivos diferentes:
T049 test_personal_tokens.py   T050 test_personal_token_scope.py
T051 test_voice_entries.py     T052 test_voice_speech.py
T053 frontend/api/siri.test.ts T054 registry.py
T055 mobile/.../NewTokenResult.test.tsx

# Enquanto o backend (T056–T062) avança:
T063–T065 função da Vercel, vercel.json e ADR 0013
T068 tipos e serviço de tokens no app
```

## Parallel Example: User Story 4

```text
T074 test_voice_undo_restore.py   T077 frontend VoiceHighlights.test.tsx
T075 test_transactions/test_export T078 mobile VoiceHighlights.test.tsx
T082 frontend types.ts (destrava o site e o app ao mesmo tempo)
```

## Implementation Strategy

### MVP para a apresentação

O MVP é US1 + US2 + US3 + US4 + US5, até o fim do D4. Esse é o caminho que o avaliador vê:
entrar → lançar → falar com a Siri → ver e desfazer → painel. A US6 e a US7 são acréscimos que
os cortes T130 e T131 podem retirar sem deixar nada quebrado.

### Entrega incremental

1. **D1**: Setup e Foundational. O app abre no Expo Go, e o backend do login do app está
   testado.
2. **D2**: US1 e US2 no iPhone contra a produção (T040).
3. **D3**: US3. A Siri lança em produção (T067, T072 e T073).
4. **D4**: US4 e US5 no app e no site (T089). O MVP está completo.
5. **D5**: US6, e às 23/11 à noite o corte 1 (T130).
6. **D6**: US7 (se não cortada), o corte 2 ao meio-dia (T131), o acabamento e o roteiro (T146).
7. **D7**: verificações do dia (T150–T152) e a apresentação.
8. **Depois**: P2 na ordem US8 → US12, e a M10 (T153).

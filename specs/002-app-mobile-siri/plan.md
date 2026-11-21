# Implementation Plan: App mobile do Contaí e lançamento por voz pela Siri

**Branch**: `001-contai-mvp` (feature 002, numa branch única) | **Date**: 2026-11-18 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-app-mobile-siri/spec.md`

## Summary

**O que entra**

- **App**: um app em React Native com Expo, em `mobile/`, que roda no Expo Go num iPhone e usa a
  mesma API de produção pelo proxy da Vercel.
- **Voz**: o lançamento de gastos pela Siri, com um atalho do app Atalhos e um token pessoal que
  só serve para lançar.

**Como**

- **Backend** (ADR 0012): login e renovação próprios do app, com `sessions.client`; tokens
  pessoais com hash; o endpoint `POST /api/v1/voice/entries`; a origem `voice` com a frase
  guardada; desfazer com um token de restauração assinado, que permite refazer por 10 segundos.
- **Servidor dormindo** (o ponto mais arriscado): a Siri chama uma função da Vercel
  (`/api/siri`).
  - A função espera no máximo 8 segundos e, se a API não responder, diz que o Contaí está
    acordando.
  - A API recebe um prazo absoluto e descarta, sem gravar, qualquer frase que chegue depois
    dele. Por isso repetir a frase nunca lança em dobro.
  - Manter o servidor acordado foi descartado: o worker embutido manteria o Neon acordado, com
    cerca de 182 CU-h por mês, contra as 100 do plano gratuito.
- **Código do site**: o app importa direto de `frontend/src` (dinheiro, datas, tipos e schemas),
  por um apelido, sem mudar o site. A prova tem limite de meio dia.

As decisões e as fontes estão em [research.md](research.md).

## Technical Context

**Language/Version**:

- App: TypeScript (strict), com o Expo SDK 58. O Expo Go 58.0.5 do iPhone do mantenedor, da
  App Store, abre o SDK 58.0.0 (M1, conferido em 2026-11-18). As atualizações automáticas da App
  Store ficam desligadas até a entrega (research, seção 3).
- Backend: Python 3.12.
- Função da Vercel: TypeScript, na Node runtime.

**Primary Dependencies**:

- **App, base**: Expo Router, TanStack Query, React Hook Form, Zod e `@hookform/resolvers`.
- **App, módulos do Expo**: `expo-secure-store`, `expo-image-picker`, `expo-image-manipulator`,
  `expo-clipboard`, `expo-font` e `expo-linking`.
- **App, fontes**: `@expo-google-fonts/besley` e `@expo-google-fonts/atkinson-hyperlegible-next`.
- **App, P2**: `expo-local-authentication`, `expo-notifications` (só lembretes locais) e
  `expo-document-picker`.
- **App, além do previsto** (registrado em 2026-11-18, na T003):
  - `react-dom`, na versão do SDK, porque o Expo Router o exige para resolver as dependências;
  - `@types/node` explícito, porque os tipos do Expo para `process.env` dependem dele e o
    TypeScript 6 não o carrega mais sozinho;
  - `overrides` no `mobile/package.json` só para as faixas vulneráveis do `glob`
    (`>=9.0.0 <14.0.2`) e do `minimatch` (`>=7.0.0 <11.0.1`), vindas da cadeia do Jest e do
    `@expo/fingerprint`. A auditoria fica em zero, e o `minimatch` 3 do ESLint não muda;
  - `expo-asset`, na versão do SDK, porque o `expo-font` o exige para carregar as fontes
    (registrado na T017);
  - `expo-symbols`, na versão do SDK, para os ícones das abas com os SF Symbols do iOS. Vem no
    Expo Go e evita uma biblioteca de ícones (registrado na T038).
- **Backend**: nenhuma dependência nova. Usa FastAPI, SQLAlchemy, Alembic, PyJWT e slowapi, que
  já estão no projeto.

**Storage**: PostgreSQL (Neon). Uma migração cria `personal_tokens`, `sessions.client`,
`transactions.voice_phrase` e o valor `voice` em `source`. No aparelho, só o Keychain, pelo
`expo-secure-store` ([data-model.md](data-model.md)).

**Testing**:

- App: `jest-expo` e React Native Testing Library.
- Backend: pytest com PostgreSQL real e IA falsa.
- Função da Vercel: Vitest.
- iPhone: roteiro manual em [quickstart.md](quickstart.md).

**Target Platform**: iPhone com Expo Go e iOS atual. O Android não é alvo da entrega. A API roda
no Render, o site e a função na Vercel.

**Project Type**: app mobile, ligado à API web que já existe, com mudanças pequenas no site.

**Performance Goals**:

- lançar pelo app em menos de 10 s (SC-002);
- confirmação da Siri em até 8 s com o servidor acordado (SC-003);
- o lançamento por voz no painel em até 5 s (SC-004).

**Constraints**:

- Só bibliotecas que vêm no Expo Go, sem build nativa e sem conta paga da Apple.
- A Siri tem cerca de 10 a 15 s para responder, um valor não documentado que a tarefa M5 mede.
- O Render leva cerca de 1 minuto para acordar.
- O Neon tem 100 CU-h por mês.
- O Gemini gratuito tem 30 perguntas por usuário por dia.
- A entrega é em 2026-11-25.

**Scale/Scope**: dezenas de usuários. As telas P1 são cerca de 12 (entrada, duas etapas,
painel, lista, lançamento, detalhe, Siri e tokens, assistente, conversa, comprovante e Mais).
São 7 histórias P1 e 5 P2.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Verificação | Situação |
|-----------|-------------|----------|
| I. Qualidade do backend | mypy strict e ruff. Schemas `Create`/`Read` separados para tokens e voz. As rotas só chamam serviços. Erros de domínio próprios: limite de tokens, não é voz, restauração expirada. | OK |
| II. Qualidade do frontend e do app | TS strict, sem `any`. Componentes funcionais. `types.ts` por feature. ESLint e Prettier no app e na função. | OK |
| III. Arquitetura do backend | Sem domínio novo: tokens no módulo `auth`, voz no `assistant`, desfazer no `transactions`. O repositório de tokens recebe `user_id`, e as configurações vêm de variáveis de ambiente. | OK |
| IV. Arquitetura do frontend | Site: o bloco de voz e o desfazer ficam em `features/transactions` e `features/dashboard`. App: services → hooks → components, com um guard único (Princípio XIV). | OK |
| V. Segurança | O login do site não muda. O refresh é separado por tipo de cliente. O token tem hash e escopo único. A varredura de rotas e os testes de isolamento ganham o token de outro usuário. O CORS não muda. Frase e token ficam fora dos logs. | OK |
| VI. IA | O valor da voz é extraído pela IA, mas convertido e validado pelo backend. A resposta falada é montada pelo backend. O prompt é versionado. A cota é registrada como `VOICE_ENTRY`. A exceção à confirmação está prevista no Princípio XV. | OK |
| VII. Privacidade | A política de privacidade ganha o trecho da Siri e da frase guardada (tarefa de P1). A exportação inclui a frase e os tokens. A exclusão da conta apaga tudo em cascata. | OK |
| VIII. Dinheiro | Centavos inteiros. A conversão usa `parse_brl`/`amount_cents`, sem `float`. Datas no fuso de Brasília. O desfazer roda numa transação. | OK |
| IX. Design e UX | `design-system.md` adaptado. VoiceOver, Dynamic Type e toque de 44 pt. Estados de carregamento, erro e vazio. Desfazer da voz sem confirmação, que é exceção prevista. | OK |
| X. Testes | O app tem jest-expo e RNTL com os testes obrigatórios. O backend tem os testes do token, a varredura, o prazo e a restauração. A IA é falsa nos testes. | OK |
| XI. Observabilidade | Logs JSON da voz com o `outcome`, a duração e o id do token, sem frase. O health check não muda. | OK |
| XII. Deploy | Migração aplicada no deploy. O app e o atalho passam pela mesma origem e pelo mesmo proxy, e a função da Vercel envia o segredo de origem. O CI local ganha a etapa do app. O app não vai para as lojas. | OK. O desvio do CI em GitHub Actions já está registrado. |
| XIII. Documentação | README com uma seção do app e da Siri. ADR 0013 para a função intermediária com prazo. OpenAPI automático. | OK, com tarefas |
| XIV. App mobile | Expo Go e SDK da loja. Expo Router em `mobile/app`. Fonte única pelo apelido `@web`, com meio dia de limite e desvio registrado se estourar. Sessão no Keychain e login separado. | OK |
| XV. Voz | Token com hash, exibido uma vez e revogável, com limites. Só no `Authorization`. Uma frase gera no máximo um lançamento, e nunca cria conta. A resposta é curta e genérica nas falhas de token. | OK |

**Reavaliação depois do desenho (Phase 1)**: nenhuma violação.

A função da Vercel é um componente novo em produção. Ela não fere o Princípio XII, porque fica
na mesma origem, passa pelo mesmo segredo e não guarda nada. Mesmo assim, é uma decisão de
arquitetura relevante, e o ADR 0013 a registra (Princípio XIII).

As constantes de design copiadas do `design-system.md` para o app não estão na regra de fonte
única, que cobre tipos, dinheiro, datas e schemas (research, seção 11).

## Project Structure

### Documentation (this feature)

```text
specs/002-app-mobile-siri/
├── plan.md              # este arquivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1, roteiro de validação
├── contracts/
│   ├── rest-api.md      # endpoints novos e alterados
│   └── siri-shortcut.md # atalho, função intermediária e mensagens faladas
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
backend/app/
├── core/security.py                 # desafio com client; token de restauração (aud voice-restore)
├── ai/models.py, ai/usage.py        # AiTask.VOICE_ENTRY no balde QUESTION
├── modules/auth/
│   ├── models.py                    # Session.client; PersonalToken
│   ├── repository.py, service.py    # login e refresh do app; revogar tokens na troca de senha
│   ├── personal_tokens.py           # serviço e repositório dos tokens
│   ├── dependencies.py              # PersonalTokenDep
│   └── router.py                    # /auth/mobile/*, /personal-tokens
├── modules/assistant/
│   ├── voice.py                     # interpretar, resolver, prazo, montar a fala
│   ├── prompts/voice_entry.md
│   └── router.py                    # POST /voice/entries
├── modules/transactions/            # source=voice, voice_phrase, filtro, undo-voice, restore
├── modules/users/export.py          # frase e tokens na exportação
└── alembic/versions/<nova>.py
backend/tests/                       # tokens, varredura de rotas, voz, restauração, login do app

frontend/
├── api/siri.ts                      # função da Vercel (POST /api/siri)
├── vercel.json                      # rota /api/((?!siri$).*)
└── src/features/
    ├── dashboard/                   # bloco "Lançados por voz"
    ├── transactions/                # marca "por voz", "Você disse", desfazer e refazer
    ├── settings/                    # sessões com o tipo de cliente; tokens (P2)
    └── legal/ (ou equivalente)      # política de privacidade: Siri e frase

mobile/
├── app/                             # Expo Router: só composição de tela
│   ├── _layout.tsx                  # fontes, tema, QueryClient, provedor de sessão
│   ├── (auth)/entrar.tsx, duas-etapas.tsx
│   └── (app)/_layout.tsx            # guard único + abas
│       ├── (abas)/index.tsx         # painel
│       ├── (abas)/lancamentos.tsx, assistente.tsx, mais.tsx
│       ├── lancamento/novo.tsx, [id].tsx
│       ├── siri/index.tsx, novo-token.tsx
│       └── comprovante.tsx
├── src/
│   ├── lib/                         # api-client, sessão (secure-store), config, acordando
│   ├── theme/                       # tokens do design-system, fontes, useTheme
│   ├── components/ui/               # Button, Field, MoneyText, Bar, Toast (Desfazer/Refazer)…
│   └── features/<feature>/          # components, hooks, services, types
│       # auth, dashboard, transactions, voice, assistant, receipts
├── tests/ (junto dos arquivos *.test.ts[x])
├── app.json, metro.config.js, babel.config.js, jest.config.js, tsconfig.json
├── eslint.config.js, .prettierrc
└── .env.example                     # EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SHORTCUT_URL

infra/ci-local.sh                    # nova etapa: mobile (npm ci, lint, formatação, tipos, testes, audit)
.github/workflows/ci.yml             # job do mobile, para quando os Actions voltarem
docs/adr/0013-intermediario-da-siri-com-prazo.md
README.md                            # seção do app e da Siri
```

**Structure Decision**: o app é um projeto à parte em `mobile/`, sem workspaces. Ele importa o
código puro do site pelo apelido `@web/*`. O backend cresce dentro dos módulos que já existem,
sem domínio novo. O site ganha uma função na Vercel e as telas da voz.

## Ordem de entrega e corte (prazo 2026-11-25)

A ordem segue a da P1 da spec. Os marcos são o fim de cada dia. O que não ficar pronto no marco
empurra o corte, que começa pelo fim da lista.

| Dia | Marco | Conteúdo |
|-----|-------|----------|
| 18–19/11 | Base pronta | Projeto `mobile/` criado no SDK 58 (M1 feita). Prova do `@web`, com meio dia de limite. Tema e fontes. Backend: `sessions.client` e login do app, com testes. |
| 19–20/11 | **H1 e H2** | Entrada, duas etapas, sessão no Keychain, guard, sair. Lançar, listar, editar e excluir. O deploy do backend vai à produção (M3). |
| 20–21/11 | **H3** | Tokens pessoais, `POST /voice/entries` com prazo, função `/api/siri`, varredura de rotas. Deploy. Atalho e link (M4 a M6). Medir a Siri (M5). |
| 21–22/11 | **H4 e H5** | Bloco de voz, "Você disse", desfazer e refazer, no app e no site. Painel com barras. Política de privacidade. Deploy. |
| 23/11 | **H6** | Assistente: perguntas, lançamento por texto e histórico. |
| 24/11 | **H7** e acabamento | Comprovante por foto. Revisão de VoiceOver e fonte grande. README e ADR 0013. Roteiro completo no iPhone (M7). |
| 25/11 | Entrega | Folga para correções, M1 de novo e M9. |

**Corte**:

1. Se em 23/11 à noite o caminho entrar → lançar → Siri → desfazer → painel não estiver inteiro,
   H7 (foto) sai.
2. Se em 24/11 ao meio-dia ainda faltar acabamento, H6 (assistente) sai também.

A P2 só começa com toda a P1 verde no roteiro do iPhone.

## Tarefas do mantenedor, fora do código

| # | Quando | Tarefa |
|---|--------|--------|
| M1 | Feita em 2026-11-18; repetir em 25/11 | Conferir no Expo Go a versão do SDK. Resultado: Expo Go 58.0.5, com SDK 58.0.0, e atualizações automáticas da App Store desligadas até a entrega. Em 25/11, conferir que nada mudou. |
| M2 | Dia 1 | Criar `mobile/.env` a partir do `.env.example`, com `EXPO_PUBLIC_API_URL=https://contai-project.vercel.app`. Se o QR code não abrir, liberar o Metro no firewall do Windows ou usar `--tunnel`. |
| M3 | A cada marco com backend | Aprovar o merge na `main`, com o CI local verde, para o Render e a Vercel publicarem. A migração roda na subida da API. |
| M4 | Antes do primeiro deploy da função | Criar na Vercel a variável `API_ORIGIN_URL=https://contai-api.onrender.com`. `ORIGIN_SECRET` já existe. Depois do deploy, conferir com `curl` que `/api/siri` responde a função e que `/api/v1/health` continua na API. |
| M5 | Logo depois do deploy da voz | Montar o atalho à mão pelo passo a passo do app e medir, falando com a Siri, o tempo até a resposta. O resultado confirma ou ajusta os 8 s de espera, por variável de ambiente. |
| M6 | Depois da M5 | No mesmo atalho, trocar o token por uma pergunta de importação. Conferir que nenhuma ação guarda um token. Compartilhar pelo iCloud e pôr o link em `EXPO_PUBLIC_SHORTCUT_URL`. |
| M7 | 24/11 | Rodar o roteiro do [quickstart.md](quickstart.md) no iPhone, com a revisão de VoiceOver e fonte grande. Antes das 40 frases, subir temporariamente `AI_DAILY_QUESTION_LIMIT` no Render (por exemplo, para 80). No fim do roteiro, voltar para 30. A cota diária do próprio Gemini continua valendo. |
| M8 | 22/11 | Revisar o texto novo da política de privacidade: a Siri e a frase guardada. |
| M9 | 25/11 | Acordar o servidor alguns minutos antes da apresentação, ou criar no cron-job.org um job temporário (health check a cada 10 min, só na janela da apresentação) e apagá-lo depois. |
| M10 | Depois da entrega | Decidir quando voltar o código compartilhado ao apelido, se a regra do meio dia tiver gerado um desvio. |

## Complexity Tracking

Nenhuma violação da constituição a justificar.

O risco de o Expo Go da loja mudar de SDK foi tratado: a M1 conferiu o SDK 58, e o mantenedor
desligou as atualizações automáticas até a entrega (research, seção 3).

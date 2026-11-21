# Quickstart: validar o app mobile e o lançamento por voz

**Feature**: [spec.md](spec.md) | **Plano**: [plan.md](plan.md) |
**Contratos**: [rest-api.md](contracts/rest-api.md), [siri-shortcut.md](contracts/siri-shortcut.md)

Este é o roteiro para provar que a feature funciona de ponta a ponta. Os detalhes de endpoint
estão nos contratos.

## Pré-requisitos

- iPhone com o Expo Go da App Store, o app Atalhos e a Siri em português do Brasil.
- PC com Windows, Node LTS e Docker Desktop, com a stack local do Contaí funcionando
  (`docker compose up`).
- iPhone e PC na mesma rede Wi-Fi. Se não der, use o modo túnel, descrito abaixo.
- Uma conta de teste no site de produção, com e-mail confirmado. Ela precisa ter:
  - duas etapas ativas;
  - uma conta corrente "Itaú" e dois cartões, "Nubank" e "Inter";
  - lançamentos em pelo menos dois meses.

## 1. Conferir o SDK do Expo Go (antes de tudo)

1. No iPhone, abra o Expo Go e vá em Configurações. Precisa aparecer o SDK 58 (em
   2026-11-18: Expo Go 58.0.5, com SDK 58.0.0).
2. Confira que `mobile/package.json` usa o `expo` 58. Se for diferente, o app
   não abre ("Project is incompatible with this version of Expo Go").

## 2. Rodar o app no iPhone

```powershell
cd mobile
npm ci
Copy-Item .env.example .env   # só se .env ainda não existir; nunca sobrescrever
npx expo start                # ou: npx expo start --tunnel
```

- O `.env` define `EXPO_PUBLIC_API_URL=https://contai-project.vercel.app` e, depois da tarefa
  M6, `EXPO_PUBLIC_SHORTCUT_URL`.
- Leia o QR code com a câmera do iPhone. O app abre no Expo Go.
- **API local (opcional, só durante o desenvolvimento)**:
  - Aponte `EXPO_PUBLIC_API_URL` para `http://<IP do PC>:8080`.
  - Suba a stack com um override que publique o proxy em `0.0.0.0:8080`. Por padrão ele só
    escuta em `127.0.0.1`.
  - Isso expõe o ambiente de desenvolvimento na rede local: use só em rede de casa e desligue
    depois.

**Resultado esperado**: a tela de entrada aparece com as fontes Besley e Atkinson Hyperlegible
Next, no tema do sistema.

## 3. Testes automatizados

```powershell
cd mobile;   npm run lint; npm run format:check; npm run typecheck; npm test; npm audit
cd frontend; npm run lint; npm run format:check; npm test     # inclui a função api/siri
bash infra/ci-local.sh                                        # backend, frontend e mobile
```

Os testes do backend que esta feature exige:

- tokens pessoais;
- a varredura de rotas;
- o prazo da voz;
- a restauração;
- o login do app.

Todos rodam com PostgreSQL real e IA falsa, sem gastar cota do Gemini.

**Resultado esperado**: tudo verde. A varredura falha se alguma rota além de
`POST /api/v1/voice/entries` aceitar o token pessoal.

## 4. Roteiro no iPhone (produção)

Cada passo cita a história e o cenário da spec.

### Entrar e sair (história 1)

1. Entre com e-mail, senha e código do autenticador. O painel aparece (cenários 1 e 2).
2. Feche o app de vez e abra de novo. Ele continua conectado (cenário 5).
3. No site, em Sessões, encerre "App do Contaí". No app, puxe para atualizar: ele volta para a
   entrada com o motivo (cenário 6).
4. Entre de novo, escolha "Sair" e confirme (cenário 7).

### Lançar e corrigir (história 2)

1. Cronometre: lançar → valor 32,50 → Salvar. Precisa levar menos de 10 s (SC-002).
2. Edite o valor e confira o resultado no site. Exclua outro lançamento e confirme a exclusão.

### Voz (histórias 3 e 4)

1. Em Mais → Siri, gere um token chamado "iPhone", com conta padrão Itaú, e copie o token.
2. Instale o atalho pelo link (ou pelo passo a passo) e cole o token quando ele pedir. Cronometre
   a configuração inteira: precisa ser menos de 5 min (SC-012).
3. Acorde o servidor abrindo o app. Diga "E aí Siri, Contaí" e depois "gastei 45 no iFood no
   Nubank". A Siri responde com "45 reais" em até 8 s (SC-003). Anote o tempo: é a medição da
   tarefa M5.
4. Diga "gastei 20 na padaria" sem citar conta. O lançamento vai para o Itaú, a conta padrão.
5. Diga "gastei 30 no cartão". Como há dois cartões, a Siri pede para repetir, e nada é lançado.
6. Abra o app. O bloco "Lançados por voz" mostra os dois lançamentos com "Você disse: …".
   - Toque em "Desfazer" e depois em "Refazer": o lançamento volta.
   - Desfaça outra vez e espere 10 s: a exclusão fica definitiva.
   - Repita o desfazer pelo site.
7. Revogue o token. A próxima frase recebe "Não consegui confirmar seu acesso…" (SC-009).
8. **Servidor dormindo**: espere 20 minutos sem usar o Contaí e fale um gasto.
   - A Siri diz que o Contaí está acordando.
   - Depois de 1 minuto, repita a frase.
   - Confira que existe só um lançamento (SC-011). Repita 10 vezes ao longo dos dias.

### Roteiro de frases (SC-005 e SC-006)

- **Frases**: 20 claras e 20 ambíguas, com o resultado esperado de cada uma, na tabela de
  `specs/002-app-mobile-siri/validation/frases-voz.md`, criada na tarefa de testes.
- **Ambíguas**: sem valor, conta inexistente, dois gastos, pergunta, data futura, instrução
  embutida e transferência.
- **Cota**: as 40 frases gastam cota real do Gemini e passam do limite de 30 perguntas por dia.
  Antes de começar, suba temporariamente `AI_DAILY_QUESTION_LIMIT` no Render (por exemplo, para
  80). No fim, volte para 30.
- **Resultado esperado**: pelo menos 18 das 20 claras viram o lançamento certo, e nenhuma
  ambígua lança nada.

### Painel, assistente e comprovante (histórias 5 a 7)

1. Compare entradas, saídas, saldo e categorias do app com o site em três meses (SC-008).
2. Pergunte ao assistente "quanto gastei com alimentação esse mês?" e confira com o painel.
3. Fotografe um recibo, aceite o aviso de IA, ajuste a categoria e confirme.

### Acessibilidade (SC-013)

1. Ative o VoiceOver. Entre, lance uma despesa e desfaça um lançamento por voz, só com gestos.
2. Em Ajustes → Acessibilidade → Tela e Tamanho do Texto, ponha o maior tamanho. Percorra todas
   as telas P1: nenhum valor aparece cortado e nenhuma ação fica escondida.
3. Troque o tema do iPhone com o app aberto. O app acompanha na hora.

## 5. Antes da apresentação (2026-11-25)

1. Refaça o passo 1: o SDK do Expo Go não mudou.
2. Alguns minutos antes, abra o app para acordar o servidor (ou ative o job temporário da tarefa
   M9).
3. Confira que o token da demonstração está ativo e que o atalho responde.

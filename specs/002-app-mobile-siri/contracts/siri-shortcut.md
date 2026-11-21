# Contrato: atalho da Siri e função intermediária na Vercel

**Feature**: [spec.md](../spec.md) | **Research**: [research.md](../research.md), seções 1, 7 e
10

## Caminho de uma frase

```text
"E aí Siri, Contaí"
  └─ Atalho "Contaí" (iPhone)
       1. Ditar texto (pt-BR) ─ "O que você gastou?"
       2. Obter conteúdo de URL ─ POST https://contai-project.vercel.app/api/siri
            cabeçalho Authorization: Bearer <token da pergunta de importação>
            corpo JSON {"phrase": <Texto ditado>}
       3. Obter valor do dicionário "speech"
       4. Mostrar resultado            ← a Siri lê o texto em voz alta
            │
            ▼
  Função da Vercel  frontend/api/siri.ts  (POST /api/siri)
       ├─ deadline = chegada + 5,5 s
       ├─ fetch  https://contai-api.onrender.com/api/v1/voice/entries
       │     cabeçalhos x-contai-proxy-secret, Authorization (repassado),
       │     X-Contai-Deadline, Content-Type
       ├─ resposta em até 8 s  → 200 {"outcome", "speech"} repassados
       └─ passou de 8 s ou erro de rede → 200 {"outcome": "waking", "speech": <acordando>}
```

## Função `POST /api/siri`

- **Entrada**: `Authorization` e corpo `{ "phrase": str }`. Corpo maior que 2 KB, sem `phrase`
  ou com outro método HTTP recebe 200 com `outcome = repeat` e a mensagem "Não ouvi nada. Pode
  repetir?".
- **Saída**: sempre HTTP 200 e `{ "outcome": str, "speech": str }`. O atalho lê só `speech`.
  Responder sempre 200 evita depender de como o app Atalhos trata respostas 4xx e 5xx.
- **O que a função não faz**:
  - não guarda, não registra em log e não interpreta a frase ou o token, só os repassa;
  - não repassa o `transaction_id` ao atalho.
- **Variáveis de ambiente na Vercel**:
  - `ORIGIN_SECRET`, que já existe e é a mesma do proxy;
  - `API_ORIGIN_URL`, nova, com o valor `https://contai-api.onrender.com`;
  - `VOICE_RELAY_TIMEOUT_MS`, opcional, com padrão 8000;
  - `VOICE_API_BUDGET_MS`, opcional, com padrão 5500. Precisa ficar pelo menos 2,5 s abaixo de
    `VOICE_RELAY_TIMEOUT_MS` (research, seção 1).
- **Roteamento** (`frontend/vercel.json`): a primeira rota passa de `/api/(.*)` para
  `/api/((?!siri$).*)`, e o resto continua igual. A função é servida no passo
  `handle: filesystem`.

## Mensagens faladas (`speech`)

O backend monta as mensagens a partir do resultado. O modelo de IA nunca escreve a resposta. O
valor é sempre falado por extenso: "45 reais", "45 reais e 90 centavos", "1 real", "90
centavos".

| `outcome` | Situação | Mensagem |
|-----------|----------|----------|
| `saved` | Despesa | "Anotei {valor} em {categoria}, no {conta}." |
| `saved` | Receita | "Anotei uma entrada de {valor} em {categoria}, na conta {conta}." |
| `repeat` | Sem valor ou valor inválido | "Não entendi o valor. Pode repetir dizendo quanto foi?" |
| `repeat` | Conta citada não encontrada | "Não encontrei essa conta. Pode repetir dizendo o nome da conta?" |
| `repeat` | Conta citada ambígua | "Você tem mais de uma conta assim. Pode repetir dizendo qual?" |
| `repeat` | Sem conta e sem conta padrão válida | "Não sei em qual conta lançar. Repita dizendo a conta, ou escolha uma conta padrão no app." |
| `repeat` | Data que não se entende | "Não entendi quando foi. Pode repetir dizendo o dia?" |
| `repeat` | Data futura | "A data ficou no futuro. Pode repetir dizendo quando foi?" |
| `repeat` | Frase vazia | "Não ouvi nada. Pode repetir?" |
| `repeat` | Frase com mais de 300 caracteres | "A frase ficou longa demais. Diga só um gasto, de forma curta." |
| `unsupported` | Mais de um lançamento | "Entendi mais de um gasto. Diga um de cada vez." |
| `unsupported` | Transferência ou parcelado | "Transferências e compras parceladas não dá para lançar por voz. Lance pelo app ou pelo site." |
| `unsupported` | Pergunta | "Pela Siri eu só anoto gastos e entradas. Para perguntas, use o assistente no app." |
| `limit` | Cota de IA do dia | "O limite de uso de hoje acabou. Lance esse gasto pelo app." |
| `limit` | 20 frases por hora | "Foram muitos lançamentos em pouco tempo. Tente de novo daqui a pouco." |
| `unavailable` | IA indisponível | "Não consegui lançar agora. Nada foi salvo. Tente de novo em alguns minutos." |
| `deadline` ou `waking` | Prazo ou servidor acordando | "O Contaí está acordando. Nada foi lançado. Tente de novo em um minuto." |
| `unauthorized` | Token inválido ou revogado | "Não consegui confirmar seu acesso. Abra o app do Contaí e conecte a Siri de novo." |

Os nomes de categoria e de conta são os que o próprio usuário cadastrou. A mensagem nunca
inclui saldo, outros lançamentos nem dados pessoais (FR-024).

## Atalho compartilhado (link do iCloud)

- **Pergunta de importação**: o campo de valor do cabeçalho `Authorization` usa uma pergunta de
  importação ("Cole o token que o app do Contaí mostrou"). O texto fixo `Bearer ` fica antes da
  resposta.
- **Antes de compartilhar**: o mantenedor confere que nenhuma ação contém um token, e que o
  cabeçalho mostra só a variável da pergunta (FR-017a).
- **URL do atalho**: fixa, `https://contai-project.vercel.app/api/siri`, porque o atalho só
  funciona com a produção.
- **No app**: o link do iCloud entra por `EXPO_PUBLIC_SHORTCUT_URL`. Sem essa variável, o app
  mostra só o passo a passo manual.

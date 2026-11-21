# ADR 0013: intermediário da Siri com prazo absoluto

- **Situação**: aceito
- **Data**: 2026-11-21
- **Referência**: ADR 0010 (hospedagem em planos gratuitos), ADR 0012 (tokens pessoais),
  `specs/002-app-mobile-siri/research.md`, seções 1 e 2, e
  `specs/002-app-mobile-siri/contracts/siri-shortcut.md`

## Contexto

O lançamento por voz começa na Siri: o atalho "Contaí" dita a frase e chama a API com o token
pessoal. Dois limites se chocam nesse caminho:

- **A Siri desiste cedo**. O tempo de espera da ação "Obter conteúdo de URL" não é documentado.
  Os relatos falam em cerca de 10 a 15 segundos para um atalho chamado pela Siri. Quando a ação
  falha, o atalho para com um erro genérico, e o app Atalhos não oferece "se der erro" nem "tentar
  de novo" para montar uma resposta amigável.
- **A API dorme**. No plano gratuito do Render, a API dorme depois de um tempo sem acessos e leva
  cerca de 1 minuto para acordar (ADR 0010).

Se o atalho chamasse a API direto, a primeira frase do dia terminaria num erro genérico. Pior: a
requisição continuaria na fila do Render e gravaria o lançamento quando a API acordasse. O
usuário, sem resposta, repetiria a frase, e o gasto entraria duas vezes.

## Decisão

- **Uma função da Vercel no meio**: o atalho chama `POST /api/siri`, uma função em
  `frontend/api/siri.ts`, no mesmo domínio do site. A rota do proxy no `frontend/vercel.json`
  passa a ser `/api/((?!siri$).*)`, para essa função não ir ao Render.
- **Prazo absoluto**: a função marca a chegada e repassa a frase à API com o cabeçalho
  `X-Contai-Deadline`, a chegada mais 5,5 s, e com o segredo do proxy.
- **Espera curta**: a função espera a API no máximo 8 s. Sem resposta a tempo, por demora, erro
  de rede ou resposta fora do formato, ela responde: "O Contaí está acordando. Nada foi lançado.
  Tente de novo em um minuto." A própria chamada já acordou a API.
- **Dupla conferência na API**: a API confere o prazo antes de chamar a IA e de novo
  imediatamente antes de gravar. Uma frase que chega depois do prazo, como acontece quando a API
  acorda 1 minuto depois, é descartada sem gravar nada. Ela conta uma pergunta na cota de IA,
  porque a constituição manda contar cada chamada (Princípio XV).
- **Folga de 2,5 s**: o prazo da API fica pelo menos 2,5 s abaixo da espera da função. A folga
  cobre a volta da resposta: se o commit acontece dentro do prazo, a resposta chega à função
  antes de ela desistir.
- **Sempre 200**: a função responde sempre com status 200 e `{ "outcome", "speech" }`. O atalho
  só lê `speech`, e não depende de como o app Atalhos trata respostas 4xx e 5xx.
- **Por configuração**: a espera (`VOICE_RELAY_TIMEOUT_MS`) e o prazo (`VOICE_API_BUDGET_MS`)
  são variáveis da Vercel. A primeira medição com o iPhone (tarefa M5) pode ajustá-las sem
  mudar código.

## Alternativas rejeitadas

- **O atalho chama a API direto**: com o servidor dormindo, a Siri mostra um erro genérico, e o
  lançamento é gravado depois, sem o usuário saber. Com "Dispensar a Siri e continuar", a Siri
  some, e o usuário fica sem ouvir nada por 1 minuto. As duas contrariam a spec, que pede que a
  Siri diga que o Contaí está acordando.
- **Manter a API sempre acordada**: o worker embutido consulta a fila a cada 2 s, e com isso o
  banco do Neon nunca dorme. No tamanho mínimo, seriam cerca de 182 CU-horas por mês, contra as
  100 do plano gratuito (research, seção 2).
- **Chave de idempotência gerada pelo atalho**: repetir a frase é ditar de novo, e não reenviar
  a mesma requisição. Cada repetição teria uma chave nova, e a chave não pegaria a duplicata.

## Consequências

- **Nada em dobro**: a frase que chega tarde não grava. Quando o usuário repete, só um
  lançamento existe (FR-025, SC-011).
- **Risco residual aceito**: um commit nos últimos milissegundos do prazo, com uma volta de mais
  de 2,5 s, faria a função responder "acordando" com o lançamento salvo. Mesmo nesse caso, o
  lançamento aparece em destaque como "por voz" e se desfaz com um toque.
- **Mensagem honesta**: a espera também pode estourar com a API acordada, se a IA demorar. Por
  isso a mensagem diz que nada foi lançado, o que é verdade nos dois casos.
- **Mais uma peça em produção**: a função não guarda nada, não registra a frase nem o token e
  passa pelo mesmo segredo do proxy. Ela precisa de uma variável nova na Vercel,
  `API_ORIGIN_URL`.
- **Primeira frase do dia**: com a API dormindo, a primeira frase sempre ouve "acordando". Para
  a apresentação, o mantenedor acorda a API alguns minutos antes, abrindo o app ou o site.

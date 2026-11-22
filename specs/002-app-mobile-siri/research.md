# Research: App mobile do Contaí e lançamento por voz pela Siri

**Feature**: [spec.md](spec.md) | **Plano**: [plan.md](plan.md) | **Data**: 2026-11-18

Cada seção registra a decisão, por que ela foi tomada e as alternativas rejeitadas. A seção 1
é o ponto que o mantenedor pediu para resolver primeiro.

## 1. Siri com o servidor dormindo

**Fatos levantados**

- **Tempo de espera do "Obter conteúdo de URL"**: a Apple não documenta. Os relatos encontrados
  descrevem a ação falhando quando a resposta demora, sem um número oficial ([Apple Community
  254691588](https://discussions.apple.com/thread/254691588), [Apple Community
  255617611](https://discussions.apple.com/thread/255617611)). Quando a ação falha por rede ou
  por tempo esgotado, o atalho para com um erro genérico. O app Atalhos não tem "tentar de novo"
  nem "se der erro", e por isso o atalho não consegue montar sozinho uma resposta amigável.
- **Limite da Siri**: o tempo que manda é o da Siri, e não o da ação. Pelos relatos, um atalho
  chamado pela Siri roda só por cerca de 15 segundos, a menos que use "Dispensar a Siri e
  continuar" ([Automators Talk](https://talk.automators.fm/t/tip-running-shortcuts-consistently-for-a-long-time/19013)).
  Para App Intents, um engenheiro da Apple confirma que existe um limite sem número publicado, e
  testes de desenvolvedores mostram falha acima de cerca de 10 segundos ([Apple Developer
  Forums 764501](https://developer.apple.com/forums/thread/764501)).
- **Render dormindo**: leva de 62 a 64 segundos para acordar (medições da spec 001), muito acima
  de qualquer limite da Siri.

**Decisão**: a Siri não chama a API diretamente. Ela chama uma função da Vercel no mesmo domínio
do site, `POST /api/siri`, que funciona como um intermediário curto.

- **Repasse**: a função envia a frase à API no Render, com o segredo do proxy e o cabeçalho
  `X-Contai-Deadline`. Esse cabeçalho é um prazo absoluto: o momento em que a requisição chegou
  à função mais 5,5 segundos.
- **Espera da função**: no máximo 8 segundos. Se a API não responder nesse tempo, a função
  responde ao atalho, com status 200: "O Contaí está acordando. Nada foi lançado. Tente de novo
  em um minuto." A própria chamada já acordou o Render.
- **Sem lançamento em dobro**: a API confere o prazo duas vezes, antes de chamar a IA e
  imediatamente antes do commit. Uma requisição que chega depois do prazo, como acontece quando
  o Render acorda depois de 1 minuto, é descartada sem gravar nada e sem chamar a IA. A chamada
  conta uma pergunta na cota, porque o Princípio XV manda contar cada chamada.
  Quando o usuário repete a frase, só um lançamento existe (FR-025, SC-011).
- **Folga do prazo**: o prazo da API (5,5 s) é 2,5 s menor que a espera da função (8 s). Essa
  folga cobre a volta da resposta. Se o commit acontece dentro do prazo, a resposta chega à
  função antes dela desistir.
- **Risco residual aceito**: um commit nos últimos milissegundos com uma volta acima de 2,5 s
  geraria "acordando" com o lançamento salvo. Mesmo nesse caso, o lançamento aparece em
  destaque e pode ser desfeito.
- **Mensagem honesta**: o tempo também pode estourar com o servidor acordado, se a IA demorar.
  Por isso a mensagem diz que nada foi lançado, o que vale para os dois casos.
- **Tempo total**: com o servidor acordado, a frase leva de 2 a 5 segundos (chamada à IA, de 1 a
  3 s, mais a ida e a volta). Isso cabe no SC-003 (8 s).

**Por que 8 segundos**: fica abaixo dos cerca de 10 segundos relatados para a Siri, porque o
ditado também consome tempo. O número é provisório. A primeira tarefa de voz no iPhone mede o
tempo real (tarefa do mantenedor M5). Se a Siri tolerar mais, o prazo sobe, por configuração, e
não por código.

**Roteamento na Vercel**: o `frontend/vercel.json` usa `routes` legados, e a primeira rota manda
todo `/api/(.*)` para o Render. Essa rota passa a ser `/api/((?!siri$).*)`. Assim, `/api/siri`
segue para o passo `handle: filesystem`, onde a Vercel serve as funções de `frontend/api/`. O
primeiro deploy precisa conferir isso com `curl`: `/api/siri` responde a função, e
`/api/v1/health` continua respondendo a API.

**Alternativas rejeitadas**

- **Atalho chama a API direto, com "Dispensar a Siri e continuar"**: a Siri some e o usuário não
  ouve nada durante 1 minuto. Isso contraria a spec, que pede que a Siri responda que o Contaí
  está acordando.
- **Chave de idempotência gerada pelo atalho**: a repetição é uma frase nova, ditada de novo, e
  não uma nova tentativa da mesma requisição. A chave não detectaria a duplicata. O prazo
  resolve sem depender do atalho.
- **Manter o servidor sempre acordado**: ver a seção 2.

**Medição no iPhone (M5, 2026-11-22)**

- **Servidor acordado**: a Siri respondeu bem rápido, com o lançamento salvo.
- **Servidor dormindo**: a função respondeu "O Contaí está acordando. Nada foi lançado. Tente de
  novo em um minuto.", e a Siri leu a mensagem antes de desistir. A espera de 8 s cabe no limite
  da Siri.
- **Decisão**: `VOICE_RELAY_TIMEOUT_MS` e `VOICE_API_BUDGET_MS` ficam nos padrões (8000 e 5500).
- O primeiro erro da medição era uma digitação errada de `Bearer` no cabeçalho do atalho.

## 2. Manter o servidor acordado: limites do Render e do Neon

**Fatos levantados**

- **Neon gratuito**: 100 CU-horas por projeto por mês. O compute dorme depois de 5 minutos sem
  atividade, e isso não pode ser desligado ([Neon, limites do plano
  gratuito](https://neon.com/faqs/free-plan-limits-and-quotas)).
- **Worker embutido na API**: consulta a fila a cada 2 segundos (`POLL_INTERVAL_SECONDS = 2.0`)
  e grava um sinal de vida a cada 15 segundos (`HEARTBEAT_INTERVAL`), em
  `backend/app/worker/main.py`. Enquanto a API está acordada, o Neon nunca fica 5 minutos
  parado.
- **Render gratuito**: 750 horas de instância por mês. Uma API acordada 24 horas por dia cabe
  nisso (cerca de 730 h).

**Conta**: com a API acordada o tempo todo, o Neon ficaria acordado também. No tamanho mínimo, de
0,25 CU, isso dá 0,25 × 730 h ≈ 182 CU-horas por mês, quase o dobro das 100 do plano. Mesmo
acordada só das 7h às 23h, seriam 0,25 × 16 h × 30 = 120 CU-horas, ainda acima do limite.

**Decisão**: não manter o servidor acordado. A seção 1 torna o servidor dormindo aceitável: a
Siri avisa e nada é lançado em dobro.

**Para a apresentação de 2026-11-25**: o mantenedor acorda o servidor alguns minutos antes,
abrindo o app ou o site. Opcionalmente, pode criar no cron-job.org um job temporário que chama o
health check a cada 10 minutos, só durante a janela da apresentação (tarefa M9). Duas horas
assim custam cerca de 0,5 CU-hora.

**Alternativas rejeitadas**

- **Mudar o worker para consultar a fila só depois de um envio**: permitiria API acordada com o
  Neon dormindo, mas mexe no núcleo da fila (ADR 0001) a uma semana da entrega, sem que a
  apresentação precise disso.
- **Plano pago**: contraria a regra de só usar planos gratuitos sem cartão (ADR 0010).

## 3. Versão do Expo SDK e o Expo Go da App Store

**Fatos levantados** (2026-11-18, fontes em conflito)

- A página de solução de problemas do Expo diz que o Expo Go da App Store parou no SDK 54, e que
  as versões 55 em diante não estão na loja ([Expo docs, versão do Expo
  Go](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)).
- O changelog do SDK 58 (2026-10-15) diz que o novo Expo Go, só com o SDK 58, chegaria às lojas
  "em algumas semanas" ([Expo SDK 58](https://expo.dev/changelog/sdk-58)). Um índice de releases
  de 2026-11-10 ainda o descreve como pendente.

**Decisão** (M1, 2026-11-18): **Expo SDK 58**. O Expo Go 58.0.5, instalado da App Store no
iPhone do mantenedor, abre o SDK 58.0.0. O projeto é criado com `npx create-expo-app` no SDK 58,
e as dependências entram por `npx expo install`, que escolhe as versões compatíveis. Todas as
bibliotecas do plano fazem parte do Expo Go 58.

**Risco tratado**: se o Expo Go mudar de versão antes de 2026-11-25, o app pode parar de abrir.
O mantenedor desligou as atualizações automáticas da App Store até a entrega e confere a versão
de novo no dia (M1).

**Alternativas rejeitadas**: `eas go` com TestFlight exige a conta paga da Apple. Um build do
sign.expo.dev expira em cerca de 7 dias e é uma build nativa própria, que a constituição proíbe.

## 4. Código compartilhado com o site (regra do meio dia)

**Fatos levantados**

- `frontend/src/lib/money.ts` e `frontend/src/lib/dates.ts` não importam nada.
- Os `features/*/types.ts` só importam tipos, com caminhos relativos dentro de `frontend/src`.
- Os `features/*/schemas.ts` só importam `zod`.

Nenhum desses arquivos depende de DOM, React DOM ou Vite.

**Decisão**: o app importa esses arquivos direto de `frontend/src`, pelo apelido `@web/*`, sem
mover nenhum arquivo do site e sem pacote novo. Ficam ajustados:

- **TypeScript** (`mobile/tsconfig.json`): `paths: { "@web/*": ["../frontend/src/*"] }`.
- **Metro** (`mobile/metro.config.js`): `watchFolders` inclui `../frontend/src`. Um
  `resolveRequest` faz `zod` sempre resolver para `mobile/node_modules`, para não haver duas
  cópias da biblioteca em memória.
- **Jest**: `moduleNameMapper` faz o mesmo para `@web/*` e para `zod`.
- **ESLint** (`no-restricted-imports`): o app só pode importar de `@web/lib/money`,
  `@web/lib/dates`, `@web/features/*/types` e `@web/features/*/schemas`.
- **Fonte única**: os testes desses arquivos continuam no site (Vitest).

O site não muda.

**Limite de tempo**: a prova de conceito (tarefa T003) tem meio dia. Ela precisa mostrar
`formatBRL` e um schema rodando no app dentro do Expo Go e no Jest. Se passar do meio dia, o app
copia os arquivos para `mobile/src/shared/` e o plano registra um desvio temporário. Esse
registro lista os arquivos copiados e o plano de adequação: voltar ao apelido depois da entrega.

**Ponto a conferir na prova**: `dates.ts` usa `Intl` com o fuso `America/Sao_Paulo`. O Jest roda
no Node, e não no Hermes, o motor de JavaScript do app. Por isso a prova roda também no iPhone:
uma data perto da meia-noite aparece no fuso certo.

**Alternativas rejeitadas**

- **Workspaces do npm com um pacote `shared/`**: mexe no build do site e na Vercel. Isso gasta
  mais de meio dia e põe em risco o deploy do site.
- **Gerar os tipos a partir do OpenAPI**: os tipos ganham um passo de geração, e dinheiro, datas
  e schemas continuariam duplicados.

## 5. Sessão no app

**Decisão** (detalha o ADR 0012)

- **Login próprio**: endpoints `POST /api/v1/auth/mobile/login`, `/mobile/login/2fa` e
  `/mobile/refresh`, com o cabeçalho `X-Contai-Client: mobile`. O refresh token vai no corpo da
  resposta.
- **Tipo de cliente**: `sessions.client` (`web` ou `mobile`). O refresh de cada tipo recusa a
  sessão do outro.
- **Duas etapas**: o token de desafio ganha a declaração `client`. Um desafio emitido para o app
  não serve no `/login/2fa` do site, nem o contrário.
- **Logout**: usa o `POST /api/v1/auth/logout` que já existe. Ele encerra a sessão pelo `sid` do
  access token. Apagar o cookie, nesse caso, não tem efeito no app.
- **No app**:
  - o access token fica num módulo em memória;
  - o refresh token fica no `expo-secure-store`, na chave `contai.refresh_token`, com
    `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, o que o mantém fora dos backups;
  - uma única renovação fica em andamento por vez, como uma promessa compartilhada: as
    requisições que recebem 401 esperam por ela e repetem uma vez;
  - se a renovação falha, o app apaga o refresh token e volta para a entrada com o motivo.
- **Servidor acordando**: uma requisição que passa de 4 segundos sem resposta mostra "Acordando
  o servidor…", como no site, e continua esperando por até 90 segundos.

**Alternativas rejeitadas**: ver o ADR 0012 (cookie no app e AsyncStorage).

## 6. Tokens pessoais

**Decisão**

- **Formato e guarda**: o token tem o formato `ctp_<uuid do token>.<segredo de 32 bytes em
  base64url>`. O banco guarda o SHA-256 do segredo (ADR 0012). A conferência é por id com
  `hmac.compare_digest`.
- **Autenticação só no endpoint de voz**: uma dependência nova, `PersonalTokenDep`, é usada só
  ali.
  - Ela recusa tokens revogados e tokens de usuários excluídos ou com a exclusão agendada, como
    faz a sessão.
  - A cada uso, ela atualiza `last_used_at`, no máximo uma vez por minuto.
  - O `get_current_user` aceita só JWT. Um `ctp_…` falha na decodificação e recebe 401 em todo
    o resto.
- **Limite de frases**: 20 por hora por token, com o limitador que já existe (slowapi), chaveado
  pelo id do token.
- **Limite de IA**: cada frase conta no balde de perguntas, junto com o chat e o lançamento por
  texto, por uma tarefa nova, `AiTask.VOICE_ENTRY`.
- **Limite de tokens**: 5 ativos por usuário. O serviço confere dentro da transação, com
  `SELECT … FOR UPDATE` na linha do usuário, para dois pedidos simultâneos não passarem do
  limite.
- **Revogação**: os motivos são `user_revoked`, `password_changed` e `password_reset`. A
  revogação acontece no mesmo ponto do serviço de autenticação que revoga as sessões. Na exclusão
  da conta, os tokens são apagados em cascata pela chave estrangeira.
- **Teste de varredura**: percorre `app.routes`. Toda rota que depende de `get_current_user`
  recebe `Authorization: Bearer ctp_…` de um token válido e precisa responder 401. O teste também
  confere que `PersonalTokenDep` aparece em uma única rota, a de voz. Uma rota nova entra no
  teste sozinha.

## 7. Entender a frase falada

**Decisão**

- **Chamada à IA**: uma chamada só, com a ferramenta `parse_voice_entry` obrigatória. O prompt
  fica versionado em `backend/app/modules/assistant/prompts/voice_entry.md`, e não é uma
  conversa. O modelo devolve:
  - `intent`: `entry`, `multiple`, `transfer`, `installments`, `question` ou `other`;
  - `type`: `expense` ou `income`;
  - `amount`, como foi dito;
  - `date_reference`;
  - `description`;
  - `account_hint`;
  - `category_hint`.
- **Montagem pelo backend**: reaproveita as funções de `tools/propose.py`: `amount_cents`,
  `resolve_date` e `accounts_for_hint`. A categoria vem das regras aprendidas, depois da dica do
  modelo, depois de "Outros".
- **Regras próprias da voz**:
  - sem dica de conta, vale a conta padrão do token (o lançamento por texto usa a última conta
    usada);
  - uma dica que não encontra conta, ou que encontra mais de uma, não salva nada, mesmo havendo
    conta padrão;
  - conta padrão ausente ou arquivada sem dica não salva nada;
  - data futura não salva nada;
  - `intent` diferente de `entry` não salva nada.
- **Frase**: entre 1 e 300 caracteres. A frase é dado não confiável, e o prompt repete as
  proteções do assistente.
- **Resposta**: montada pelo backend a partir do resultado, e nunca escrita pelo modelo. O valor
  é falado por extenso ("45 reais e 90 centavos"), porque a leitura de "R$ 45,90" pela voz do iOS
  varia. A lista de mensagens está em
  [contracts/siri-shortcut.md](contracts/siri-shortcut.md).

## 8. Desfazer e Refazer

**Decisão**: desfazer gera um token de restauração assinado, sem guardar nada no servidor.

- **Desfazer**: `POST /api/v1/transactions/{id}/undo-voice` apaga o lançamento, só se a origem
  for `voice`. A resposta traz um `restore_token`, um JWT com:
  - assinatura HS256 com o segredo de JWT que já existe;
  - `aud = "voice-restore"`, que o `get_current_user` não aceita;
  - `sub` = usuário;
  - validade de 15 segundos (10 s de botão mais 5 s de folga de rede);
  - a linha inteira da transação, com id, `created_at` e frase.
- **Refazer**: `POST /api/v1/transactions/restore` confere a assinatura, a validade e o usuário,
  e reinsere a linha com o mesmo id.
  - Se o id já existe, por causa de um toque duplo, a resposta é 200 e nada muda.
  - Se a conta ou a categoria sumiu nesses segundos, a resposta é 409 com uma mensagem.
- **Exclusão definitiva**: depois dos 15 segundos o token expira, e a exclusão fica definitiva.

**Por que é o mais simples**: nenhuma consulta existente muda. Com exclusão lógica (`deleted_at`),
todas as consultas do painel, da lista, dos saldos e das faturas precisariam filtrar a coluna, e
esquecer uma delas mostraria números errados. O token não guarda nada, então não precisa de
limpeza. A linha volta idêntica porque é a mesma linha.

**Alternativa rejeitada**: uma tabela de lançamentos desfeitos, com limpeza agendada. É mais
uma tabela e mais uma tarefa, para guardar algo que precisa durar só 10 segundos.

## 9. Destaque e frase guardada

**Decisão**

- **Frase**: `transactions.voice_phrase` (texto, até 300 caracteres), preenchida só quando a
  origem é `voice`. Um `CHECK` garante isso. Ela entra no `TransactionRead` e na exportação de
  dados, e nunca em logs.
- **Origem**: `transactions.source` ganha o valor `voice`.
- **Lista**: `GET /api/v1/transactions` ganha o filtro `source`.
- **Bloco em destaque**: o app e o site pedem `source=voice&from=<hoje − 6 dias>`. Não há
  endpoint de painel novo, e os números do painel não mudam.

## 10. Atalho da Siri

**Decisão**

- **Estrutura do atalho "Contaí"**:
  1. "Ditar texto", em português do Brasil, com o aviso "O que você gastou?".
  2. "Obter conteúdo de URL", com `POST https://contai-project.vercel.app/api/siri`, corpo JSON
     `{"phrase": <Texto ditado>}` e cabeçalho `Authorization: Bearer <token>`.
  3. "Obter valor do dicionário" `speech`.
  4. "Mostrar resultado", que a Siri lê em voz alta.
- **Token**: entra por uma pergunta de importação, então o atalho compartilhado não carrega
  token nenhum (FR-017a).
- **Link do atalho pronto**: vem de `EXPO_PUBLIC_SHORTCUT_URL`. Sem ela, o app mostra só o passo
  a passo manual (FR-017).
- **Copiar o token**: o app usa `expo-clipboard`. Para a cópia não ficar na área de
  transferência, o app a limpa ao sair da tela do token, se o conteúdo ainda for o token.

## 11. Interface: fontes, tema e gráficos

**Decisão**

- **Fontes**: o React Native no iOS não lê WOFF2, o formato dos arquivos do site. As fontes vêm
  de `@expo-google-fonts/besley` e `@expo-google-fonts/atkinson-hyperlegible-next`, em pesos
  estáticos e TTF, carregadas por `expo-font`, que funciona no Expo Go. Se o pacote da Atkinson
  Hyperlegible Next não existir na versão escolhida, os WOFF2 do site (licença OFL) são
  convertidos para TTF uma vez e ficam em `mobile/assets/fonts/`.
- **Tokens de design**: cores, espaçamentos e raios vêm do `design-system.md` para
  `mobile/src/theme/tokens.ts`. A regra de fonte única do Princípio XIV cobre tipos, dinheiro,
  datas e schemas. Os tokens são constantes de estilo, e a fonte deles é o documento.
- **Tema**: `useColorScheme()` segue o tema do sistema na hora.
- **Gráficos**: barras horizontais ordenadas, feitas com `View` e largura proporcional, sem
  biblioteca. Cada barra é um item acessível com "Alimentação, 842 reais e 30 centavos, 34% das
  saídas".
- **Fonte do sistema**: todo `Text` acompanha o Dynamic Type. Nenhum `maxFontSizeMultiplier`
  limita a escala. As telas usam `ScrollView`, e as linhas de valor quebram em vez de truncar.

## 12. Foto do comprovante

**Decisão**

- **Câmera e galeria**: `expo-image-picker` faz as duas coisas, então `expo-camera` não é
  necessário.
- **Tamanho**: antes do envio, `expo-image-manipulator` reduz a foto para no máximo 2000 px no
  lado maior, em JPEG com qualidade 0,7. Isso dá em geral menos de 1 MB, abaixo dos 10 MB do
  limite.
- **Envio**: pelo mesmo endpoint de importação de comprovante do site, com o mesmo aviso de IA,
  um aceite só por conta. O app acompanha a importação pelo andamento, como o site.

## 13. Testes

**Decisão**

- **App**: `jest-expo` e React Native Testing Library. `fetch` e `expo-secure-store` são
  substituídos por versões falsas. Testes obrigatórios (Princípio X):
  - guardar e apagar a sessão;
  - uma única renovação em andamento;
  - o guard de rotas;
  - os formulários;
  - desfazer e refazer.
- **Backend** (pytest, com PostgreSQL real e IA falsa):
  - os seis testes do token pessoal do Princípio X;
  - o teste de varredura de rotas;
  - o prazo da voz: uma requisição depois do prazo não grava nada e não consome a cota;
  - a restauração (token expirado, de outro usuário, toque duplo);
  - o login do app separado do login do site;
  - o roteiro de frases da voz com a IA falsa programada.
- **Função da Vercel**: Vitest, com `fetch` falso cobrindo resposta normal, tempo esgotado e
  erro de rede.
- **No iPhone**: o roteiro de 20 frases claras e 20 ambíguas (SC-005 e SC-006) roda no
  aparelho e gasta cota real do Gemini. São 40 frases, acima das 30 perguntas por dia. Durante o
  roteiro, o mantenedor sobe temporariamente `AI_DAILY_QUESTION_LIMIT` no Render e depois volta
  para 30 (M7).

## 14. Desenvolvimento no Windows com o iPhone

**Decisão**

- **Metro**: roda no Windows. O iPhone abre o app pelo QR code, na mesma rede Wi-Fi. Se o
  firewall ou a rede atrapalharem, `npx expo start --tunnel` é o caminho alternativo.
- **API**: `EXPO_PUBLIC_API_URL` aponta para `https://contai-project.vercel.app` (produção),
  como pedido. Enquanto os endpoints novos não estão em produção, o app pode apontar para a API
  local pela rede local, `http://<IP do PC>:<porta do proxy local>`.
- **IA local**: o desenvolvimento local da voz usa o provedor falso programado (memória do
  projeto), para não gastar a cota do Gemini.

# Research: Contaí — decisões técnicas da Fase 0

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-01

A stack, a estrutura de pastas e o modelo de dados principal vieram prontos na entrada do
`/speckit-plan`. Este documento registra as decisões que faltavam para fechar o desenho e as
justificativas das dependências novas, como exige a constituição. Não restou nenhum
`NEEDS CLARIFICATION`.

As decisões não foram conferidas em fontes online; a seção 27 lista o que precisa ser verificado
no início da implementação.

## 1. Topologia: uma única origem

- **Decision**: o navegador vê uma única origem. `/api/*` vai para a API, e todo o resto é o
  frontend. Em desenvolvimento, o `docker-compose.yml` sobe o Caddy em `http://localhost:8080`,
  com o frontend rodando o servidor de desenvolvimento do Vite (com recarga automática) por
  trás dele. Em produção (revisão de 2026-11-02, ADR 0010), a Vercel serve o build estático e
  repassa `/api/*` à API no Render, acrescentando o cabeçalho com o segredo do proxy; a API
  recusa o que chega sem ele. Os detalhes estão na seção 24.
- **Rationale**: com app e API na mesma origem, o cookie `SameSite=Strict` funciona sem
  exceções, não é preciso liberar CORS para nenhuma outra origem, e dev e produção têm o mesmo
  desenho de rotas. A lista de origens permitidas do CORS fica vazia por padrão e é configurável
  por variável de ambiente.
- **Alternatives considered**: API em subdomínio próprio (exige CORS com credenciais e cookie
  entre subdomínios); Vite acessado direto na porta 5173 com proxy do próprio Vite (dev diferente
  de produção).

## 2. Sessões, access token e refresh token

- **Decision**:
  - Access token JWT (PyJWT, HS256, segredo em variável de ambiente), validade de 15 minutos,
    com `sub` (usuário) e `sid` (sessão). Fica só em memória no frontend.
  - Refresh token opaco no formato `<session_id>.<segredo aleatório de 32 bytes>`. A tabela
    `sessions` guarda apenas o SHA-256 do segredo atual. A cada uso o segredo é trocado. Se
    chegar um segredo que não é o atual para uma sessão existente, é reutilização de token
    antigo: a sessão inteira é revogada.
  - Uma linha de `sessions` é ao mesmo tempo o "dispositivo conectado" da tela de sessões e a
    "família de rotação".
  - A sessão expira após 30 dias sem uso (janela deslizante renovada a cada refresh).
  - A dependência de autenticação da API confere, a cada requisição, se a sessão do `sid` não
    foi revogada e se o usuário está ativo (uma consulta por chave primária).
- **Rationale**: o formato `sessão.segredo` detecta a reutilização de qualquer token antigo com
  uma única tabela. A conferência por requisição faz o encerramento remoto de sessão, a troca
  de senha e o pedido de exclusão de conta valerem na hora, e não só quando o JWT expira (FR-014,
  FR-015, SC-011). O custo é irrelevante na escala do projeto.
- **Alternatives considered**: uma linha por refresh token com `family_id` (mais tabelas e
  limpeza, sem ganho); JWT puramente sem estado (sessão encerrada continuaria valendo por até
  15 minutos).

## 3. Cookie de refresh, CSRF e várias abas

- **Decision**:
  - Cookie `httpOnly`, `Secure`, `SameSite=Strict`, com `Path=/api/v1/auth/refresh`.
  - O endpoint de refresh exige o cabeçalho `X-Contai-Client: web` e confere o cabeçalho
    `Origin` contra a origem configurada do app.
  - O logout usa o access token (pelo `sid`) para revogar a sessão e devolve um `Set-Cookie`
    que apaga o cookie no mesmo `Path`.
  - No frontend, o refresh é serializado entre abas com a Web Locks API
    (`navigator.locks.request`), para que duas abas nunca apresentem o mesmo token ao mesmo
    tempo.
  - O cookie é sempre `Secure`, inclusive em desenvolvimento: navegadores baseados em Chromium e
    o Firefox aceitam cookies `Secure` em `http://localhost`.
- **Rationale**: como cada aba guarda o access token em memória, duas abas abertas juntas
  fariam refresh em paralelo, e a segunda seria tratada como reutilização, derrubando a sessão.
  Serializar no cliente resolve isso sem criar uma "janela de tolerância" no servidor, que
  enfraqueceria a detecção.
- **Alternatives considered**: tolerância de alguns segundos no servidor para tokens recém
  trocados (enfraquece a segurança e exigiria ADR); cookie sem `Secure` em desenvolvimento
  (cria uma configuração que pode vazar para produção).

## 4. Senhas

- **Decision**: `argon2-cffi` (Argon2id, parâmetros padrão da biblioteca), com `check_needs_rehash`
  no login. Mínimo de 8 caracteres, sem regras de composição. Checagem contra uma lista local de
  senhas comuns (cerca de 10 mil, incluindo termos comuns em português), versionada no repositório.
- **Rationale**: `argon2-cffi` é a implementação de referência e já oferece verificação e
  re-hash; `pwdlib` seria apenas uma camada a mais sobre ela. A lista local evita depender de
  rede e de enviar qualquer derivado da senha a terceiros.
- **Alternatives considered**: `pwdlib` (camada extra sem uso para nós); consulta a serviço
  externo de senhas vazadas (rede externa no fluxo de cadastro e nos testes).

## 5. Bloqueio de login e rate limiting

- **Decision**:
  - O bloqueio após 5 tentativas erradas fica no banco, na tabela `login_attempts`, contado
    pelo e-mail informado (guardado só como SHA-256), exista ou não uma conta com ele; conta
    erros de senha e de código de duas etapas. Um e-mail sem conta recebe as mesmas
    respostas, no mesmo tempo, de uma conta com a senha errada: contar só nas contas faria o
    `423` revelar quais e-mails estão cadastrados, o que o FR-008 proíbe.
  - `slowapi` em memória limita a frequência por IP nos endpoints públicos e por usuário nos
    autenticados. Valores iniciais, todos configuráveis: login 10/min por IP; cadastro 5/h por
    IP; pedidos de e-mail (reenvio, recuperação) 5/h por IP; upload 20/h por usuário; mensagens
    ao assistente 10/min por usuário.
  - O IP do cliente: no ambiente local, vem do cabeçalho definido pelo Caddy, e a API só confia
    nele quando a conexão vem da rede interna do Compose; em produção, é a primeira entrada do
    `X-Forwarded-For`, aceita só nas requisições que trazem o segredo do proxy da Vercel (seções
    24 e 29). Os contadores em memória zeram também quando o serviço dorme.
- **Rationale**: o bloqueio é uma regra da spec (FR-009) e precisa sobreviver a reinícios e ser
  testável; por isso fica no banco. O limite por frequência é só proteção contra abuso, e perder
  os contadores em um reinício é aceitável com a API em instância única.
- **Alternatives considered**: tudo em memória (bloqueio some no reinício); Redis (proibido no
  MVP pela constituição).

## 6. Verificação em duas etapas

- **Decision**:
  - `pyotp` para TOTP, aceitando o passo atual e um passo de tolerância para cada lado; o último
    passo usado fica gravado para impedir reuso do mesmo código.
  - O segredo TOTP é cifrado no banco com Fernet (`cryptography`), com a chave em variável de
    ambiente.
  - 10 códigos de recuperação aleatórios, guardados como SHA-256, de uso único.
  - O QR code de ativação é desenhado no frontend (`qrcode.react`) a partir da URI `otpauth://`;
    o segredo também é exibido em texto para digitação manual.
  - O login em duas etapas usa um `challenge_token` (JWT de 5 minutos, com finalidade própria)
    entre a etapa da senha e a etapa do código.
  - Recuperação sem celular e sem códigos: com o `challenge_token` em mãos, o usuário pede o
    link; ao abrir o link, nasce um `TwoFactorResetRequest` que vale em 72 horas. O worker envia
    o aviso inicial, um lembrete 24 horas antes e, no prazo, desativa as duas etapas, apaga os
    códigos e encerra todas as sessões. O pedido é cancelado pelo link do aviso ou por um login
    com código válido.
- **Rationale**: atende FR-011 a FR-013 com as bibliotecas pedidas. Exigir o `challenge_token`
  garante que só quem sabe a senha consegue iniciar a recuperação.
- **Alternatives considered**: gerar o QR no backend (dependência equivalente e o segredo
  trafegaria como imagem); guardar o segredo TOTP em claro (um vazamento do banco anularia as
  duas etapas).

## 7. E-mails

- **Decision**: todo e-mail é enviado pelo worker, por um job `send_email`. Em desenvolvimento,
  usa `smtplib` e `email.message` da biblioteca padrão dentro de `asyncio.to_thread`, com o
  Mailpit. Em produção (revisão de 2026-11-02), o Render gratuito fecha as portas de SMTP, e o
  envio vai pela API HTTPS do Brevo (`POST /v3/smtp/email`), com `urllib.request` da biblioteca
  padrão, também em `asyncio.to_thread`; `EMAIL_BACKEND` escolhe entre `smtp` e `brevo`. As
  respostas 429 e 5xx viram nova tentativa, e as outras 4xx, falha definitiva. Sem domínio
  próprio, o Brevo troca o remetente por um endereço do domínio dele. O token do link é gerado
  dentro do job, que grava só o hash; o payload do job tem apenas ids e o tipo do e-mail. Os
  textos ficam em arquivos em `app/email/templates/`, preenchidos com `string.Template`.
- **Rationale**: enviar pela fila dá novas tentativas automáticas e faz as respostas de cadastro
  e recuperação levarem o mesmo tempo exista ou não o e-mail (FR-008). Gerar o token no job evita
  guardar o token em claro no payload. A biblioteca padrão dispensa dependência nova.
- **Alternatives considered**: `aiosmtplib` (dependência nova para pouco ganho); envio direto na
  requisição (tempo de resposta denuncia se o e-mail existe e não há nova tentativa).

## 8. Fila de jobs e worker

- **Decision**:
  - Tabela `jobs`; o worker busca com `SELECT ... FOR UPDATE SKIP LOCKED`, em laço com espera
    curta quando não há trabalho. Desde 2026-11-02, o laço roda como uma tarefa de fundo dentro
    do processo da API (`WORKER_EMBEDDED`), em produção e no ambiente local; ele começa e
    para com a API.
  - Falha transitória: nova tentativa com backoff exponencial e aleatoriedade, até
    `max_attempts`. Job travado (worker morreu) volta para a fila depois de um tempo limite.
  - Tarefas periódicas rodam no mesmo laço, por intervalo: exclusões de conta vencidas, pedidos
    de desativação de duas etapas vencidos e seus lembretes, limpeza de tokens e sessões
    expirados, e limpeza de arquivos e importações abandonadas. Como o serviço de produção dorme
    sem acessos, elas também têm um disparo externo: o workflow `scheduled-tasks.yml` chama, a
    cada 3 horas, `POST /api/v1/internal/scheduled-tasks`, protegido por token
    (`SCHEDULER_TOKEN`), que as roda e devolve o resultado de cada uma. Cada tarefa roda sob um
    advisory lock do PostgreSQL próprio dela, para o laço e o disparo não a rodarem em dobro.
    Desde 2026-11-08, com os GitHub Actions da conta bloqueados (ADR 0010), o disparo é o
    cron-job.org chamando o health check a cada 3 horas: a API acorda, e o laço roda todas as
    tarefas periódicas logo no começo, porque não guarda a última execução entre partidas.
  - Saúde do worker: ele grava um batimento em `worker_heartbeats`; `GET /api/v1/health/worker`
    responde saudável se o último batimento tem menos de 60 segundos, e o `healthcheck` do
    contêiner usa a mesma checagem.
  - O payload dos jobs contém apenas identificadores, nunca conteúdo de documento, descrição ou
    valor.
  - O acesso às tabelas `jobs` e `worker_heartbeats` fica só em `worker/repository.py`; os jobs
    chamam serviços dos módulos e nunca consultam o banco direto.
  - Quando a fila desiste de um job (erro definitivo ou tentativas esgotadas), o worker avisa
    o módulo dono dele, se ele registrou esse aviso. É assim que uma importação cujo
    processamento não terminou vai para `failed` com `processing_error`, em vez de ficar presa
    em `queued` ou `processing`.
- **Rationale**: é a fila exigida pela constituição (Princípio III), sem broker externo.
- **Alternatives considered**: `LISTEN/NOTIFY` para acordar o worker (complexidade sem
  necessidade; a espera de 1 a 2 segundos é imperceptível); bibliotecas de fila sobre PostgreSQL
  (dependência nova para algo de cerca de cem linhas).

## 9. Uploads

- **Decision** (revista em 2026-11-02, ADR 0011): limite de 10 MB aplicado na API, lendo em
  blocos (o upload de 10 MB pela Vercel foi validado: seção 29); tipo real conferido com
  `filetype` pelos primeiros bytes (PDF, JPG, PNG, XLSX) e por inspeção de conteúdo para OFX e
  CSV, que são texto. O conteúdo vai para a tabela `import_files`, uma linha por importação,
  apagada depois do processamento; o backup leva a estrutura dela, mas não os dados
  (`pg_dump --exclude-table-data=import_files`). PDF cifrado é detectado pelo marcador
  `/Encrypt` e recusado.
- **Rationale**: atende o Princípio V e sobrevive à hibernação do Render, que não tem disco
  permanente. Antes, os arquivos ficavam num volume privado entre `api` e `worker` (ADR 0006,
  substituído).
- **Alternatives considered**: disco do serviço (perde o arquivo quando o serviço reinicia ou
  dorme); armazenamento de objetos externo (mais uma conta para arquivos que vivem minutos);
  conteúdo no payload do job (a fila guarda só identificadores).

## 10. Fluxo e estados da importação

- **Decision**: estados `queued → processing → awaiting_review → completed → undone`, com os
  desvios `awaiting_mapping` (CSV ou planilha sem modelo conhecido) e `failed`. As transações
  propostas ficam em `import_items` até a confirmação. A revisão é feita no navegador, e a
  confirmação envia a decisão final de cada linha em uma única requisição, gravada em uma única
  transação de banco. O arquivo é apagado quando a importação chega a `awaiting_review` ou
  `failed`; em `awaiting_mapping` ele é mantido até o usuário mapear, por no máximo 24 horas. Uma
  importação em `awaiting_review` expira depois de 7 dias sem confirmação (FR-083). Os
  `import_items` são apagados na confirmação. A tarefa periódica de limpeza roda a cada 10
  minutos: expira as importações vencidas, apaga o arquivo de quem já não precisa dele e os
  arquivos com mais de uma hora que nenhuma importação guarda. Na confirmação, a decisão de
  todas as linhas vem junto, e uma linha recusada não deixa nenhuma entrar. O pagamento de
  fatura é sugerido para o cartão cuja fatura fechada em aberto (ou, sem ela, o total devido)
  tem o valor mais próximo do pago. O frontend acompanha o estado consultando
  `GET /imports/{id}` a cada 2 segundos enquanto o estado não é final.
- **Rationale**: o estado `awaiting_mapping` é necessário porque o mapeamento de colunas acontece
  depois do envio. Manter as edições da revisão só no navegador evita endpoints por linha; o
  custo é perder edições não confirmadas se a página for fechada, aceitável no MVP.
- **Alternatives considered**: salvar cada edição de linha no servidor (mais endpoints e estados);
  WebSocket ou SSE para o andamento (consulta periódica basta).

## 11. OFX

- **Decision**: `ofxtools`, com uma etapa própria de pré-processamento tolerante antes da
  leitura (detecção de codificação, correção de cabeçalho e de datas fora do padrão). O `FITID`
  vira o identificador externo; o saldo informado (`LEDGERBAL`) alimenta a comparação do FR-082.
  Do `ofxtools` é usado só o leitor de marcação (`TreeBuilder`): a validação estrita dele
  (`convert`) recusa arquivos sem `FITID`, sem saldo, sem cabeçalho ou com data fora do padrão,
  comuns em bancos brasileiros. Os campos são lidos da árvore. A data vale como está escrita,
  sem a hora e o fuso: `20260915220000[-3:BRT]` é dia 15, e convertê-la para UTC mudaria o dia.
  Um lançamento com data ou valor ilegível falha o arquivo inteiro (`unreadable`), para o
  extrato não entrar incompleto sem aviso. Arquivo com extrato de mais de uma conta é recusado
  (`multiple_accounts`).
- **Rationale**: é a biblioteca pedida e não traz dependências. Arquivos OFX de bancos
  brasileiros costumam fugir do padrão, então a tolerância fica isolada no importador e é coberta
  por fixtures de vários bancos.
- **Alternatives considered**: `ofxparse` (mais tolerante, mas sem tipos e com dependências);
  parser próprio (reinventar o que já existe).

## 12. CSV e planilhas

- **Decision**: `csv` da biblioteca padrão (com detecção de delimitador e codificação) e
  `openpyxl` em modo somente leitura para `.xlsx`. Um modelo (`ImportTemplate`) é identificado
  pela assinatura do cabeçalho (nomes de colunas normalizados). O mapeamento guarda as colunas de
  data, descrição e valor, o formato da data, o separador decimal e a convenção de sinal, e
  aceita também o caso de colunas separadas de entrada e saída. Ao pedir o mapeamento, o sistema
  sugere as colunas por heurística nos nomes e mostra a prévia das primeiras linhas. `.xls`
  antigo não é aceito. As linhas de título antes do cabeçalho são puladas sozinhas, e as
  colunas são indicadas pela posição. Linha sem data ou sem valor (rodapé de saldo, total) não
  é transação. Uma célula com números que o modelo não consegue ler como data ou valor não é
  pulada: a importação volta a `awaiting_mapping` com `mapping_mismatch` e o modelo é
  descartado, porque ler errado em silêncio seria pior. O caso mais perigoso é o separador
  decimal trocado (`45.90` lido como R$ 4.590,00), detectado porque um separador de milhar é
  sempre seguido de grupos de três algarismos.
- **Rationale**: "formato reconhecido" passa a ter definição testável: existe um modelo salvo do
  usuário com a mesma assinatura de cabeçalho (FR-039, SC-007).
- **Alternatives considered**: catálogo embutido de modelos por banco (manutenção contínua;
  pode vir depois sem mudar o núcleo); `pandas` (dependência pesada para leitura simples).

## 13. PDF e imagem com IA

- **Decision**: o arquivo vai inteiro para o modelo de extração, em uma única chamada por
  documento (nunca uma por página: o plano gratuito do provedor permite poucas chamadas por dia
  para o projeto inteiro), com saída estruturada (JSON Schema) validada por Pydantic. O esquema do extrato traz as linhas e, quando houver, o total do
  documento; o do comprovante traz uma única transação. O backend soma as linhas, compara com o
  total e registra a divergência. Valores monetários chegam como texto e são convertidos para
  centavos com `Decimal`, nunca com `float`. Cada linha traz o sentido do dinheiro em um campo
  próprio (`out` ou `in`), e não no sinal do valor. Na soma, as saídas somam e as entradas
  abatem, como no total de uma fatura. Todo campo do schema é obrigatório, e o que pode faltar
  aceita `null`: o schema vai ao provedor sem valores padrão. O usuário diz no envio se o
  arquivo é um extrato ou fatura, ou um comprovante: uma foto só é lida como comprovante. Data
  ou valor ilegível em uma linha recusa o documento inteiro (`document_unreadable`), como no
  OFX; um comprovante sem data fica com a data do envio, para o usuário conferir. O conteúdo do
  documento é tratado como dado: vai só no anexo, e o prompt de sistema manda não seguir o que
  estiver escrito nele (FR-068). A leitura feita conta no limite diário mesmo quando o
  documento não rende lançamentos; o limite é conferido no envio, contando também os
  documentos que ainda estão na fila. Serviço ocupado ou indisponível: o job tenta de novo
  (três tentativas, com a espera que o provedor pedir ou com backoff), o arquivo fica guardado
  e a importação mostra `ai_busy`; cota do dia esgotada em todos os modelos: falha na hora,
  com `ai_quota_exhausted`, sem nova tentativa (FR-072).
- **Rationale**: atende FR-041 a FR-043 e o Princípio VI: a conferência é feita por código, e o
  usuário revisa tudo antes de salvar.
- **Alternatives considered**: extrair o texto do PDF localmente e mandar só o texto (PDFs
  digitalizados não têm texto; exigiria biblioteca de PDF e OCR).

## 14. Duplicatas e idempotência

- **Decision**: três níveis, aplicados na preparação da revisão.
  1. Identificador externo: índice único parcial em `(account_id, external_id)`; linha com
     identificador já existente é `exact`.
  2. Impressão digital (`fingerprint` = hash de conta, data, tipo, valor e descrição
     normalizada), comparada por contagem: se o arquivo tem duas linhas idênticas e o banco já
     tem uma, só uma é marcada `exact`.
  3. Provável: mesma conta, mesmo sentido do dinheiro e mesmo valor, data com até 3 dias de
     diferença, qualquer descrição; marca `probable`. É o que pega lançamentos feitos à mão. O
     sentido, e não o tipo, porque o extrato do banco não sabe o que é transferência: o
     pagamento de fatura lançado à mão como transferência aparece nele como uma saída comum.
  Cada transação existente explica no máximo uma linha do arquivo. Se o arquivo repete um
  identificador externo, só a primeira linha fica com ele: o índice único recusaria a segunda.
  Linhas `exact` e `probable` chegam desmarcadas. O hash do arquivo é guardado para avisar que o
  mesmo arquivo já foi importado.
- **Rationale**: reimportar o mesmo arquivo gera zero duplicatas com a seleção padrão (FR-050,
  SC-008), e o banco impede a duplicata de OFX mesmo se o código falhar. A impressão digital não
  é única porque duas compras iguais no mesmo dia são legítimas.
- **Alternatives considered**: índice único na impressão digital (bloquearia compras legítimas
  repetidas).

## 15. Categorização

- **Decision**: a descrição normalizada é minúscula, sem acentos, sem pontuação e sem trechos
  puramente numéricos ou de data. `CategorizationRule` associa descrição normalizada a
  categoria, com origem `user` ou `ai`. Ordem: regra do usuário; regra em cache vinda da IA;
  o restante vai em um único lote à IA, que recebe só as descrições distintas e a lista de
  categorias do usuário, e devolve um índice por descrição; o que a IA não resolver, ou devolver
  inválido, fica em "Outros". Uma correção do usuário grava ou substitui a regra como `user`,
  que a IA nunca sobrescreve. Cada descrição normalizada vai à IA uma vez só, e a resposta
  vale para todas as linhas iguais; a que aparece como despesa e como receita (a compra e o
  estorno dela) vai com o tipo em que mais aparece, porque a regra guardada é uma por
  descrição, e a entrada de mesma descrição recebe a categoria da compra, como estorno. O lote vai em pedidos de até 150 descrições, no máximo 4 por
  importação; o que passar disso fica em "Outros". A IA recebe descrições normalizadas e nomes
  de categorias, e nunca valores, datas ou contas. Se o provedor falhar, a importação segue com
  "Outros". Na confirmação de uma importação, só uma categoria diferente da sugerida vira
  regra do usuário, e ela vale para a descrição como veio do banco: aceitar o palpite da IA ou
  o "Outros" não ensina nada. Ao lançar à mão, a categoria escolhida sempre vira regra.
  Para uma entrada, vale também a regra da compra original: a regra de categoria de despesa
  da mesma descrição, ou da descrição sem o prefixo de estorno ("estorno", "est", "reembolso",
  "devolucao", "cancelamento", seguidos ou não de "de", "da", "do" ou "compra"). O prefixo é a
  primeira palavra, inteira: "estacionamento" não começa com o prefixo "est". A entrada vem
  então sugerida como estorno, na categoria da compra. A regra da própria descrição do estorno,
  quando existe, vem antes. A IA não sugere estorno: para ela, receita vai com categoria de
  receita.
- **Rationale**: atende FR-047, FR-048 e o Princípio VII. O cache das respostas da IA poupa a
  cota gratuita em importações repetidas do mesmo comércio.
- **Alternatives considered**: semelhança aproximada entre descrições (resultados imprevisíveis;
  a correspondência exata da descrição normalizada é testável e pode evoluir depois).

## 16. Dinheiro, parcelas, datas e fuso

- **Decision**: centavos inteiros em todas as camadas (`BIGINT` no banco, `int` no Python,
  inteiro no JSON e no TypeScript). Parcelas: `total // n` em cada uma, com o resto de centavos
  somado à primeira. Datas das parcelas: mesmo dia dos meses seguintes, ajustado ao último dia
  em meses curtos. "Hoje" e "mês atual" vêm de `zoneinfo` com `America/Sao_Paulo` (com o pacote
  `tzdata` na imagem). No frontend, `money.ts` e `dates.ts` concentram formatação e fuso.
- **Rationale**: Princípio VIII e FR-029 a FR-031.
- **Alternatives considered**: `Decimal`/`NUMERIC` (correto, mas a constituição fixa inteiros).

## 17. Saldos, faturas e relatórios

- **Decision**:
  - Saldo = saldo inicial + receitas − despesas + transferências recebidas − transferências
    enviadas, para transações com data entre a data de referência e hoje. O saldo é sempre
    calculado por consulta, nunca armazenado. A dívida de um cartão é o saldo com sinal trocado.
  - Transferência: duas linhas em `transactions` (uma por conta), ligadas por
    `transfer_group_id`, com `transfer_direction` (`out` ou `in`).
  - Fatura: derivada, não armazenada. Com fechamento no dia F (limitado ao último dia do mês),
    uma compra na data d pertence à fatura que fecha na primeira data de fechamento posterior a
    d. Fatura atual é a que contém hoje. Parcelas futuras são as parcelas do cartão com data a
    partir do próximo fechamento.
  - O que falta pagar das faturas fechadas: os pagamentos quitam primeiro as faturas mais
    antigas, então é a dívida de hoje menos as compras (menos estornos) da fatura aberta que já
    pesam no saldo, limitado à própria dívida. Fatura atrasada soma na última fechada, como no
    extrato do banco. A dívida inicial de um cartão conta como de faturas já fechadas.
  - Um único serviço de relatórios, no módulo `dashboard`, é usado pelo painel e pelas
    ferramentas do assistente.
  - Estorno: uma receita lançada em categoria de despesa. Nas somas dos relatórios ele abate
    as saídas e o gasto da categoria, e não soma nas entradas; o saldo da conta e a fatura do
    cartão não mudam, porque já contam o dinheiro que voltou. A categoria em que compra e
    estorno se anulam não aparece; a que fica negativa, por um estorno em mês diferente do da
    compra, aparece no fim, sem percentual, e o percentual das outras é a parte de cada uma
    no que foi gasto. Não há tipo de transação nem coluna nova: o tipo da categoria diz que a
    receita é um estorno, e por isso não houve migração. Foram descartados um tipo `refund`
    (migração, seletor de tipo e todo lugar que trata os tipos) e a ligação do estorno com a
    compra original (mais precisa, mas pede uma tela para casar os dois).
- **Rationale**: saldo calculado não pode divergir das transações (SC-009), e o serviço único é
  o que garante números idênticos entre painel e assistente (FR-062, SC-010).
- **Alternatives considered**: saldo armazenado e atualizado a cada transação (risco de
  divergência); tabela de faturas (estado duplicado que precisa ser recalculado a cada edição).

## 18. Camada de IA

- **Decision**: interface `LLMProvider` com duas operações: conversa com ferramentas e geração
  estruturada com anexos opcionais. Tipos próprios e neutros de mensagem, chamada de ferramenta
  e uso de tokens. `gemini.py` implementa com o SDK `google-genai` em modo assíncrono, com a
  execução automática de funções desligada; `fake.py` devolve respostas roteirizadas nos testes.
  Dois modelos por variável de ambiente (`AI_MODEL_CHAT`, `AI_MODEL_EXTRACTION`). Toda chamada
  grava `AiUsage`. Limites diários por usuário (30 perguntas, 10 extrações) contados no fuso de
  Brasília. Erros de limite do provedor viram uma exceção própria: no worker, nova tentativa com
  backoff; no chat, uma nova tentativa curta e, se persistir, mensagem amigável.
  A nova tentativa é feita no modelo reserva (`AI_MODEL_CHAT_FALLBACK` e
  `AI_MODEL_EXTRACTION_FALLBACK`), quando ele está configurado, por indisponibilidade ou por
  cota; sem reserva, é repetida uma vez no mesmo modelo. A cota do dia do provedor é um erro à
  parte (`LLMQuotaExhausted`), reconhecido pelo limite estourado que o provedor informa (um
  `quotaId` por dia) ou por uma espera de horas: ele não é repetido no mesmo modelo e, quando
  acaba também no reserva, o usuário lê que o limite do dia foi atingido e que volta no dia
  seguinte (`429 ai_quota_exhausted`).
- **Rationale**: Princípio VI. Desligar a execução automática mantém o backend no controle de
  cada chamada de ferramenta, que é onde o `user_id` é injetado.
- **Alternatives considered**: bibliotecas de orquestração de LLM (abstração de terceiros no
  lugar de uma interface de duas operações).

## 19. Assistente

- **Decision**:
  - Laço de ferramentas com no máximo 5 rodadas. O modelo recebe a data de hoje em Brasília, as
    contas e as categorias do usuário (só nomes e ids) e as últimas 20 mensagens da conversa.
    As respostas anteriores vão com as consultas que foram feitas (ferramenta e parâmetros,
    sem os resultados): é o que dá assunto a "e no mês anterior?", e obriga a consultar de
    novo para ter o número.
  - Uma pergunta conta uma vez no limite diário do usuário, quantas chamadas ao modelo ela
    precisar. Se o serviço de IA falhar no meio, nada é gravado: nem a pergunta, nem o uso.
  - Períodos são parâmetros simbólicos (`this_month`, `last_month`, `last_n_months`,
    `this_year`, `last_year`, `month`, `custom`), resolvidos em datas pelo backend. O modelo não
    faz conta de datas. O mês atual entra sempre inteiro, como no painel, para os números serem
    os mesmos quando há lançamentos de data futura.
  - As ferramentas devolvem cada valor em centavos e também já formatado em reais, além das
    diferenças e percentuais já calculados.
  - Conferência da resposta: todo valor monetário e percentual presente no texto do modelo
    precisa existir nos resultados das ferramentas daquela rodada. Se não existir, o backend pede
    a resposta de novo uma vez e, se falhar outra vez, monta a resposta por modelo de texto fixo
    a partir dos resultados.
  - Os ids das transações citadas vêm dos resultados das ferramentas, não do modelo, e ficam em
    `ChatMessage`.
  - Lançamento por texto: ferramenta `propose_transaction`, que não grava nada; o backend valida,
    resolve conta e categoria e devolve uma mensagem do tipo `transaction_proposal`, que o
    frontend abre no formulário para confirmação.
  - Descrições e conteúdos de documentos entram no prompt dentro de blocos delimitados, com a
    instrução de sistema de tratá-los só como dados. Os prompts ficam em arquivos versionados em
    `assistant/prompts/`.
  - A resposta é entregue inteira, sem streaming.
- **Rationale**: a conferência por código é o que transforma "a IA não inventa números" em algo
  verificável (FR-062, SC-010). Períodos simbólicos e valores pré-formatados eliminam as duas
  fontes mais comuns de erro de um modelo: contas com datas e com casas decimais.
- **Alternatives considered**: confiar só no prompt (sem garantia); streaming (melhora a
  percepção de espera, mas impede a conferência antes de exibir).

## 20. Exportação e exclusão de conta

- **Decision**: a exportação é um ZIP gerado na hora com `zipfile` e `csv` da biblioteca padrão:
  CSV para contas, categorias, transações e importações, e JSON para perfil e conversas. O pedido
  de exclusão marca o usuário como `pending_deletion`, revoga as sessões e cancela os jobs
  pendentes. Durante os 7 dias, o login funciona, mas a dependência de autenticação só libera a
  consulta do próprio perfil e o cancelamento da exclusão. No prazo, o worker apaga a linha do
  usuário; todas as tabelas de dados do usuário têm `ON DELETE CASCADE`, e os arquivos
  remanescentes são removidos na mesma tarefa.
- **Rationale**: FR-016, FR-017 e SC-011, com um único ponto de bloqueio para a conta em
  exclusão.
- **Alternatives considered**: exportação por job com link por e-mail (desnecessário para alguns
  milhares de linhas).

## 21. Observabilidade

- **Decision**: `logging` da biblioteca padrão com um formatador JSON próprio e um
  `contextvar` com o id da requisição, devolvido também no cabeçalho `X-Request-ID` e no corpo
  dos erros. Os logs registram apenas campos de uma lista permitida (rota, método, status,
  duração, ids, códigos de erro). Erros inesperados registram a pilha, sem os valores das
  variáveis. `GET /api/v1/health` confere a API e o banco.
- **Rationale**: Princípios V e XI. Uma lista do que pode ser registrado é mais segura do que
  tentar filtrar o que não pode.
- **Alternatives considered**: `structlog` (dependência nova sem necessidade).

## 22. Frontend

- **Decision**:
  - `AuthContext` guarda o access token em memória e o usuário atual; ao carregar o app, tenta um
    refresh silencioso. Um único guard de rota protege as rotas autenticadas.
  - `api-client.ts` usa `fetch`, anexa o token e, em um 401, faz um refresh serializado e repete
    a requisição uma vez.
  - Todo dado do servidor passa por TanStack Query; cada feature tem `services/` (HTTP), `hooks/`
    (queries e mutations) e `components/`.
  - Tokens de design como propriedades CSS em `globals.css`, expostos ao Tailwind 4 por
    `@theme`; o tema escuro segue a preferência do sistema, com troca manual guardada no
    navegador.
  - `Motion` só para transições de entrada e saída de modais, folhas e itens de lista, sempre
    respeitando `prefers-reduced-motion`.
  - Gráficos do Recharts sempre acompanhados de uma lista ou tabela com os mesmos dados.
  - A política de privacidade é uma rota pública do app, com versão registrada no aceite.
- **Rationale**: Princípios II, IV e IX.
- **Alternatives considered**: biblioteca de estado global (proibida na entrada do plano);
  `axios` (o `fetch` nativo basta).

## 23. Testes

- **Decision**:
  - Backend: `pytest`, `pytest-asyncio`, `httpx` e `pytest-cov`. Os testes de integração usam o
    PostgreSQL de um contêiner (serviço do Compose no dia a dia, `services` no GitHub Actions),
    com esquema criado pelas migrações e cada teste isolado em uma transação desfeita ao final.
  - Isolamento entre usuários: um teste percorre todas as rotas registradas no app e falha se
    alguma rota autenticada não tiver um caso de isolamento registrado; cada caso cria o recurso
    com o usuário A e exige 404 para o usuário B.
  - `FakeLLMProvider` em todos os testes; nenhum teste acessa a rede.
  - Fixtures de OFX, CSV e XLSX no formato de vários bancos, com dados fictícios.
  - Cobertura mínima de 80% em `app/modules`, imposta no CI.
  - Frontend: Vitest e Testing Library para hooks, formulários, `money.ts` e `dates.ts`, com os
    `services` substituídos por dublês.
- **Rationale**: Princípio X. O teste que percorre as rotas impede que um endpoint novo entre
  sem teste de isolamento (SC-002).
- **Alternatives considered**: `testcontainers` (dependência nova; o Compose já sobe o banco);
  SQLite nos testes (comportamento diferente do PostgreSQL, proibido pela constituição).

## 24. Infraestrutura, deploy, backup e CI

- **Decision** (revista em 2026-11-02, constituição 2.0.0 e ADR 0010; a versão anterior previa
  uma VPS com `docker-compose.prod.yml` atrás do Caddy):
  - `docker-compose.yml` (ambiente local): `caddy`, `frontend` (Vite), `api` (com o worker
    embutido), `postgres` e `mailpit`.
  - Produção em planos gratuitos, sem cartão, com Render e Neon na mesma região (Ohio):
    - **Vercel**: serve o build estático e repassa `/api/*` à API (`frontend/vercel.json`, com
      `routes`, porque o cabeçalho do segredo exige `transforms`). Aplica nas páginas a CSP da
      seção 26, HSTS, `nosniff` e `Referrer-Policy`; `/assets/` com cache de um ano
      (`immutable`), um arquivo de `/assets/` que não existe com 404 sem cache, e o resto com
      `no-cache`; o repasse sem cache.
    - **Render**: a API, da mesma imagem do `backend/Dockerfile` (estágio `prod`), na porta de
      `PORT`, com health check em `/api/v1/health`. O `entrypoint.sh` roda `alembic upgrade
      head` a cada partida.
    - **Neon**: PostgreSQL pelo endpoint direto (sem o pooler, que quebra os prepared statements
      do asyncpg), com `?ssl=require`.
  - A API recusa com 403 o que chega sem o segredo do proxy (`PROXY_SHARED_SECRET`, igual ao
    `ORIGIN_SECRET` da Vercel), menos o health check; responde tudo com `Cache-Control:
    no-store`; e lê o IP do visitante da primeira entrada do `X-Forwarded-For` (seção 29).
  - Tarefas agendadas: ver seção 8.
  - Backup: workflow `backup.yml` no repositório privado `contai-backups`, uma vez por dia:
    `pg_dump` com um usuário só de leitura e sem os dados de `import_files`, compactado, cifrado
    com `age` por chave pública (a chave privada fica com o mantenedor) e guardado como artifact
    com `retention-days: 14`. `infra/backup/restore.sh` documenta e executa a restauração; o
    procedimento é testado restaurando em um banco temporário.
  - CI (`ci.yml`): Ruff, mypy, pytest com cobertura e `pip-audit` no backend; ESLint, Prettier,
    `tsc`, Vitest e `npm audit` no frontend.
  - Deploy: job do GitHub Actions que depende dos jobs de CI e roda só em push na `main`; chama
    os deploy hooks do Render e da Vercel e confere `/api/v1/health` pela Vercel. Os deploys
    automáticos e as prévias dos dois ficam desligados.
  - Segredos só nos painéis dos serviços e nos segredos do GitHub Actions; nada no repositório.
  - Desde 2026-11-08, com os Actions da conta bloqueados (desvio temporário, ADR 0010): CI por
    `infra/ci-local.sh` antes de cada push e deploy pela integração com o Git do Render e da
    Vercel a cada merge na `main`, com as prévias da Vercel desligadas.
- **Rationale**: Princípio XII (constituição 2.0.0). Depender dos jobs de CI garante por
  construção que só há deploy com CI verde. A cifra com chave pública impede que um vazamento de
  quem guarda os backups exponha o conteúdo deles.
- **Alternatives considered**: VPS própria (custa dinheiro); manter o serviço acordado com
  acessos periódicos (estoura as 100 CU-horas do Neon); cron e worker do Render (não existem no
  plano gratuito); artifacts no repositório principal (vai ser público); armazenamento de objetos
  com `rclone` (pede cartão ou não garante que não pede).

## 25. Dependências além da lista da constituição

A constituição exige justificativa para cada dependência nova. As da entrada do plano e as
decididas aqui:

| Dependência | Uso | Por que não a biblioteca padrão ou o que já temos |
|-------------|-----|---------------------------------------------------|
| `asyncpg` | driver do PostgreSQL | exigido pelo SQLAlchemy assíncrono |
| `pydantic-settings` | configurações | parte do ecossistema Pydantic v2 |
| `argon2-cffi` | hash de senha | Argon2id não existe na biblioteca padrão |
| `PyJWT` | access token | exigido pelo Princípio V |
| `pyotp` | TOTP | implementação testada do padrão |
| `cryptography` | cifra do segredo TOTP | cifra autenticada não existe na biblioteca padrão |
| `slowapi` | limite de frequência | evita escrever e testar um limitador próprio |
| `python-multipart` | upload de arquivos | exigido pelo FastAPI para `multipart/form-data` |
| `ofxtools` | leitura de OFX | formato complexo; sem dependências próprias |
| `openpyxl` | leitura de `.xlsx` | formato binário compactado |
| `defusedxml` | leitura segura do XML das planilhas | sem ele o `openpyxl` não se protege de XML feito para esgotar a memória; a planilha vem de upload (Princípio V). Sem dependências próprias |
| `filetype` | tipo real do arquivo | exigido pelo Princípio V; sem dependências |
| `google-genai` | provedor de IA | SDK oficial, isolado atrás de `LLMProvider` |
| `tzdata` | base de fusos | a imagem enxuta não traz a base do sistema |
| `uvicorn` | servidor da API | necessário para executar o FastAPI |
| `pytest-asyncio`, `httpx`, `pytest-cov`, `pip-audit` | testes e auditoria | exigidos pelos Princípios V e X |
| `@hookform/resolvers` | liga React Hook Form ao Zod | integração oficial das duas bibliotecas adotadas |
| `qrcode.react` | QR code das duas etapas | gerar QR à mão não se justifica |
| `@tailwindcss/vite` | integra o Tailwind 4 ao Vite | plugin oficial do Tailwind 4, que faz parte da stack da constituição |
| `motion` | transições de entrada e saída | animar a saída de elementos removidos não é possível só com CSS; uso restrito |
| `react-error-boundary` | limite de erro em volta dos provedores de `App.tsx` | o React só oferece limite de erro como componente de classe, que o Princípio II proíbe no código do projeto; o `errorElement` do React Router cobre as rotas, mas não os provedores fora delas. A biblioteca entrega o limite como componente pronto, sem dependências próprias, e o código do app continua só com componentes funcionais |
| `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` | ambiente de teste | exigidos pelo Vitest com Testing Library |
| `@vitejs/plugin-react` | React no Vite | plugin oficial; sem ele o Vite não compila JSX com recarga |
| `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `globals` | regras do ESLint | conjunto mínimo para aplicar o ESLint a TypeScript e React, e para proibir `any` |
| `@types/react`, `@types/react-dom`, `@types/node` | tipos | exigidos pelo TypeScript estrito |

`age` e `rclone` são ferramentas da imagem de backup, não dependências do código.

O script de dados de demonstração (`backend/scripts/seed_demo.py`) é um seed só para
desenvolvimento local. Ele é executado à mão, recusa-se a rodar com `ENVIRONMENT=production`,
não é chamado por nenhum processo de deploy e não entra na imagem de produção, porque
`backend/.dockerignore` exclui `scripts/` e `tests/`.

## 26. Consequências do design system aprovado

O `design-system.md` foi aprovado em 2026-10-01, depois da prévia estática em `design-preview/`.
Ele traz decisões que afetam a implementação além do visual.

- **Decision**:
  - **Fontes servidas pelo app**: Besley e Atkinson Hyperlegible Next entram como arquivos
    `.woff2` variáveis em `frontend/src/assets/fonts/`, com `@font-face` no `globals.css`. Não há
    chamada ao endereço do Google Fonts nem pacote novo.
  - **Política de segurança de conteúdo**: `default-src 'self'`, com `script-src 'self'`,
    `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`,
    `frame-ancestors 'none'`, `base-uri 'self'` e `form-action 'self'`. A única concessão é
    `style-src-attr 'unsafe-inline'`, porque o Motion e o Recharts aplicam estilos pelo atributo
    `style`. Essa concessão é registrada em ADR, como exige o Princípio V.
  - **Tema sem script embutido**: o tema é definido antes da primeira pintura por um arquivo
    externo, `frontend/public/theme-init.js`, carregado no `<head>`; um script embutido na página
    seria bloqueado pela política acima.
  - **Tokens em um só lugar**: `globals.css` declara os valores por tema, a ponte
    `@theme inline` e os tokens fixos, com a paleta padrão do Tailwind desativada. Durações e
    curvas de animação ficam espelhadas em `frontend/src/lib/motion.ts`.
  - **Cor de categoria como lista fechada**: o backend valida `color` contra os 8 nomes da paleta
    (`ardosia` só na categoria "Outros") e recusa qualquer outro valor; o frontend oferece só as
    oito amostras.
  - **Gastos por categoria sem rosca**: o painel usa a lista de barras ordenadas, feita em HTML
    e CSS. O Recharts fica para a evolução de 6 meses e para as parcelas futuras.
  - **Campo de dinheiro**: componente próprio (`MoneyInput`), com digitação pela direita e valor
    em centavos inteiros, coberto por testes.
  - **Movimento reduzido**: `<MotionConfig reducedMotion="user">` na raiz, a regra global de CSS
    e `isAnimationActive` desligado no Recharts quando o usuário pede menos movimento.
  - **`design-preview/`** fica no repositório como referência visual. Não faz parte do build nem
    do deploy.
  - **Documentação interativa só fora de produção**: a página `/api/docs` carrega scripts de
    fora da origem, o que a política acima proíbe. Em produção, `/api/docs` e
    `/api/openapi.json` ficam desligados; o OpenAPI continua sendo gerado automaticamente e
    está disponível em desenvolvimento.
- **Rationale**: servir as fontes pelo app mantém a política de conteúdo restrita à própria
  origem e não informa acessos a terceiros (Princípios V e VII). A lista fechada de cores é o
  que mantém válida a conferência de contraste e de daltonismo feita no design system.
- **Alternatives considered**: carregar as fontes do Google Fonts (abre a política de conteúdo
  para dois domínios externos e expõe o endereço do usuário); cor livre por categoria (cores sem
  contraste garantido); `nonce` para estilos embutidos (não cobre o atributo `style`).

## 27. A conferir no início da implementação

- Os ids atuais dos modelos Flash e Flash-Lite do Gemini e as cotas do plano gratuito (por
  minuto e por dia). Os limites por usuário (30 perguntas, 10 extrações) precisam caber na cota
  diária somada de todos os usuários.
- Se o plano gratuito do provedor continua permitindo o uso descrito na política de privacidade,
  e qual é o texto exato a informar ao usuário.
- A tolerância do `ofxtools` com arquivos reais de bancos brasileiros; se falhar em algum banco
  comum mesmo com o pré-processamento, reavaliar o `ofxparse` só nesse importador.
- O comportamento de cookies `Secure` em `http://localhost` no Safari.
- As animações do design system em movimento e a interface em celulares reais e em outros
  navegadores: a prévia foi conferida só por capturas estáticas no Chrome.
- Os arquivos de licença das duas fontes, ao copiá-las para o repositório.
- O provedor de e-mail transacional e o de armazenamento de objetos para o backup, e as
  credenciais de cada um. Resolvido em 2026-11-02: Brevo, pela API (seção 7), e artifacts num
  repositório privado do GitHub (seção 24).

## 28. Desempenho do painel e da lista: medição com 5.000 lançamentos

Medição feita em 2 de outubro de 2026, depois do backend da US3, para conferir a SC-013 antes
de construir as telas do painel.

- **Massa**: um usuário de teste com 5.000 lançamentos espalhados por 24 meses (novembro de
  2024 a outubro de 2026): 3.683 despesas, 581 receitas e 736 lados de transferência, em 4
  contas e nas categorias padrão. A tabela `transactions` tinha 5.090 linhas no total.
- **Ambiente**: o `docker compose` de desenvolvimento em uma máquina local (API com
  `uvicorn --reload`, um processo, e PostgreSQL 17 no mesmo host). Não é o servidor de produção.
- **Método**: 30 requisições por rota, depois de 3 de aquecimento, uma por vez. O tempo "no
  servidor" é o `duration_ms` que a própria API registra em cada requisição (seção 21), casado
  pelo `X-Request-ID`; inclui a autenticação, as consultas e a montagem da resposta.

| Rota | Mediana | p95 | Máximo |
|------|---------|-----|--------|
| `GET /dashboard/summary` (um mês cheio) | 10 ms | 15 ms | 16 ms |
| `GET /dashboard/categories` | 7 ms | 9 ms | 9 ms |
| `GET /dashboard/trend`, 6 meses | 6 ms | 7 ms | 7 ms |
| `GET /dashboard/trend`, 24 meses | 11 ms | 12 ms | 13 ms |
| `GET /dashboard/top-expenses` | 5 ms | 8 ms | 8 ms |
| `GET /transactions`, mês atual (padrão da tela) | 7 ms | 7 ms | 8 ms |
| `GET /transactions`, um mês cheio | 8 ms | 9 ms | 13 ms |
| `GET /transactions`, todo o período, 1ª página | 8 ms | 10 ms | 10 ms |
| `GET /transactions`, todo o período, 2ª página (cursor) | 8 ms | 10 ms | 10 ms |
| `GET /transactions`, todo o período, 200 por página | 12 ms | 14 ms | 48 ms |
| `GET /transactions`, busca por texto em todo o período | 34 ms | 48 ms | 55 ms |
| `GET /transactions`, categoria com subcategorias | 8 ms | 9 ms | 12 ms |
| `GET /transactions`, conta e tipo | 8 ms | 9 ms | 9 ms |
| `GET /accounts` (saldos) | 9 ms | 10 ms | 10 ms |

- **Decision**: nenhum índice novo e nenhuma migração. O limite combinado para agir era 300 ms
  no servidor em alguma rota; a mais lenta ficou em 55 ms. O painel inteiro (as quatro rotas,
  mais a de contas) soma menos de 50 ms de servidor, bem abaixo dos 3 segundos da SC-013.
- **Rationale**: os planos (`EXPLAIN ANALYZE`) mostram que todas as consultas do painel e da
  lista já entram pelo índice `ix_transactions_user_id_date`: as de um mês leem só as linhas
  do mês (cerca de 200), a primeira página da lista lê o índice de trás para a frente e para
  em 51 linhas, e a contagem é feita só no índice. As consultas que percorrem os 5.000
  lançamentos do usuário (evolução de 24 meses, saldos e busca por texto) levam de 2 a 9 ms no
  banco. A busca por texto é a mais cara porque compara a descrição e a observação de cada
  linha do usuário sem acentos, duas vezes (a página e a contagem); com este volume, não
  justifica um índice de trigramas.
- **Alternatives considered**: índice parcial por tipo (`user_id`, `date` só para despesa e
  receita) e índice de trigramas para a busca. Os dois ficam para quando uma medição mostrar
  necessidade: hoje só acrescentariam custo de escrita.
- **A repetir**: a medição vale para um usuário com 5.000 lançamentos e pouca concorrência.
  Repetir no servidor de produção, e de novo se um usuário passar de algumas dezenas de
  milhares de lançamentos ou se a busca por texto ficar perceptível.

## 29. Validação do deploy em planos gratuitos (2026-10-31 e 2026-11-02)

Feita antes das adaptações grandes, com a Vercel e o Render no ar e o banco num ramo descartável
do Neon (`validacao`), o provedor de IA simulado e um usuário de teste. O ramo `validacao` expirou
e foi apagado em 2026-11-07; desde então, a API do Render usa o ramo principal do Neon,
`production`, pelo endpoint direto, e o backup lê desse mesmo ramo.

- **Decision**: o desenho da seção 24 funciona. O que foi medido:
  - **Segredo do proxy**: direto no Render, sem o segredo ou com um segredo falso, a API
    responde 403; o health check direto responde 200. Pela Vercel, as requisições chegam.
  - **Cookie de refresh**: chega ao navegador com `HttpOnly; Secure; SameSite=strict;
    Path=/api/v1/auth/refresh`; o refresh com o `Origin` do app troca o cookie, e com o
    `Origin` de outro site responde 403.
  - **Upload**: 10,48 MB pela Vercel, aceito (202); 10,6 MB, recusado com o 413 da própria API,
    não da Vercel. A query string também chega.
  - **Partida a frio**: 62,6 s e 63,9 s depois de 20 minutos sem acesso, dentro dos 120 s da
    Vercel; as requisições seguintes, cerca de 0,45 s.
  - **Argon2id**: com o padrão da biblioteca (64 MiB, t=3, p=4), cerca de 1,4 s por senha no
    Render (login de ~1,8 s). Com m=19 MiB, t=2, p=1 (OWASP), 0,1 a 0,2 s (login de 0,5 a
    0,8 s). O primeiro login de cada usuário refaz o hash e leva cerca de 2,8 s, uma vez só.
  - **Cache**: `/assets/` com `max-age=31536000, immutable`; páginas com `no-cache`; asset
    inexistente com 404 e `no-store`; API com `no-store`.
  - **IP do visitante**: o diagnóstico temporário dos cabeçalhos no Render, em GET e POST,
    mostrou que a Vercel substitui o `X-Forwarded-For` pelo IP do visitante (descartando uma
    lista falsa enviada pelo cliente) e que a Cloudflare e o proxy do Render só acrescentam
    entradas no fim. Com a primeira entrada, as sessões gravaram o IP certo nos quatro logins,
    inclusive nos dois com cabeçalhos falsos.
- **Rationale**: as premissas que derrubariam o desenho (limite de corpo no repasse, cookie,
  partida a frio acima de 120 s, custo da senha na CPU do plano gratuito) foram conferidas no
  ambiente real antes de adaptar o código.
- **Alternatives considered** para o IP: `X-Real-IP` (não chega à API; o valor lido antes era
  um endereço interno do Render, 10.x); `X-Vercel-Forwarded-For` (a Vercel deixa passar o valor
  do cliente em POST: o teste com `1.2.3.4` gravou `1.2.3.4`); `CF-Connecting-IP` e
  `True-Client-IP` (trazem o IP da Vercel).

# ADR 0012: sessão no app mobile e tokens pessoais do lançamento por voz

- **Situação**: aceito
- **Data**: 2026-11-18
- **Emenda relacionada**: constituição 2.0.0 → 2.1.0 (Princípios XIV e XV; ajustes em V, VI, VII,
  IX, X e XII)
- **Referência**: ADR 0002 (sessões e tokens); a spec do app mobile e do lançamento por voz ainda
  vai ser escrita

## Contexto

O Contaí vai ganhar um app em React Native com Expo, rodando no Expo Go num iPhone. Vai ganhar
também o lançamento por voz: um atalho do app Atalhos chama a Siri e envia a frase falada para a
API. As duas coisas trazem clientes que não são o navegador, e o desenho do ADR 0002 depende do
navegador:

- o refresh token fica num cookie `httpOnly` com `SameSite=Strict`;
- o refresh exige o cabeçalho `X-Contai-Client: web` e confere o `Origin`;
- o refresh é serializado entre abas com a Web Locks API.

No app não há cookie `httpOnly` de navegador nem `Origin` confiável. No atalho, a credencial fica
guardada num app de terceiros e é enviada sem o usuário ver a tela do Contaí.

## Decisão

### Sessão no app

- **Login próprio para clientes nativos**: endpoints separados de login e refresh, identificados
  por `X-Contai-Client: mobile`. A sequência é a mesma do site: senha, verificação de e-mail,
  TOTP e códigos de recuperação. O rate limiting e o bloqueio temporário também são os mesmos.
  - O refresh token tem o mesmo formato do site, `<session_id>.<segredo de 32 bytes>`, mas vai
    no corpo da resposta, e não num cookie.
  - O banco guarda só o SHA-256 do segredo. O token é trocado a cada uso, e a detecção de
    reutilização revoga a sessão inteira, como no ADR 0002.
- **Tipo de cliente na sessão**: a tabela `sessions` ganha a coluna `client` (`web` ou
  `mobile`), e as sessões que já existem recebem `web`.
  - O refresh do site só aceita sessões `web` e continua lendo só o cookie, com as mesmas
    checagens de cabeçalho e de origem.
  - O refresh do app só aceita sessões `mobile`, lê o token só do corpo e não grava o cookie.
  - Um token apresentado no endpoint do outro tipo de cliente é recusado.
- **No aparelho**:
  - o access token fica em memória, com os mesmos 15 minutos do site;
  - o refresh token fica no `expo-secure-store` (Keychain) e é apagado no logout ou quando a API
    o recusa;
  - em vez da Web Locks API, o app mantém uma única renovação em andamento por vez e faz as
    demais requisições esperarem por ela.
- **Tela de sessões**: as sessões do app aparecem como dispositivos conectados, com o mesmo
  encerramento remoto, a mesma expiração de 30 dias sem uso e as mesmas revogações na troca de
  senha e na exclusão de conta.

### Tokens pessoais

- **Formato e guarda**: o token tem o formato `ctp_<token_id>.<segredo de 32 bytes>`. O prefixo
  facilita reconhecer um token vazado. O token é exibido uma única vez, na criação.
  - A tabela `personal_tokens` guarda: `user_id`, nome dado pelo usuário, SHA-256 do segredo,
    `created_at`, `last_used_at`, `revoked_at` e `revoked_reason`.
  - O segredo é aleatório, de 256 bits, então SHA-256 basta. A conferência é por `token_id` com
    comparação em tempo constante, como no refresh token.
- **Escopo**: o token só é aceito pela dependência de autenticação do endpoint de lançamento por
  voz.
  - A dependência de autenticação de todos os outros endpoints aceita só o JWT de acesso. Por
    isso o token pessoal é recusado em qualquer outro lugar já pela construção do código, e não
    por uma lista de permissões.
  - Um teste percorre todas as rotas registradas e confirma a recusa.
  - Criar, listar e revogar tokens exige a sessão normal do usuário, no app ou no site.
- **Revogação**: o token é revogado por ação do usuário, na troca e na redefinição de senha e na
  exclusão da conta. A revogação vale na requisição seguinte.
- **Uso**: o token vai no cabeçalho `Authorization: Bearer`. Há limite de requisições por token e
  por usuário, e cada chamada conta na cota de IA do usuário.
- **Lançamento sem confirmação**: a frase passa pelo mesmo caminho do lançamento por texto.
  - Com valor, conta e categoria identificados e validados, o lançamento é salvo direto com
    `source = "voice"`, um valor novo em `TransactionSource`.
  - Se falta um dado ou ele é ambíguo, nada é salvo, e a resposta pede para repetir. A voz nunca
    cria contas, cartões ou categorias, e cada frase gera no máximo um lançamento.
- **Destaque e desfazer**: os lançamentos com `source = "voice"` aparecem em destaque no app e no
  site e podem ser desfeitos com um toque, sem confirmação. Desfazer apaga o lançamento.
- **Resposta à Siri**: uma frase curta, que confirma valor, descrição ou categoria e conta, ou
  pede para repetir. Falhas de autenticação e de token revogado têm a mesma resposta genérica.

## Alternativas rejeitadas

- **Cookie também no app**: o tratamento de cookies no React Native varia entre plataformas e
  versões. Além disso, o refresh do site depende de `Origin` e de `SameSite`, que só fazem sentido
  no navegador, e aceitar o app nele obrigaria a afrouxar essas checagens para o site.
- **Refresh token no AsyncStorage**: o AsyncStorage não é cifrado e entra nos backups do
  aparelho. O Keychain é o equivalente do cookie `httpOnly` no celular.
- **Usar o refresh token de uma sessão no atalho**: daria acesso total à conta, e a rotação a cada
  uso quebraria o atalho na segunda chamada.
- **Tokens com escopos configuráveis**: só existe um uso. Um sistema de escopos seria abstração
  prematura e ampliaria o que um token vazado consegue fazer.
- **Lançamento por voz com confirmação**: a Siri não mostra a tela de revisão do Contaí. Confirmar
  obrigaria a abrir o app, e a voz perderia o sentido. A marca de origem, o destaque e o desfazer
  com um toque devolvem o controle ao usuário.
- **Argon2 no hash do token pessoal**: o Argon2 protege segredos de baixa entropia, como senhas.
  Para 256 bits aleatórios ele só acrescenta custo por requisição.

## Consequências

- O login do site não muda: mesmo cookie, mesmas checagens de origem e mesmo endpoint de refresh.
- Uma migração adiciona `sessions.client`, a tabela `personal_tokens` e o valor `voice` no check
  de `transactions.source`.
- Um token pessoal vazado só permite criar lançamentos marcados, visíveis e fáceis de desfazer,
  dentro dos limites de uso. Ele não permite ler nenhum dado.
- Trocar a senha quebra os atalhos da Siri, e o usuário precisa gerar um token novo. A tela de
  tokens deve avisar isso.
- A API no Render dorme depois de 15 minutos sem acesso e leva cerca de 1 minuto para acordar
  (ADR 0010). A primeira frase depois desse intervalo pode passar do tempo de espera do atalho.
  A spec precisa dizer o que o usuário ouve nesse caso.

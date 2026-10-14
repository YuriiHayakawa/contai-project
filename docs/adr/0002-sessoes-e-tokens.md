# ADR 0002: sessões, access token e refresh token

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seções 2 e 3; constituição, Princípio V;
  FR-014, FR-015, SC-011

## Contexto

O acesso precisa ser sem estado o bastante para escalar, mas o encerramento remoto de sessão, a
troca de senha e o pedido de exclusão de conta têm de valer na hora, e não só quando um token
expira. É preciso também detectar o roubo de um refresh token.

## Decisão

- **Access token**: JWT (PyJWT, HS256, segredo em variável de ambiente), validade de 15 minutos,
  com `sub` (usuário) e `sid` (sessão). Fica só em memória no frontend.
- **Refresh token**: opaco, no formato `<session_id>.<segredo de 32 bytes>`. A tabela `sessions`
  guarda só o SHA-256 do segredo atual; a cada uso o segredo é trocado. Um segredo que não é o
  atual para uma sessão existente é reutilização de token antigo: a sessão inteira é revogada.
- Uma linha de `sessions` é ao mesmo tempo o "dispositivo conectado" da tela de sessões e a
  família de rotação. A sessão expira após 30 dias sem uso (janela deslizante).
- A dependência de autenticação confere, a cada requisição, se a sessão do `sid` não foi revogada
  e se a conta está ativa — uma consulta por chave primária.
- **Cookie de refresh**: `httpOnly`, `Secure`, `SameSite=Strict`, com `Path=/api/v1/auth/refresh`.
  O refresh exige o cabeçalho `X-Contai-Client: web` e confere o `Origin` contra a origem do app.
  No frontend, o refresh é serializado entre abas com a Web Locks API, para duas abas nunca
  apresentarem o mesmo token ao mesmo tempo. O cookie é sempre `Secure`, inclusive em
  desenvolvimento: Chromium e Firefox aceitam cookies `Secure` em `http://localhost`.

## Alternativas rejeitadas

- **JWT puramente sem estado**: uma sessão encerrada continuaria valendo por até 15 minutos.
- **Uma linha por refresh token com `family_id`**: mais tabelas e limpeza, sem ganho.
- **Janela de tolerância no servidor para tokens recém-trocados**: enfraqueceria a detecção de
  reutilização; resolver no cliente (Web Locks) evita a janela.
- **Cookie sem `Secure` em desenvolvimento**: criaria uma configuração que pode vazar para
  produção.

## Consequências

- O encerramento remoto, a troca de senha e a exclusão valem na requisição seguinte (SC-011).
- A conferência por requisição custa uma consulta por chave primária — irrelevante nesta escala.
- No Safari, cookies `Secure` em `http://localhost` podem não ser guardados; em desenvolvimento,
  use Chromium ou Firefox (em produção tudo é HTTPS).

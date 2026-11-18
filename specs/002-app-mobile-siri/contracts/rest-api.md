# Contrato: endpoints novos e alterados da API

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md) |
**Research**: [research.md](../research.md), seções 5 a 9

Todos os caminhos ficam sob `/api/v1` e chegam pelo proxy da Vercel com o segredo de origem.
Erros seguem o formato padronizado que já existe (`{"error": {"code", "message"}}`), com
mensagens em português. Os endpoints que não aparecem aqui não mudam.

## Login do app (módulo `auth`)

Todos exigem `X-Contai-Client: mobile`; sem esse cabeçalho, a resposta é 400. O rate limit e o
bloqueio após 5 tentativas são os mesmos do `/auth/login`. Nenhum desses endpoints lê ou grava o
cookie de refresh.

### `POST /auth/mobile/login`

- **Corpo**: `{ "email": str, "password": str }`
- **200 sem duas etapas**: `{ "access_token": str, "refresh_token": str, "token_type": "bearer" }`
- **200 com duas etapas**: `{ "two_factor_required": true, "challenge_token": str }`. O desafio
  leva `client = "mobile"`.
- **Erros**: os mesmos do `/auth/login`. Credenciais erradas têm mensagem genérica, e há também
  conta bloqueada e e-mail não confirmado.

### `POST /auth/mobile/login/2fa`

- **Corpo**: `{ "challenge_token": str, "code": str | null, "recovery_code": str | null }`
- **200**: `{ "access_token", "refresh_token", "token_type" }`, numa sessão nova com
  `client = mobile`.
- **401**: desafio emitido para o site, expirado, ou com código errado.

### `POST /auth/mobile/refresh`

- **Corpo**: `{ "refresh_token": str }`
- **200**: `{ "access_token", "refresh_token", "token_type" }`, com o refresh token trocado.
- **401**: token inválido, revogado ou de uma sessão `web`. A reutilização de um token antigo
  revoga a sessão (ADR 0002).

### Já existentes, com ajustes

- **`POST /auth/logout`**: sem mudança. Encerra a sessão do `sid` do access token, seja `web` ou
  `mobile`.
- **`POST /auth/login/2fa`** (site): passa a recusar desafios com `client = "mobile"`.
- **`POST /auth/refresh`** (site): passa a recusar sessões `mobile`.
- **Listagem de sessões**: cada item ganha `client: "web" | "mobile"`.

## Tokens pessoais (módulo `auth`)

Exigem a sessão normal (`CurrentUserDep`). Um token pessoal recebe 401 aqui (FR-020).

### `GET /personal-tokens`

- **200**: `{ "items": [PersonalTokenRead] }`, só com os ativos, do mais novo para o mais antigo.
- **`PersonalTokenRead`**:

  ```text
  {
    "id": uuid,
    "name": str,
    "default_account": { "id": uuid, "name": str } | null,
    "needs_default_account": bool,
    "created_at": datetime,
    "last_used_at": datetime | null
  }
  ```

### `POST /personal-tokens`

- **Corpo**: `{ "name": str (1–60), "default_account_id": uuid }`
- **201**: `PersonalTokenRead` mais `"token": "ctp_<id>.<segredo>"`. É a única vez que o token
  aparece.
- **409 `personal_token_limit`**: o usuário já tem 5 tokens ativos.
- **422**: conta inexistente, arquivada ou de outro usuário.

### `PATCH /personal-tokens/{id}`

- **Corpo**: `{ "default_account_id": uuid }`
- **200**: `PersonalTokenRead`
- **404**: token inexistente, revogado ou de outro usuário.

### `DELETE /personal-tokens/{id}`

- **204**: revoga com `user_revoked`, e a revogação vale na requisição seguinte.
- **404**: o mesmo caso do `PATCH`.

## Lançamento por voz (módulo `assistant`)

### `POST /voice/entries`

- **Autenticação**: `Authorization: Bearer ctp_<id>.<segredo>`, por `PersonalTokenDep`. É a
  única rota que aceita token pessoal.
- **Cabeçalho opcional**: `X-Contai-Deadline`, um número inteiro em milissegundos desde a época
  Unix. Sem ele, o prazo é o momento da chegada mais 6,5 s.
- **Corpo**: `{ "phrase": str (1–300) }`
- **Resposta**: sempre `VoiceEntryResult`:

  ```text
  {
    "outcome": "saved" | "repeat" | "unsupported" | "limit" | "unavailable"
               | "deadline" | "unauthorized",
    "speech": str,
    "transaction_id": uuid | null
  }
  ```

  O `transaction_id` só vem preenchido quando `outcome = saved`.

| Status | `outcome` | Quando |
|--------|-----------|--------|
| 201 | `saved` | Lançamento gravado com `source = voice` e `voice_phrase` |
| 422 | `repeat` | Falta valor, o valor é inválido, a conta não é encontrada ou é ambígua, falta conta padrão, a data é futura ou a frase está vazia |
| 422 | `unsupported` | Mais de um lançamento, transferência, compra parcelada ou pergunta |
| 429 | `limit` | Cota diária de IA acabou ou o token passou de 20 frases por hora |
| 503 | `unavailable` | O serviço de IA está indisponível |
| 503 | `deadline` | O prazo já tinha passado. Nada foi gravado, e a cota não é consumida se a IA não foi chamada. |
| 401 | `unauthorized` | Token ausente, malformado, inexistente, revogado ou de conta excluída. Todos esses casos têm a mesma resposta. |

**Garantias**

- Nada é gravado em nenhum status diferente de 201.
- O prazo é conferido antes da chamada à IA e imediatamente antes do commit.
- A `speech` nunca contém saldo, outros lançamentos, nome, e-mail nem dados de outras contas.
- A frase e o token nunca aparecem em logs. Nos logs entram só o `outcome`, a duração e o id do
  token.

## Transações (módulo `transactions`)

### `GET /transactions` (alterado)

- **Parâmetro novo**: `source: "manual" | "import" | "assistant" | "voice"` (opcional).
- **`TransactionRead`**: ganha `source` e `voice_phrase: str | null`.
- O bloco em destaque usa `?source=voice&from=<hoje − 6 dias>`, com hoje no fuso de Brasília.

### `POST /transactions/{id}/undo-voice` (novo)

- **200**: `{ "restore_token": str, "expires_in": 10 }`. O lançamento foi apagado.
- **404 `transaction_not_found`**: o lançamento não existe ou já foi desfeito. O app mostra "Esse
  lançamento já tinha sido desfeito." (FR-030).
- **409 `not_voice_entry`**: o lançamento não é por voz. A exclusão comum continua no
  `DELETE /transactions/{id}`, com confirmação.

### `POST /transactions/restore` (novo)

- **Corpo**: `{ "restore_token": str }`
- **201**: `TransactionRead`, com o mesmo id, a origem `voice` e a frase original.
- **200**: o lançamento já tinha sido restaurado, por causa de um toque duplo. Nada muda.
- **410 `restore_expired`**: passou o prazo, e a exclusão é definitiva.
- **409 `restore_conflict`**: a conta ou a categoria não existe mais. A mensagem pede para lançar
  de novo.
- **401/403**: o token de restauração é de outro usuário ou foi adulterado.

## Exportação de dados (módulo `users`)

- O arquivo exportado ganha `source` e `voice_phrase` em cada lançamento, e a lista de tokens
  pessoais. Ela traz o nome, a conta padrão e as datas, mas nunca o hash do token.

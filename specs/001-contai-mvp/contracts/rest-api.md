# Contrato: API REST

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

A referência final é o OpenAPI gerado pelo FastAPI em `/api/docs` (disponível fora de produção). Este documento fixa o que os
testes de integração e o frontend assumem.

## Convenções

- Prefixo: `/api/v1`. Corpo e resposta em JSON, exceto upload (`multipart/form-data`) e
  exportação (ZIP).
- Autenticação: `Authorization: Bearer <access token>`. As rotas marcadas como públicas não a
  exigem.
- Dinheiro: inteiros em centavos (`amount_cents`). Datas: `YYYY-MM-DD`. Instantes: ISO 8601 UTC.
- Listas paginadas: `?limit=` (padrão 50, máximo 200) e `?cursor=`; resposta
  `{ "items": [...], "next_cursor": "..." | null }`.
- Recurso de outro usuário ou inexistente: sempre `404`, com o mesmo corpo (FR-018).
- Conta com e-mail não confirmado: `403 email_not_verified` em qualquer rota autenticada.
- Conta em exclusão: `403 account_pending_deletion` em tudo, exceto `GET /users/me` e
  `DELETE /users/me/deletion`.

### Formato de erro

```json
{
  "error": {
    "code": "validation_error",
    "message": "Confira os campos destacados.",
    "details": { "fields": { "amount_cents": "Informe um valor maior que zero." } }
  },
  "request_id": "..."
}
```

`message` é sempre em português do Brasil e diz o que fazer. Códigos gerais: `validation_error`
(422), `unauthenticated` (401), `forbidden` (403), `not_found` (404), `conflict` (409),
`rate_limited` (429, com `Retry-After`), `payload_too_large` (413), `ai_limit_reached` (429),
`ai_unavailable` (503), `internal_error` (500).

## Auth (rotas públicas)

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `POST /auth/register` | `name`, `email`, `password`, `accept_privacy_policy` | `202` genérico | mesma resposta se o e-mail já existe (FR-008); `422 weak_password` para senha recusada |
| `POST /auth/verify-email` | `token` | `204` | `400 invalid_or_expired_token` |
| `POST /auth/resend-verification` | `email` | `202` genérico | |
| `POST /auth/login` | `email`, `password` | `200` com `access_token` e cookie de refresh, ou `200` com `two_factor_required` e `challenge_token` | `401 invalid_credentials` genérico; `423 account_locked` com `retry_after`, depois de 5 erros seguidos para o mesmo e-mail; `403 email_not_verified` só com a senha correta |
| `POST /auth/login/2fa` | `challenge_token`, e `code` ou `recovery_code` | `200` com `access_token` e cookie | cancela pedido de desativação em aberto; erro conta para o bloqueio |
| `POST /auth/refresh` | cookie; cabeçalho `X-Contai-Client: web` | `200` com `access_token` e cookie novo | `401` se inválido, expirado ou reutilizado; confere `Origin`, e responde `403` sem o cabeçalho ou com origem diferente da do app |
| `POST /auth/logout` | — (autenticada) | `204` e cookie apagado | |
| `POST /auth/password/forgot` | `email` | `202` genérico | |
| `POST /auth/password/reset` | `token`, `new_password` | `204` | encerra todas as sessões e confirma o e-mail da conta, se ainda não estava confirmado (FR-010); desfaz o bloqueio de login do e-mail; `400 invalid_or_expired_token`; `422 weak_password` não gasta o link |
| `POST /auth/2fa/reset/request` | `challenge_token` | `202` | envia o link de pedido (FR-013) |
| `POST /auth/2fa/reset/confirm` | `token` | `200` com `effective_at` | abre a contagem de 72 horas |
| `POST /auth/2fa/reset/cancel` | `token` | `204` | |

**Login sem revelar quais e-mails têm conta (FR-008)**: os erros de login são contados pelo
e-mail informado, normalizado (sem espaços nas pontas e em minúsculas), exista ou não uma
conta com ele. Um e-mail sem conta recebe exatamente as mesmas respostas de uma conta com a
senha errada: `401 invalid_credentials` nas cinco primeiras tentativas e `423 account_locked`
durante os 15 minutos seguintes, com o mesmo status, o mesmo corpo e o mesmo `Retry-After`.
O tempo de resposta também é equivalente: sem conta, a senha é conferida contra um hash
fictício. A contagem de um e-mail recomeça ao entrar com sucesso, ao fim de um bloqueio, ao
redefinir a senha ou depois de 24 horas sem erros.

## Usuário e segurança

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /users/me` | — | perfil: `name`, `email`, `status`, `two_factor_enabled`, `ai_documents_consent`, `deletion_scheduled_at` | |
| `PATCH /users/me` | `name` | perfil | |
| `POST /users/me/password` | `current_password`, `new_password` | `204` | encerra as outras sessões (FR-015) |
| `GET /users/me/sessions` | — | lista com `id`, `device`, `last_used_at`, `is_current` | `device` é um rótulo derivado do user-agent, como "Chrome no Android" |
| `DELETE /users/me/sessions/{id}` | — | `204` | |
| `DELETE /users/me/sessions` | — | `204` | encerra todas, menos a atual |
| `POST /users/me/2fa/setup` | — | `otpauth_uri`, `secret` | ainda não ativa |
| `POST /users/me/2fa/enable` | `code` | `recovery_codes` (10) | exibidos uma única vez |
| `POST /users/me/2fa/disable` | `password`, `code` | `204` | |
| `POST /users/me/2fa/recovery-codes` | `password`, `code` | `recovery_codes` novos | invalida os anteriores |
| `POST /users/me/consents/ai-documents` | — | `204` | registra o aceite do aviso (FR-044) |
| `GET /users/me/export` | — | `application/zip` | FR-016 |
| `POST /users/me/deletion` | `password` | `202` com `deletion_scheduled_at` | desativa a conta e encerra sessões (FR-017) |
| `DELETE /users/me/deletion` | — | `204` | cancela dentro dos 7 dias |

## Contas

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /accounts` | `?include_archived=` | `{ "items": [...] }`, em ordem alfabética, cada conta com `balance_cents` calculado | |
| `POST /accounts` | `name`, `type`, `institution`, `initial_balance_cents`, `initial_balance_date`, `closing_day`, `due_day` | `201` com a conta | `closing_day` e `due_day` obrigatórios para cartão e recusados nos demais tipos (`422`); sem `initial_balance_date`, vale o dia do cadastro; `409 account_name_taken` se já existe conta ativa com o nome |
| `GET /accounts/{id}` | — | conta | |
| `PATCH /accounts/{id}` | campos editáveis | conta | `type` só muda sem transações (`409 account_type_locked`); `409 account_name_taken` |
| `DELETE /accounts/{id}` | — | `204` | `409 account_has_transactions` (FR-022) |
| `POST /accounts/{id}/archive`, `/unarchive` | — | conta | desarquivar dá `409 account_name_taken` se outra conta ativa usa o nome |

## Categorias

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /categories` | `?include_archived=` | `{ "expense": [...], "income": [...] }`; cada categoria traz `children`; ordem alfabética, com "Outros" por último | |
| `POST /categories` | `name`, `kind`, `parent_id`, `icon`, `color` | `201` com a categoria | `color` é um dos 8 nomes da paleta do design system; outro valor dá `422`; `parent_id` precisa ser uma categoria principal ativa, do usuário e do mesmo `kind` (`422`); `409 category_name_taken` entre irmãs ativas |
| `PATCH /categories/{id}` | `name`, `icon`, `color` | categoria | mesma validação de `color`; a "Outros" mantém a cor neutra |
| `POST /categories/{id}/archive`, `/unarchive` | — | categoria, com as subcategorias | `409 category_is_fallback` para a categoria "Outros"; arquivar a principal arquiva as subcategorias, e desarquivá-la traz de volta as que foram arquivadas junto; `409 category_parent_archived` ao desarquivar uma subcategoria de principal arquivada |

## Transações

| Método e rota | Corpo ou filtros | Resposta | Notas |
|---------------|------------------|----------|-------|
| `GET /transactions` | `from`, `to`, `account_id`, `category_id` (inclui subcategorias), `type`, `q`, `installment_group_id`, `ids` | lista paginada, mais `total_count` | filtros combináveis (FR-035); da mais nova para a mais antiga; `q` procura na descrição e na observação, sem diferenciar acentos nem maiúsculas; `ids` é repetido (`?ids=a&ids=b`) |
| `POST /transactions` | `type` (`expense` ou `income`), `amount_cents`, `date`, `description`, `account_id`, `category_id`, `notes` | `201` com a transação | conta e categoria precisam ser do usuário e estar ativas, e a categoria precisa ser do mesmo tipo: caso contrário, `422` com a mensagem no campo; grava ou atualiza a regra de categoria |
| `POST /transactions/installments` | `total_cents`, `installments` (2 a 48), `date`, `description`, `account_id`, `category_id`, `notes` | lista das parcelas | conta precisa ser cartão (FR-030) |
| `POST /transactions/transfers` | `from_account_id`, `to_account_id`, `amount_cents`, `date`, `description` | as duas linhas | contas diferentes (FR-033) |
| `GET /transactions/{id}` | — | transação | |
| `PATCH /transactions/{id}` | campos editáveis; `?scope=single` ou `group` | transação ou lista | `scope` vale para parcelas (FR-032); transferência edita os dois lados |
| `DELETE /transactions/{id}` | `?scope=single` ou `group` | `204` | |

## Importações

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `POST /imports` | `multipart`: `file`, `account_id`, `kind` (`statement` ou `receipt`) | `202` com a importação em `queued` | `413`; `415 unsupported_file`; `403 ai_consent_required` para PDF ou imagem sem aceite; `429 ai_limit_reached` |
| `GET /imports` | — | histórico paginado (FR-051) | |
| `GET /imports/{id}` | — | importação; em `awaiting_mapping`, traz `mapping_preview` e a sugestão de colunas; em `awaiting_review`, traz `items`, `total_check` e `balance_check`; nos dois estados traz `expires_at` (FR-083) | é a rota consultada periodicamente pelo frontend |
| `POST /imports/{id}/mapping` | colunas, formato de data, separador decimal, convenção de sinal | `202`, volta para `queued` | salva o modelo (FR-039) |
| `POST /imports/{id}/confirm` | `items`: lista de `{ id, selected, type, amount_cents, date, description, category_id, counter_account_id }` | importação em `completed` com `imported_count` | tudo em uma transação de banco (FR-046); `409` se o estado não for `awaiting_review` |
| `POST /imports/{id}/undo` | — | importação em `undone` | remove todas as transações dela de uma vez (FR-052) |
| `DELETE /imports/{id}` | — | `204` | descarta uma importação ainda não confirmada |

`total_check`: `{ "document_total_cents", "extracted_total_cents", "matches" }` ou nulo.
`balance_check`: `{ "bank_balance_cents", "bank_balance_date", "computed_balance_cents", "matches" }`
ou nulo.

## Painel

Todas aceitam `month=YYYY-MM`; sem ele, vale o mês atual no fuso de Brasília. O painel não aceita
intervalo de datas (FR-059); períodos personalizados são atendidos pelo assistente.

| Método e rota | Resposta |
|---------------|----------|
| `GET /dashboard/summary` | `income_cents`, `expense_cents`, `net_cents` e o saldo de cada conta ativa (FR-055) |
| `GET /dashboard/categories` | gastos por categoria, com subcategorias, valor e percentual (FR-056) |
| `GET /dashboard/trend?months=6&until=YYYY-MM` | entradas e saídas por mês (FR-057) |
| `GET /dashboard/top-expenses?limit=5` | maiores despesas do período (FR-057) |
| `GET /dashboard/cards` | por cartão: fatura atual (período, fechamento, vencimento, valor) e parcelas futuras por mês e no total (FR-058) |

Transferências nunca entram em `income_cents` nem em `expense_cents`.

## Assistente

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /assistant/suggestions` | — | lista de perguntas sugeridas (FR-070) | texto fixo, sem IA |
| `GET /assistant/usage` | — | uso e limite do dia, e quando zera | |
| `GET /assistant/conversations` | — | lista paginada | |
| `POST /assistant/conversations` | — | conversa | |
| `GET /assistant/conversations/{id}` | — | conversa com mensagens | |
| `POST /assistant/conversations/{id}/messages` | `content` | mensagem do assistente | `429 ai_limit_reached` com `resets_at`; `503 ai_unavailable` |
| `POST /assistant/messages/{id}/proposal/saved` | `transaction_id` | `204` | marca a proposta como salva; a transação precisa ser do próprio usuário |
| `DELETE /assistant/conversations/{id}` | — | `204` | |
| `DELETE /assistant/conversations` | — | `204` | apaga todo o histórico (FR-069) |

Mensagem do assistente:

```json
{
  "id": "...",
  "role": "assistant",
  "kind": "answer",
  "content": "Você gastou R$ 842,30 com Alimentação em outubro de 2026.",
  "highlight": "R$ 842,30",
  "transactions": [ { "id": "...", "date": "2026-10-03", "description": "...", "amount_cents": 4590 } ],
  "transactions_total_count": 23,
  "proposal": null
}
```

`highlight` é o valor principal da resposta, já formatado, vindo dos resultados das ferramentas;
o frontend aplica o marca-texto à primeira ocorrência dele no texto. É nulo quando a resposta
não tem um valor principal.

Com `kind = "transaction_proposal"`, `proposal` traz `type`, `amount_cents`, `date`,
`description`, `account_id` e `category_id` (qualquer um pode ser nulo, para o usuário
completar); o frontend abre o formulário e salva com `POST /transactions` (FR-066, FR-067).

## Saúde (rotas públicas)

| Método e rota | Resposta |
|---------------|----------|
| `GET /health` | `200` se a API e o banco respondem; `503` caso contrário |
| `GET /health/worker` | `200` se o último batimento do worker tem menos de 60 s; `503` caso contrário |

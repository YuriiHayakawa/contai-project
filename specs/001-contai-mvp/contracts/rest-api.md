# Contrato: API REST

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

A referência final é o OpenAPI gerado pelo FastAPI em `/api/docs`. Este documento fixa o que os
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
| `POST /auth/login` | `email`, `password` | `200` com `access_token` e cookie de refresh, ou `200` com `two_factor_required` e `challenge_token` | `401 invalid_credentials` genérico; `423 account_locked` com `retry_after`; `403 email_not_verified` só com a senha correta |
| `POST /auth/login/2fa` | `challenge_token`, e `code` ou `recovery_code` | `200` com `access_token` e cookie | cancela pedido de desativação em aberto; erro conta para o bloqueio |
| `POST /auth/refresh` | cookie; cabeçalho `X-Contai-Client: web` | `200` com `access_token` e cookie novo | `401` se inválido, expirado ou reutilizado; confere `Origin` |
| `POST /auth/logout` | — (autenticada) | `204` e cookie apagado | |
| `POST /auth/password/forgot` | `email` | `202` genérico | |
| `POST /auth/password/reset` | `token`, `new_password` | `204` | encerra todas as sessões (FR-010) |
| `POST /auth/2fa/reset/request` | `challenge_token` | `202` | envia o link de pedido (FR-013) |
| `POST /auth/2fa/reset/confirm` | `token` | `200` com `effective_at` | abre a contagem de 72 horas |
| `POST /auth/2fa/reset/cancel` | `token` | `204` | |

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
| `GET /accounts` | `?include_archived=` | lista com `balance_cents` calculado | |
| `POST /accounts` | `name`, `type`, `institution`, `initial_balance_cents`, `initial_balance_date`, `closing_day`, `due_day` | conta | dias obrigatórios só para cartão |
| `GET /accounts/{id}` | — | conta | |
| `PATCH /accounts/{id}` | campos editáveis | conta | `type` só muda sem transações |
| `DELETE /accounts/{id}` | — | `204` | `409 account_has_transactions` (FR-022) |
| `POST /accounts/{id}/archive`, `/unarchive` | — | conta | |

## Categorias

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /categories` | `?include_archived=` | árvore de dois níveis por `kind` | |
| `POST /categories` | `name`, `kind`, `parent_id`, `icon`, `color` | categoria | `color` é um dos 8 nomes da paleta do design system; outro valor dá `422` |
| `PATCH /categories/{id}` | `name`, `icon`, `color` | categoria | mesma validação de `color` |
| `POST /categories/{id}/archive`, `/unarchive` | — | categoria | `409` para a categoria "Outros" |

## Transações

| Método e rota | Corpo ou filtros | Resposta | Notas |
|---------------|------------------|----------|-------|
| `GET /transactions` | `from`, `to`, `account_id`, `category_id` (inclui subcategorias), `type`, `q`, `installment_group_id`, `ids` | lista paginada, mais `total_count` | filtros combináveis (FR-035) |
| `POST /transactions` | `type` (`expense` ou `income`), `amount_cents`, `date`, `description`, `account_id`, `category_id`, `notes` | transação | grava ou atualiza a regra de categoria |
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

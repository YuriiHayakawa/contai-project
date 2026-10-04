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
`rate_limited` (429, com `Retry-After`), `payload_too_large` (413), `ai_limit_reached` (429,
o limite diário do usuário), `ai_quota_exhausted` (429, a cota do dia do serviço de IA acabou
para o app inteiro, no modelo principal e no reserva: volta no dia seguinte), `ai_unavailable`
(503), `internal_error` (500).

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
| `GET /transactions` | `from`, `to`, `account_id`, `category_id` (inclui subcategorias), `type`, `q`, `installment_group_id`, `transfer_group_id`, `ids` | lista paginada, mais `total_count` | filtros combináveis (FR-035); da mais nova para a mais antiga; `q` procura na descrição e na observação, sem diferenciar acentos nem maiúsculas; `ids` é repetido (`?ids=a&ids=b`) |
| `POST /transactions` | `type` (`expense` ou `income`), `amount_cents`, `date`, `description`, `account_id`, `category_id`, `notes`, `source` (opcional: `manual`, o padrão, ou `assistant`) | `201` com a transação | conta e categoria precisam ser do usuário e estar ativas, e a despesa precisa de uma categoria de despesa: caso contrário, `422` com a mensagem no campo. Uma receita aceita categoria de receita ou, como estorno de uma compra, de despesa (FR-084); grava ou atualiza a regra de categoria. `source = assistant` é o lançamento conferido a partir de uma proposta do assistente (FR-066); `import` não é aceito aqui |
| `POST /transactions/installments` | `total_cents`, `installments` (2 a 48), `date`, `description`, `account_id`, `category_id`, `notes` | `201` com `{ "items": [...] }`, as parcelas em ordem | conta precisa ser cartão (FR-030); a primeira parcela leva os centavos que sobram; a parcela k tem a data da compra mais k − 1 meses, no último dia do mês quando o dia não existe |
| `POST /transactions/transfers` | `from_account_id`, `to_account_id`, `amount_cents`, `date`, `description` | `201` com `{ "items": [...] }`: a linha `out` e a `in` | contas diferentes e ativas (FR-033); o pagamento da fatura é uma transferência da conta para o cartão |
| `GET /transactions/{id}` | — | transação | |
| `PATCH /transactions/{id}` | campos editáveis; `?scope=single` ou `following` | transação ou lista | `scope` vale para parcelas (FR-032): `single` muda só esta, `following` muda esta e as seguintes e devolve a lista; transferência edita os dois lados; em despesa e receita, também grava ou atualiza a regra de categoria (FR-048) |
| `DELETE /transactions/{id}` | `?scope=single` ou `following` | `204` | em parcelas, `following` exclui esta e as seguintes; transferência exclui os dois lados |

## Importações

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `POST /imports` | `multipart`: `file`, `account_id`, `kind` (`statement` ou `receipt`; padrão `statement`) | `202` com a importação em `queued` | `statement` é um extrato ou uma fatura (OFX, CSV, planilha ou PDF); `receipt` é um comprovante, em foto (JPG ou PNG) ou PDF, que vira uma linha só. `413`; `415 unsupported_file` (vazio, tipo não aceito pelo conteúdo, `.xls` antigo ou PDF protegido por senha); `422` em `account_id` para conta de outro usuário, inexistente ou arquivada; `422` em `kind` quando o arquivo não serve para o que foi escolhido (foto como extrato, OFX como comprovante); `429 rate_limited` pelo limite de envios. PDF e imagem são lidos por um serviço de IA externo: `403 ai_consent_required` sem o aceite do aviso (FR-044) e `429 ai_limit_reached`, com `resets_at`, no limite diário de extrações, que conta os documentos já lidos hoje e os que estão na fila. Nesses dois casos nada é guardado |
| `GET /imports` | `?limit=` e `?cursor=` | histórico paginado, da importação mais nova para a mais antiga (FR-051), sem `items` nem `mapping_preview` | uma importação expirada aparece como `failed`, com `error_code` em `mapping_expired` ou `review_expired` (FR-083) |
| `GET /imports/{id}` | — | importação; em `awaiting_mapping`, traz `mapping_preview` e a sugestão de colunas; em `awaiting_review`, traz `items`, `total_check` e `balance_check`; nos dois estados traz `expires_at` (FR-083) | é a rota consultada periodicamente pelo frontend |
| `POST /imports/{id}/mapping` | `date_column`, `description_column` e `amount_column` (ou `income_column` e `expense_column`), pela posição da coluna a partir de zero; `date_format` (`dmy`, `mdy`, `ymd`); `decimal_separator` (`,` ou `.`); `sign_convention` (`negative_is_expense` ou `positive_is_expense`) | `202`, volta para `queued` | salva o modelo (FR-039); `409 import_not_awaiting_mapping` fora de `awaiting_mapping`; `422` com o campo a corrigir. Se o modelo não ler o arquivo, a importação volta a `awaiting_mapping` com `error_code = mapping_mismatch`, sem novo envio |
| `PATCH /imports/{id}/items/{item_id}` | os campos a mudar na linha, entre `selected`, `type`, `amount_cents`, `date`, `description`, `category_id` e `counter_account_id` | a linha, como fica guardada | guarda a correção na hora, para a revisão poder ser retomada (FR-085); nada vira transação antes da confirmação. Só os campos enviados mudam; `null` em `category_id` ou `counter_account_id` desfaz a escolha. `type` respeita o sentido da linha no extrato: uma saída é `expense` ou `transfer`, e uma entrada, `income` ou `transfer`. `422` com o campo a corrigir, sem gravar nenhum; `404` para linha que não é da importação; `409 import_not_awaiting_review` fora de `awaiting_review` |
| `PATCH /imports/{id}/items` | `selected` | `204` | marca ou desmarca todas as linhas da revisão de uma vez (FR-085); `409 import_not_awaiting_review` fora de `awaiting_review` |
| `POST /imports/{id}/confirm` | `items`: lista de `{ id, selected, type, amount_cents, date, description, category_id, counter_account_id }`, com todas as linhas da revisão, cada uma uma vez | importação em `completed` com `imported_count`, o número de linhas salvas | tudo em uma transação de banco (FR-046). Só as linhas marcadas são conferidas e salvas: despesa e receita pedem `category_id`; transferência pede `counter_account_id` e cria os dois lados. O `type` segue a mesma regra da correção de uma linha, em toda linha que o traz, marcada ou não: não inverte o sentido do dinheiro no extrato (uma saída é `expense` ou `transfer`, e uma entrada, `income` ou `transfer`). `422` com o campo a corrigir em `items.N.campo`, ou em `items` se a lista não corresponde às linhas da importação; `409 import_not_awaiting_review` fora de `awaiting_review`; `409 account_archived` se a conta de destino foi arquivada. Uma categoria diferente da sugerida grava a regra de categoria (FR-048) |
| `POST /imports/{id}/undo` | — | importação em `undone` | remove todas as transações dela de uma vez (FR-052); `409 import_not_completed` fora de `completed` |
| `DELETE /imports/{id}` | — | `204` | descarta uma importação ainda não confirmada, com o arquivo e as linhas propostas; `409 import_already_confirmed` em `completed` e `undone` |

A importação traz `status`, `error_code` e `error_message` (o que fazer, em português),
`item_count`, `imported_count`, `expires_at` e `already_imported_at` (quando o mesmo arquivo já
foi importado na conta). Em PDF e imagem, `failed` pode vir com `document_unreadable` (o modelo
não reconheceu lançamentos, ou a resposta dele não pôde ser usada), `ai_quota_exhausted` (a
cota do dia do serviço de IA acabou, no modelo principal e no reserva: volta no dia seguinte, e
não há nova tentativa) ou `ai_unavailable` (o serviço não respondeu depois das tentativas).
Enquanto o serviço de IA está ocupado, a importação continua em `queued` ou `processing` com
`error_code = ai_busy` e a mensagem de que a leitura será tentada de novo, sem reenvio do
arquivo (FR-072): não é uma falha, só explica a espera. `mapping_preview`: `{ "columns", "rows", "suggestion" }`, com as
primeiras linhas como estão no arquivo e o palpite no formato do corpo do mapeamento. Cada item
de `items` traz `id`, `row_index`, `type`, `amount_cents`, `date`, `description`,
`suggested_category_id`, `category_source`, `suggested_counter_account_id`, `duplicate_status`,
`duplicate_of_id`, `selected_by_default`, `selected`, `category_id`, `counter_account_id`,
`warning_code` e `warning_message`. O aviso, com o que fazer, hoje é só
`invoice_payment_without_card`: a linha parece o pagamento de uma fatura e ficou como despesa
porque não há cartão cadastrado (FR-081).

`selected`, `category_id` e `counter_account_id` dizem como a linha está na revisão agora:
começam iguais à sugestão (`selected_by_default`, `suggested_category_id` e
`suggested_counter_account_id`, que não mudam) e guardam o que o usuário decidiu. `type`,
`amount_cents`, `date` e `description` trazem o valor corrigido, quando houve correção. O corpo
da confirmação continua sendo a decisão final: a tela envia nele o que está guardado.

`total_check`: `{ "document_total_cents", "extracted_total_cents", "matches" }` ou nulo: só
existe quando o documento traz um total impresso (FR-043). `extracted_total_cents` é a soma das
linhas lidas, com as saídas somando e as entradas abatendo, como no total de uma fatura; é
calculada na leitura e não muda com as correções da revisão.
`balance_check`: `{ "bank_balance_cents", "bank_balance_date", "account_balance_cents",
"counted_from", "computed_balance_cents", "matches" }` ou nulo. `account_balance_cents` é o saldo
da conta na data do saldo do banco, sem as linhas do arquivo; `computed_balance_cents` soma a
ele as linhas marcadas (`selected`) que têm data de `counted_from` (a data de referência do
saldo inicial) até `bank_balance_date`. Quando o usuário marca ou desmarca uma linha, a tela
refaz essa soma na hora. Depois da confirmação, vale o saldo da conta nessa data. É nulo quando o arquivo não
informa o saldo ou quando a data dele é anterior à data de referência da conta.

## Painel

Todas aceitam `month=YYYY-MM`; sem ele, vale o mês atual no fuso de Brasília. O painel não aceita
intervalo de datas (FR-059); períodos personalizados são atendidos pelo assistente.

| Método e rota | Resposta |
|---------------|----------|
| `GET /dashboard/summary` | `income_cents`, `expense_cents`, `net_cents` e o saldo de cada conta ativa (FR-055). O estorno, que é uma receita em categoria de despesa, abate `expense_cents` e não entra em `income_cents` (FR-084) |
| `GET /dashboard/categories` | gastos por categoria, com subcategorias, valor e percentual (FR-056). O valor é o das despesas menos os estornos: a categoria em que os dois se anulam não aparece, e a que fica negativa vem no fim, com percentual zero. O percentual é a parte da categoria no que foi gasto, e `total_cents` é igual a `expense_cents` do resumo (FR-084) |
| `GET /dashboard/trend?months=6&until=YYYY-MM` | entradas e saídas por mês (FR-057) |
| `GET /dashboard/top-expenses?limit=5` | maiores despesas do período (FR-057) |
| `GET /dashboard/cards` | por cartão ativo: fatura atual (período, fechamento, vencimento, valor de compras menos estornos) e parcelas futuras por mês de vencimento da fatura e no total (FR-058); no mês atual a fatura é a que contém hoje, e em um mês passado, a que estava aberta no último dia dele. `payment`, sempre visto de hoje: `closed_invoice` (fechamento, vencimento e o que falta pagar da última fatura fechada, ou `null` se as fechadas estão pagas) e `total_due_cents` (tudo o que se deve no cartão), para o "Pagar fatura" (FR-033) |

Transferências nunca entram em `income_cents` nem em `expense_cents`.

## Assistente

| Método e rota | Corpo | Resposta | Notas |
|---------------|-------|----------|-------|
| `GET /assistant/suggestions` | — | lista de perguntas sugeridas (FR-070) | texto fixo, sem IA |
| `GET /assistant/usage` | — | `used`, `limit`, `remaining` e `resets_at` | perguntas de hoje; zera à meia-noite de Brasília |
| `GET /assistant/conversations` | `?limit=` e `?cursor=` | lista paginada, da conversa com atividade mais recente para a mais antiga, sem as mensagens | `title` é o começo da primeira pergunta |
| `POST /assistant/conversations` | — | `201` com a conversa | |
| `GET /assistant/conversations/{id}` | — | conversa com `messages`, da mais antiga para a mais nova | |
| `POST /assistant/conversations/{id}/messages` | `content` (1 a 1.000 caracteres) | mensagem do assistente | `429 ai_limit_reached` com `resets_at`; `429 ai_quota_exhausted`; `503 ai_unavailable`; `429 rate_limited`. Em qualquer um desses casos nada é gravado: nem a pergunta, nem o uso do dia |
| `POST /assistant/messages/{id}/proposal/saved` | `transaction_id` | `204` | marca a proposta como salva e copia para ela os campos do lançamento gravado; a transação precisa ser do próprio usuário (`422` no campo, caso contrário); `404` se a mensagem não é uma proposta do usuário |
| `POST /assistant/messages/{id}/proposal/discarded` | — | `204` | descarta a proposta; nada é salvo. Uma proposta já salva continua salva; `404` se a mensagem não é uma proposta do usuário |
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
  "transactions": [ { "id": "...", "type": "expense", "date": "2026-10-03", "description": "...", "amount_cents": 4590, "account_id": "...", "to_account_id": null, "category_id": "..." } ],
  "transactions_total_count": 23,
  "proposal": null
}
```

`highlight` é o valor principal da resposta, como está escrito no texto e conferido contra os
resultados das ferramentas; o frontend aplica o marca-texto à primeira ocorrência dele no texto.
É nulo quando a resposta não tem um valor principal. `transactions` traz até 50 das transações
que compõem a resposta, das que ainda existem, e `transactions_total_count`, quantas são ao
todo. Cada uma traz `account_id` e `category_id`. Uma transferência aparece uma vez: `account_id`
é a conta de onde o dinheiro saiu, `to_account_id`, a conta em que entrou, e `category_id` é
nulo.

Com `kind = "transaction_proposal"`, `proposal` traz `type`, `amount_cents`, `date`,
`description`, `account_id` e `category_id` (a conta e a categoria podem ser nulas, para o
usuário escolher), `category_source` (`user_rule` quando a categoria veio de uma regra que o
usuário ensinou, `ai` quando foi sugerida pela IA, ou nulo), `status` (`pending`, `saved` ou
`discarded`) e `transaction_id` (o lançamento, depois de salva). O texto da mensagem é fixo, e
o modelo é chamado uma vez só. O frontend mostra a proposta em um cartão. Com a conta e a
categoria definidas, "Salvar" grava a proposta como está; "Ajustar" abre o formulário
preenchido, e com um campo em aberto só há "Ajustar". Nos dois caminhos o lançamento nasce de
`POST /transactions` com `source = assistant`, e a proposta é marcada com
`POST /assistant/messages/{id}/proposal/saved` (FR-066, FR-067). Uma frase sem valor não gera
proposta: o assistente pergunta o valor (`clarification`).

## Saúde (rotas públicas)

| Método e rota | Resposta |
|---------------|----------|
| `GET /health` | `200` se a API e o banco respondem; `503` caso contrário |
| `GET /health/worker` | `200` se o último batimento do worker tem menos de 60 s; `503` caso contrário |

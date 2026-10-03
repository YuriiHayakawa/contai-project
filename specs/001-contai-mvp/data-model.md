# Data Model: Contaí

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-01

## Convenções

- Chaves primárias são UUID gerados pelo banco.
- Toda tabela de dados do usuário tem `user_id` com `ON DELETE CASCADE` para `users`, e todo
  método de repositório recebe `user_id` obrigatoriamente (Princípio III).
- Dinheiro é sempre `BIGINT` em centavos; os nomes terminam em `_cents`.
- Datas de transação são `DATE`; instantes são `timestamptz` em UTC e terminam em `_at`.
- Enums são colunas de texto com `CHECK`, declaradas como `StrEnum` no Python.
- Toda tabela tem `created_at`; as editáveis têm também `updated_at`.
- "Arquivado" é representado por `archived_at` preenchido.

## Visão geral

```text
users ─┬─ sessions
       ├─ email_tokens
       ├─ recovery_codes
       ├─ two_factor_reset_requests
       ├─ accounts ──────────────┐
       ├─ categories (pai/filha) │
       ├─ transactions ──────────┤ account_id, category_id, import_id
       ├─ imports ── import_items┘
       ├─ import_templates
       ├─ categorization_rules
       ├─ conversations ── chat_messages
       ├─ ai_usage
       └─ jobs (user_id opcional)

worker_heartbeats (sem usuário)
login_attempts (sem usuário: contadas por e-mail informado)
```

## Identidade e acesso

### users

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `name` | texto | 1 a 100 caracteres |
| `email` | texto | guardado em minúsculas; único |
| `password_hash` | texto | Argon2id |
| `email_verified_at` | timestamptz | nulo até confirmar; sem ele nada é acessível (FR-005) |
| `status` | enum | `active`, `pending_deletion` |
| `deletion_requested_at` | timestamptz | preenchido no pedido de exclusão |
| `deletion_scheduled_at` | timestamptz | pedido + 7 dias (FR-017) |
| `totp_secret_encrypted` | texto | cifrado; nulo sem duas etapas |
| `totp_enabled_at` | timestamptz | nulo enquanto as duas etapas não estão ativas |
| `totp_last_used_step` | inteiro | impede reuso do mesmo código |
| `privacy_policy_version` | texto | versão aceita no cadastro (FR-001) |
| `privacy_policy_accepted_at` | timestamptz | obrigatório |
| `ai_documents_consent_at` | timestamptz | aceite do aviso antes do primeiro PDF ou imagem (FR-044) |

**Transições de `status`**: `active → pending_deletion` no pedido de exclusão;
`pending_deletion → active` se o usuário cancelar em até 7 dias; no prazo, a linha é apagada e
leva tudo em cascata.

### sessions

Uma linha por dispositivo conectado; é também a família de rotação do refresh token.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK; faz parte do refresh token |
| `user_id` | UUID | FK |
| `refresh_token_hash` | texto | SHA-256 do segredo atual; trocado a cada refresh |
| `user_agent` | texto | para a tela de sessões; truncado |
| `ip` | texto | do último uso |
| `last_used_at` | timestamptz | atualizado a cada refresh |
| `expires_at` | timestamptz | último uso + 30 dias (FR-006) |
| `revoked_at` | timestamptz | preenchido ao encerrar |
| `revoked_reason` | enum | `logout`, `user_revoked`, `password_changed`, `password_reset`, `token_reuse`, `two_factor_reset`, `account_deletion` |

**Regra**: um refresh com segredo diferente do atual revoga a sessão com `token_reuse`.

### email_tokens

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `type` | enum | `email_verification`, `password_reset`, `two_factor_reset_confirm`, `two_factor_reset_cancel` |
| `token_hash` | texto | SHA-256; único |
| `expires_at` | timestamptz | 24 h para confirmação; 1 h para redefinição e para o pedido de desativação; 72 h para o cancelamento |
| `used_at` | timestamptz | uso único (FR-004, FR-010) |

Emitir um token novo do mesmo tipo invalida os anteriores do usuário.

### login_attempts

Erros seguidos de login por e-mail informado. A linha existe também para e-mails sem conta:
contar igual nos dois casos é o que impede o bloqueio de revelar quais e-mails estão
cadastrados (FR-008). Por isso a tabela não tem `user_id`.

| Campo | Tipo | Regras |
|-------|------|--------|
| `email_hash` | texto | PK; SHA-256 do e-mail normalizado (o endereço em si não é guardado) |
| `failed_count` | inteiro | erros seguidos; volta a zero ao bloquear |
| `locked_until` | timestamptz | agora + 15 min ao chegar a 5 erros (FR-009) |
| `last_failed_at` | timestamptz | instante do último erro |

A linha é apagada no login correto e na redefinição de senha. O worker apaga, a cada hora, as
linhas sem erro há mais de 24 horas e sem bloqueio em curso.

### recovery_codes

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `code_hash` | texto | SHA-256 |
| `used_at` | timestamptz | uso único |

Sempre 10 por usuário; gerar novos apaga os anteriores (FR-011).

### two_factor_reset_requests

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK; no máximo um pedido em aberto por usuário |
| `requested_at` | timestamptz | |
| `effective_at` | timestamptz | pedido + 72 h (FR-013) |
| `reminder_sent_at` | timestamptz | lembrete 24 h antes |
| `cancelled_at` | timestamptz | pelo link de cancelamento ou por login com código válido |
| `applied_at` | timestamptz | quando o worker desativa as duas etapas e encerra as sessões |

**Estados**: em aberto → cancelado ou aplicado.

## Finanças

### accounts

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `type` | enum | `checking`, `credit_card`, `cash`, `savings`, `investment` (FR-019) |
| `name` | texto | 1 a 60 caracteres; único entre as contas ativas do usuário |
| `institution` | texto | opcional |
| `initial_balance_cents` | BIGINT | com sinal; a dívida inicial de um cartão é negativa |
| `initial_balance_date` | DATE | data de referência; padrão, o dia do cadastro (FR-019) |
| `closing_day` | inteiro | 1 a 31; obrigatório para cartão, nulo nos demais (FR-020) |
| `due_day` | inteiro | 1 a 31; obrigatório para cartão, nulo nos demais |
| `archived_at` | timestamptz | arquivada não recebe lançamentos novos (FR-021) |

**Regras**: só pode ser apagada se não tiver transações (FR-022). O tipo não pode mudar depois
que a conta tem transações.

**Saldo (derivado, FR-023)**:
`initial_balance_cents + receitas − despesas + transferências in − transferências out`, somando
as transações com `initial_balance_date <= date <= hoje`.

### categories

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `name` | texto | 1 a 40 caracteres; único entre irmãs ativas |
| `kind` | enum | `expense`, `income` |
| `parent_id` | UUID | FK para `categories`; a mãe não pode ter mãe (dois níveis) e tem o mesmo `kind` |
| `icon` | texto | nome de um ícone do conjunto adotado (FR-025) |
| `color` | texto | nome de uma das 8 cores de categoria do design system (`tinta`, `caqui`, `piscina`, `mostarda`, `goiaba`, `mata`, `ameixa`, `pitanga`); `ardosia` só na categoria "Outros"; qualquer outro valor é recusado |
| `is_fallback` | booleano | marca a "Outros" de cada `kind`; não pode ser arquivada |
| `archived_at` | timestamptz | arquivada some das opções, mas fica nas transações (FR-026) |

As categorias padrão (FR-024) são criadas na mesma transação que confirma o e-mail do usuário.
Arquivar uma categoria mãe arquiva as filhas.

### transactions

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `account_id` | UUID | FK, `ON DELETE RESTRICT` |
| `type` | enum | `expense`, `income`, `transfer` |
| `transfer_direction` | enum | `out`, `in`; obrigatório se `type = transfer`, nulo nos demais |
| `amount_cents` | BIGINT | sempre maior que zero |
| `date` | DATE | |
| `description` | texto | 1 a 200 caracteres |
| `description_normalized` | texto | para regras de categoria e duplicatas |
| `notes` | texto | opcional (FR-027) |
| `category_id` | UUID | FK; obrigatório para despesa e receita, nulo para transferência; `kind` compatível com `type` |
| `transfer_group_id` | UUID | liga as duas linhas de uma transferência |
| `installment_group_id` | UUID | liga as parcelas de uma compra |
| `installment_number` | inteiro | de 1 a `installment_count` |
| `installment_count` | inteiro | de 2 a 48 (FR-030) |
| `import_id` | UUID | FK para `imports`, `ON DELETE SET NULL`; origem da linha |
| `external_id` | texto | identificador do banco (por exemplo, o FITID do OFX) |
| `fingerprint` | texto | hash de conta, data, tipo, valor e descrição normalizada |
| `source` | enum | `manual`, `import`, `assistant` |

**Índices**: `(user_id, date)`; `(user_id, account_id, date)`; `(user_id, category_id, date)`;
`(user_id, account_id, fingerprint)`; `(import_id)`; único parcial em
`(account_id, external_id)` onde `external_id` não é nulo.

**Regras**:

- Transferência: sempre duas linhas com o mesmo `transfer_group_id`, mesmo valor e mesma data,
  uma `out` e uma `in`, em contas diferentes do mesmo usuário; criar, editar e apagar valem para
  as duas (FR-033, FR-034). Nunca entra em totais de receita ou despesa.
- Compra parcelada: só em conta `credit_card`; `total // n` por parcela, com o resto de centavos
  na primeira; a parcela k tem a data da compra deslocada em k − 1 meses, no último dia do
  mês quando o dia não existe nele. Edição e exclusão aceitam o escopo "só esta" ou "esta e as
  seguintes"; as anteriores nunca mudam (FR-032).
- A conta e a categoria de uma transação nova precisam estar ativas.
- Fatura (derivada): ver a seção 17 de [research.md](./research.md).

## Importação

### imports

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `account_id` | UUID | FK, `ON DELETE CASCADE`; conta de destino (FR-036). Só uma conta sem transações pode ser excluída, e o histórico de importações dela vai junto |
| `kind` | enum | `statement` (extrato ou fatura), `receipt` (comprovante) |
| `format` | enum | `ofx`, `csv`, `xlsx`, `pdf`, `image` |
| `original_filename` | texto | só para o histórico; nunca vai para logs |
| `file_hash` | texto | SHA-256 do arquivo; avisa reimportação |
| `stored_filename` | texto | nome gerado no volume privado; nulo depois de apagado (FR-053) |
| `status` | enum | `queued`, `processing`, `awaiting_mapping`, `awaiting_review`, `completed`, `undone`, `failed` |
| `error_code` | texto | motivo da falha, em código: `unreadable`, `no_transactions`, `multiple_accounts`, `too_many_rows`, `file_missing`, `processing_error`, `mapping_expired`, `review_expired`. Em `awaiting_mapping`, `mapping_mismatch` diz que o modelo enviado não leu o arquivo |
| `template_id` | UUID | FK para `import_templates`; modelo aplicado |
| `mapping_preview` | JSONB | cabeçalho e primeiras linhas para a tela de mapeamento; apagado depois |
| `document_total_cents` | BIGINT | total impresso no documento, quando houver (FR-043) |
| `extracted_total_cents` | BIGINT | soma das linhas extraídas |
| `bank_balance_cents` | BIGINT | saldo informado pelo arquivo, quando houver (FR-082) |
| `bank_balance_date` | DATE | data do saldo informado |
| `item_count` | inteiro | linhas propostas |
| `imported_count` | inteiro | linhas salvas na confirmação; uma linha salva como transferência conta uma vez, embora crie as duas transações dela |
| `waiting_since` | timestamptz | desde quando espera o usuário (mapeamento ou revisão); base do prazo do FR-083 |
| `completed_at`, `undone_at` | timestamptz | |

**Transições**:

```text
queued → processing → awaiting_review → completed → undone
              │              ↑
              ├→ awaiting_mapping (CSV/planilha sem modelo) → queued (após o mapeamento)
              └→ failed
queued → awaiting_mapping (mapping_mismatch: o modelo enviado não leu o arquivo)
awaiting_mapping → failed (mapping_expired, após 24 h)
awaiting_review → failed (review_expired, após 7 dias sem confirmação)
```

A divergência de total é `document_total_cents != extracted_total_cents`. A divergência de saldo
é calculada na leitura, comparando `bank_balance_cents` com o saldo da conta em
`bank_balance_date`; não é feita se essa data for anterior à data de referência da conta.

### import_items

Transações propostas, existentes só entre o processamento e a confirmação.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `import_id` | UUID | FK, `ON DELETE CASCADE` |
| `user_id` | UUID | FK |
| `row_index` | inteiro | ordem no documento |
| `type` | enum | `expense`, `income`, `transfer` |
| `transfer_direction` | enum | preenchido quando sugerido como transferência |
| `amount_cents` | BIGINT | maior que zero |
| `date` | DATE | |
| `description` | texto | |
| `description_normalized` | texto | |
| `suggested_category_id` | UUID | FK (FR-047) |
| `category_source` | enum | `user_rule`, `ai`, `fallback`; nulo em transferência |
| `suggested_counter_account_id` | UUID | cartão ou conta sugerida em pagamento de fatura (FR-081) |
| `external_id` | texto | |
| `fingerprint` | texto | |
| `duplicate_status` | enum | `none`, `exact`, `probable` (FR-049) |
| `duplicate_of_id` | UUID | transação existente que motivou o aviso |
| `selected_by_default` | booleano | falso para `exact` e `probable` |

### import_templates

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `header_signature` | texto | hash dos nomes de colunas normalizados; único por usuário |
| `mapping` | JSONB | colunas de data, descrição e valor (ou entrada e saída), pela posição; formato de data (`dmy`, `mdy`, `ymd`), separador decimal e convenção de sinal. As linhas de título antes do cabeçalho são puladas sozinhas, e por isso não fazem parte do modelo |
| `last_used_at` | timestamptz | |

### categorization_rules

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `description_normalized` | texto | único por usuário |
| `category_id` | UUID | FK, `ON DELETE CASCADE` |
| `source` | enum | `user` (correção do usuário), `ai` (cache de sugestão) |

Uma regra `user` nunca é substituída por uma `ai` (FR-048). Regras que apontam para categoria
arquivada são ignoradas.

## Assistente

### conversations

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `title` | texto | começo da primeira pergunta, truncado |

### chat_messages

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `conversation_id` | UUID | FK, `ON DELETE CASCADE` |
| `user_id` | UUID | FK |
| `role` | enum | `user`, `assistant` |
| `kind` | enum | `text`, `answer`, `clarification`, `refusal`, `transaction_proposal`, `error` |
| `content` | texto | texto exibido |
| `transaction_ids` | JSONB | ids das transações que compõem a resposta, vindos das ferramentas (FR-063) |
| `tool_calls` | JSONB | nome e parâmetros das ferramentas chamadas, para dar contexto às continuações (FR-064); sem resultados |
| `proposal` | JSONB | transação proposta no lançamento por texto (FR-066) |

### ai_usage

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK |
| `task` | enum | `chat`, `text_entry`, `categorization`, `statement_extraction`, `receipt_extraction` |
| `model` | texto | id do modelo usado |
| `input_tokens`, `output_tokens` | inteiro | |
| `counts_toward_limit` | booleano | verdadeiro em uma linha por pergunta ou por extração |
| `usage_date` | DATE | dia no fuso de Brasília |

**Limites (FR-071)**: por usuário e `usage_date`, no máximo 30 linhas contáveis de `chat` e
`text_entry` somadas e 10 de extração; valores vindos das configurações.

## Infraestrutura

### jobs

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | UUID | PK |
| `user_id` | UUID | FK opcional, `ON DELETE CASCADE` |
| `type` | enum | `process_import`, `send_email` |
| `payload` | JSONB | somente identificadores e tipos; nunca conteúdo, descrição ou valor |
| `status` | enum | `queued`, `running`, `succeeded`, `failed` |
| `attempts`, `max_attempts` | inteiro | |
| `run_at` | timestamptz | próxima execução (backoff) |
| `locked_at` | timestamptz | job travado além do tempo limite volta para `queued` |
| `last_error_code` | texto | código, sem mensagem livre |

**Índice**: parcial em `(run_at)` onde `status = 'queued'`.

### worker_heartbeats

| Campo | Tipo | Regras |
|-------|------|--------|
| `worker_id` | texto | PK |
| `last_seen_at` | timestamptz | base do health check do worker |

## Rastreabilidade com a spec

| Entidade da spec | Tabelas |
|------------------|---------|
| Usuário | `users`, `email_tokens`, `recovery_codes`, `two_factor_reset_requests` |
| Sessão | `sessions` |
| Conta financeira | `accounts` |
| Categoria | `categories` |
| Transação, Compra parcelada, Transferência | `transactions` (grupos por `installment_group_id` e `transfer_group_id`) |
| Fatura | derivada de `transactions` e `accounts` |
| Importação | `imports` |
| Transação proposta | `import_items`; no lançamento por texto, `chat_messages.proposal` |
| Modelo de colunas | `import_templates` |
| Regra de categorização | `categorization_rules` |
| Conversa | `conversations`, `chat_messages` |
| Uso de IA | `ai_usage` |

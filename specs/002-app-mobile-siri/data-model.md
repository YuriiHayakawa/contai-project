# Data Model: App mobile do Contaí e lançamento por voz pela Siri

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Todas as mudanças no banco entram numa única migração Alembic, aplicada no deploy (Princípio
XII). As tabelas que não aparecem aqui não mudam.

## sessions (alterada)

| Campo | Tipo | Regra |
|-------|------|-------|
| `client` | `VARCHAR(10)` NOT NULL, default `'web'` | `CHECK (client IN ('web', 'mobile'))`. As linhas que já existem ficam `web`. |

- O refresh do site (`/auth/refresh`) só aceita sessões `web`, e o do app (`/auth/mobile/refresh`)
  só aceita sessões `mobile`. Um token apresentado no endpoint errado recebe 401 e não conta
  como reutilização. Contar como reutilização revogaria a sessão por engano de cliente.
- A tela de sessões do site mostra `client`. Uma sessão `mobile` aparece como "App do Contaí", ao
  lado do aparelho tirado do user agent.
- As regras de rotação, reutilização, expiração em 30 dias e revogação não mudam (ADR 0002).

## personal_tokens (nova)

| Campo | Tipo | Regra |
|-------|------|-------|
| `id` | `UUID` PK | Também é a parte pública do token: `ctp_<id>.<segredo>` |
| `user_id` | `UUID` FK `users.id` ON DELETE CASCADE | Índice |
| `name` | `VARCHAR(60)` NOT NULL | Entre 1 e 60 caracteres, sem espaços nas pontas |
| `secret_hash` | `CHAR(64)` NOT NULL | SHA-256 em hexadecimal do segredo de 32 bytes |
| `default_account_id` | `UUID` FK `accounts.id` ON DELETE SET NULL, NULL | Precisa ser uma conta do mesmo usuário. O serviço confere, e o repositório filtra por `user_id`. |
| `created_at` | `timestamptz` NOT NULL | |
| `last_used_at` | `timestamptz` NULL | Atualizado no máximo uma vez por minuto |
| `revoked_at` | `timestamptz` NULL | |
| `revoked_reason` | `VARCHAR(30)` NULL | `CHECK` com `user_revoked`, `password_changed` e `password_reset` |

**Índice**: `ix_personal_tokens_user_active` em `(user_id)` `WHERE revoked_at IS NULL`.

**Regras**

- No máximo 5 tokens ativos por usuário. O serviço confere dentro da transação, com a linha do
  usuário travada.
- Um token é ativo quando `revoked_at IS NULL`. A revogação não pode ser desfeita.
- "Precisa de conta padrão" é uma informação calculada para a tela. Vale quando
  `default_account_id` é nulo ou aponta para uma conta arquivada (`archived_at` preenchido).
- Tokens revogados ficam guardados por 30 dias, para auditoria do motivo, como as sessões. A
  limpeza entra na tarefa periódica que já limpa sessões revogadas.

**Estados**

```text
ativo ──(usuário revoga)────────────▶ revogado (user_revoked)
ativo ──(troca de senha)────────────▶ revogado (password_changed)
ativo ──(redefinição de senha)──────▶ revogado (password_reset)
qualquer ──(exclusão da conta)──────▶ apagado (cascade)
```

## transactions (alterada)

| Campo | Mudança |
|-------|---------|
| `source` | O `CHECK` `source_valid` ganha `'voice'`, ao lado de `manual`, `import` e `assistant`. A origem nunca muda numa edição. |
| `voice_phrase` | `TEXT` NULL, novo. É a frase que a Siri entendeu, com até 300 caracteres. |

**Restrições novas**

- `CHECK (voice_phrase IS NULL OR source = 'voice')`
- `CHECK (source <> 'voice' OR voice_phrase IS NOT NULL)`
- `CHECK (voice_phrase IS NULL OR char_length(voice_phrase) <= 300)`

**Regras**

- Só o endpoint de voz cria lançamentos com `source = 'voice'`. Os schemas de criação e edição
  não aceitam `source` nem `voice_phrase`.
- Editar um lançamento por voz mantém a origem e a frase original (FR-028 e FR-028a).
- `voice_phrase` entra no `TransactionRead` e na exportação de dados (`users/export.py`), e nunca
  em logs (Princípio V).
- Lançamentos por voz são sempre despesa ou receita: nunca transferência, nem parcela.

## ai_usage (alterada só no enum)

- `AiTask` ganha `VOICE_ENTRY`, contado no balde `LimitKind.QUESTION`, junto com `CHAT` e
  `TEXT_ENTRY`. A tela de uso do site e do app mostra as perguntas como antes, agora com a voz
  incluída.
- Toda chamada autenticada ao endpoint de voz registra uso `VOICE_ENTRY` com
  `counts_toward_limit=True`, porque a constituição diz que cada chamada conta (Princípio XV,
  FR-026).
  - Isso vale para as chamadas que passaram da conferência da cota e do limite por hora.
  - Vale também para a frase descartada pelo prazo antes de chamar a IA. Nesse caso o registro
    leva `model="none"` e uso zero de tokens.
  - Não registram uso as chamadas recusadas antes disso: token inválido, cota esgotada e limite
    por hora.

## Token de restauração (não é guardado)

É um JWT HS256 assinado com o segredo de JWT que já existe. Ele não é uma tabela: vive só na
resposta do desfazer e no pedido de refazer.

| Declaração | Valor |
|------------|-------|
| `aud` | `"voice-restore"`. O `get_current_user` recusa qualquer `aud` diferente do access token. |
| `sub` | id do usuário |
| `exp` | emissão + 15 s |
| `txn` | A linha inteira da transação: `id`, `account_id`, `category_id`, `type`, `amount_cents`, `date`, `description`, `note`, `source`, `voice_phrase`, `created_at`, `updated_at` |

O token vai só para o dono, por HTTPS, e nunca é registrado em log. Ele contém dados que o
próprio dono já via na tela.

## Dados locais do app (aparelho)

| Onde | Chave | Conteúdo |
|------|-------|----------|
| `expo-secure-store` (Keychain, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) | `contai.refresh_token` | Refresh token da sessão `mobile` |
| `expo-secure-store` | `contai.prefs` | JSON com preferências: lembretes ativados e proteção por biometria (P2) |
| memória | — | Access token, cache do TanStack Query, que não é persistido |
| `expo-notifications`, agenda local (P2) | `invoice-reminder:<card_id>:<due_date>` | Lembrete de fatura. Todos são cancelados ao sair da conta. |

Nada financeiro é gravado no aparelho. O cache de consultas vive só em memória e some ao fechar
o app (modo offline está fora do escopo).

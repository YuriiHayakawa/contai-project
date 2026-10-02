# ADR 0009: módulo `categorization` como domínio do backend

- **Situação**: aceito
- **Data**: 2026-10-01
- **Emenda relacionada**: constituição 1.0.0 → 1.0.1 (Princípio III, Arquitetura — Backend)

## Contexto

O Princípio III da constituição lista os domínios em que o backend é organizado. Na versão
1.0.0 a lista era `auth`, `users`, `accounts`, `categories`, `transactions`, `imports`,
`dashboard` e `assistant`.

O plano da feature `001-contai-mvp` precisa de um lugar para a sugestão de categoria: as regras
aprendidas com as correções do usuário e a consulta à IA quando nenhuma regra serve. Três
módulos usam essa sugestão:

- `imports`, para propor a categoria de cada linha importada;
- `transactions`, para aprender quando o usuário cria ou corrige um lançamento;
- `assistant`, para o lançamento escrito em uma frase.

Enquanto a lista não incluía esse módulo, ele constava como desvio no Complexity Tracking de
`specs/001-contai-mvp/plan.md`.

## Decisão

Criar o módulo `backend/app/modules/categorization` e incluí-lo na lista de domínios do
Princípio III, que passa a ser `auth`, `users`, `accounts`, `categories`, `transactions`,
`imports`, `categorization`, `dashboard` e `assistant`.

O módulo segue as mesmas regras dos demais:

- estrutura router → service → repository → models/schemas (sem router enquanto não tiver
  rotas próprias);
- só o repositório acessa o banco, e todo método que lida com dados do usuário recebe o
  `user_id` como parâmetro obrigatório;
- chamadas à IA passam pelo `LLMProvider` e pelos limites de uso, como exige o Princípio VI, e
  só as descrições das transações vão à IA, como exige o Princípio VII.

Os outros módulos dependem de `categorization` pelo serviço dele, nunca pelo repositório.

## Alternativas rejeitadas

- **Dentro de `categories`**: misturaria o cadastro de categorias, que é simples e síncrono, com
  regras aprendidas e chamadas à IA.
- **Dentro de `imports`**: obrigaria `transactions` e `assistant` a depender de `imports` para
  uma função que não é de importação.
- **Manter como desvio registrado no plano**: deixaria a constituição descrevendo uma arquitetura
  diferente da que existe no código.

## Consequências

- A emenda foi classificada como PATCH: ajusta a lista de domínios e não cria nem altera regra
  de arquitetura. Este ADR a acompanha porque a seção de governança da constituição pede um ADR
  para emendas que tocam a arquitetura.
- O desvio do Complexity Tracking do plano deixa de existir.
- As tarefas do módulo ficam na Phase 7 de `specs/001-contai-mvp/tasks.md`; a emenda foi a
  tarefa T055, feita antes delas.

# ADR 0004: dinheiro em centavos inteiros e saldo sempre calculado

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seções 16 e 17; constituição, Princípio
  VIII; FR-029 a FR-031, SC-009

## Contexto

Dinheiro em ponto flutuante acumula erro. Saldos, faturas e relatórios precisam ser exatos e
jamais divergir das transações que os compõem.

## Decisão

- **Centavos inteiros em todas as camadas**: `BIGINT` no banco, `int` no Python, inteiro no JSON
  e no TypeScript. Parcelas: `total // n` em cada uma, com o resto somado à primeira. Datas das
  parcelas: mesmo dia dos meses seguintes, ajustado ao último dia em meses curtos. "Hoje" e "mês
  atual" vêm de `zoneinfo` com `America/Sao_Paulo` (pacote `tzdata` na imagem). No frontend,
  `money.ts` e `dates.ts` concentram formatação e fuso.
- **Saldo sempre calculado por consulta, nunca armazenado**: saldo inicial + receitas − despesas
  + transferências recebidas − enviadas, para transações entre a data de referência e hoje. A
  dívida de um cartão é o saldo com sinal trocado.
- **Fatura derivada, não armazenada**: com fechamento no dia F, uma compra na data d pertence à
  fatura que fecha na primeira data de fechamento posterior a d.
- **Transferência**: duas linhas em `transactions` ligadas por `transfer_group_id`, com
  `transfer_direction`.
- **Estorno sem tipo novo**: uma receita lançada em categoria de despesa. Abate as saídas e o
  gasto da categoria nos relatórios; não soma nas entradas; não muda saldo nem fatura (o dinheiro
  que voltou já está contado). Não houve coluna nova nem migração.

## Alternativas rejeitadas

- **`Decimal`/`NUMERIC`**: correto, mas a constituição fixa inteiros.
- **Saldo armazenado e atualizado a cada transação**: risco de divergência (contra a SC-009).
- **Tabela de faturas**: estado duplicado, recalculado a cada edição.
- **Tipo `refund` para estornos**: migração, seletor de tipo e tratamento em todo lugar que lida
  com tipos.

## Consequências

- O saldo não pode divergir das transações, porque é derivado delas (SC-009).
- O serviço único de relatórios garante números idênticos entre painel e assistente.
- Toda edição de transação reflete em saldos e faturas sem recálculo manual.

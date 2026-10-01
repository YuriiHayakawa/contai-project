# Contrato: ferramentas do assistente

**Feature**: [spec.md](../spec.md) | **Research**: [research.md](../research.md), seções 18 e 19

## Regras comuns

- Todas as ferramentas são somente leitura. Nenhuma grava dados.
- O `user_id` nunca é parâmetro: o backend o injeta a partir da sessão autenticada.
- Os parâmetros são validados por schemas Pydantic. Parâmetro inválido devolve ao modelo um erro
  descritivo, e não uma exceção.
- Ids de conta e de categoria fora do conjunto do usuário são tratados como inexistentes.
- Cada ferramenta chama o mesmo serviço de relatórios usado pelo painel.
- Todo valor volta em centavos e já formatado: `{ "cents": 84230, "formatted": "R$ 842,30" }`.
- Todo resultado ecoa o período resolvido, com datas e um rótulo em português
  (por exemplo, "outubro de 2026"), e os `transaction_ids` que compõem os valores, até 50, mais
  a contagem total.
- Transferências nunca entram em totais de despesa ou receita.

## Parâmetro `period`

O modelo nunca calcula datas. Ele escolhe um período simbólico, e o backend resolve no fuso de
Brasília.

| `preset` | Campos extras | Significado |
|----------|---------------|-------------|
| `this_month` | — | do dia 1 do mês atual até hoje |
| `last_month` | — | mês anterior inteiro |
| `month` | `year`, `month` | um mês específico |
| `last_n_months` | `n` (1 a 24) | os últimos n meses, incluindo o atual |
| `this_year` | — | de 1º de janeiro até hoje |
| `last_year` | — | ano anterior inteiro |
| `custom` | `from`, `to` | datas explícitas ditas pelo usuário |

## Ferramentas

| Ferramenta | Parâmetros | Resultado | Pergunta de exemplo |
|------------|------------|-----------|---------------------|
| `get_spending_summary` | `period`, `category_ids`, `account_ids`, `description_contains`, `group_by` (`none`, `category`, `subcategory`, `account`, `month`) | total de despesas e a quebra pedida | "Quanto gastei com comida esse mês?", "Quanto gastei com Uber nos últimos 3 meses?" |
| `get_income_summary` | `period`, `category_ids`, `account_ids`, `group_by` | total de receitas e a quebra | "Quanto recebi este ano?" |
| `compare_periods` | `period_a`, `period_b`, `group_by` (`category` ou `none`) | por grupo: valor em cada período, diferença e variação percentual, já calculadas | "Em que gastei mais que no mês passado?" |
| `get_top_expenses` | `period`, `limit` (1 a 20), `category_ids`, `account_ids` | maiores despesas, em ordem | "Quais foram meus 5 maiores gastos em agosto?" |
| `search_transactions` | `period`, `text`, `type`, `category_ids`, `account_ids`, `limit` (1 a 50) | transações e a soma do conjunto | "Mostre minhas compras na farmácia em setembro" |
| `get_account_balances` | `account_ids` | saldo de cada conta ativa | "Quanto tenho na poupança?" |
| `get_card_invoices` | `account_ids` | por cartão: fatura atual e parcelas futuras por mês e no total | "Quanto ainda tenho de parcelas no cartão?" |
| `propose_transaction` | `type`, `amount` (texto, por exemplo `"45"` ou `"45,90"`), `date_reference` (`today`, `yesterday` ou data explícita), `description`, `account_hint`, `category_hint` | proposta com conta e categoria resolvidas pelo backend, ou a lista do que falta | "gastei 45 no ifood ontem no cartão" |

`propose_transaction` não grava nada: o backend converte o valor com `Decimal`, resolve a data,
procura a conta e a categoria pelas dicas e devolve a proposta, que o usuário confirma no
formulário.

## Resposta final

- Tipos possíveis: `answer`, `clarification` (pergunta ambígua), `refusal` (fora do tema de
  finanças do usuário), `transaction_proposal`, `error`.
- Conferência numérica: todo valor em reais e todo percentual presente no texto final precisa
  existir, com a mesma formatação, nos resultados das ferramentas daquela pergunta. Em caso de
  falha, o backend pede a resposta de novo uma vez; se falhar de novo, monta a resposta por texto
  fixo a partir dos resultados.
- As transações exibidas junto da resposta vêm dos `transaction_ids` das ferramentas, nunca do
  texto do modelo.
- No máximo 5 rodadas de ferramentas por pergunta.

## Dados não confiáveis

Descrições, observações e nomes de contas e categorias criados pelo usuário entram no prompt
apenas dentro dos resultados das ferramentas, como dados delimitados. O prompt de sistema
instrui o modelo a nunca seguir instruções contidas neles. Os testes incluem transações com
descrições que tentam mudar o comportamento do assistente (FR-068).

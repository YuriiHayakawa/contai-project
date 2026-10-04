# Contrato: ferramentas do assistente

**Feature**: [spec.md](../spec.md) | **Research**: [research.md](../research.md), seções 18 e 19

## Regras comuns

- Todas as ferramentas são somente leitura. Nenhuma grava dados: nem `propose_transaction`,
  que só monta uma proposta para o usuário conferir.
- O `user_id` nunca é parâmetro: o backend o injeta a partir da sessão autenticada.
- Os parâmetros são validados por schemas Pydantic. Parâmetro inválido devolve ao modelo um erro
  descritivo, e não uma exceção.
- Ids de conta e de categoria fora do conjunto do usuário são tratados como inexistentes.
- Cada ferramenta chama o mesmo serviço de relatórios usado pelo painel.
- Todo valor volta em centavos e já formatado: `{ "cents": 84230, "formatted": "R$ 842,30" }`.
- Todo resultado ecoa o período resolvido, com datas e um rótulo em português
  (por exemplo, "outubro de 2026"), e os `transaction_ids` que compõem os valores, até 50, mais
  a contagem total. Os ids ficam no resultado que o backend guarda; ao modelo vai só a
  contagem.
- Um período sem lançamentos volta com uma nota dizendo isso, para o modelo não interpretar um
  zero.
- Transferências nunca entram em totais de despesa ou receita.

## Parâmetro `period`

O modelo nunca calcula datas. Ele escolhe um período simbólico, e o backend resolve no fuso de
Brasília. Todo período que inclui o mês atual o inclui inteiro, como o painel: é o que mantém
os números do assistente iguais aos do painel quando há lançamentos de data futura no mês
(FR-062).

| `preset` | Campos extras | Significado |
|----------|---------------|-------------|
| `this_month` | — | o mês atual inteiro |
| `last_month` | — | mês anterior inteiro |
| `month` | `year`, `month` | um mês específico |
| `last_n_months` | `n` (1 a 24) | os últimos n meses inteiros, incluindo o atual |
| `this_year` | — | de 1º de janeiro até o fim do mês atual |
| `last_year` | — | ano anterior inteiro |
| `custom` | `from`, `to` | datas explícitas ditas pelo usuário |

## Ferramentas

| Ferramenta | Parâmetros | Resultado | Pergunta de exemplo |
|------------|------------|-----------|---------------------|
| `get_spending_summary` | `period`, `category_ids`, `account_ids`, `description_contains`, `exclude_category_ids`, `exclude_description_contains`, `group_by` (`none`, `category`, `subcategory`, `account`, `month`) | total de despesas e a quebra pedida; com exclusões, o total já sem elas e `excluding` com o que ficou de fora | "Quanto gastei com comida esse mês?", "Quanto gastei com Uber nos últimos 3 meses?" |
| `get_income_summary` | `period`, `category_ids`, `account_ids`, `exclude_category_ids`, `exclude_description_contains`, `group_by` | total de receitas e a quebra | "Quanto recebi este ano?" |
| `compare_periods` | `period_a`, `period_b`, `group_by` (`category` ou `none`) | por grupo: valor em cada período, diferença e variação percentual, já calculadas | "Em que gastei mais que no mês passado?" |
| `get_top_expenses` | `period`, `limit` (1 a 20), `category_ids`, `account_ids` | maiores despesas, em ordem | "Quais foram meus 5 maiores gastos em agosto?" |
| `search_transactions` | `period`, `text`, `type`, `category_ids`, `account_ids`, `limit` (1 a 50) | transações e a soma do conjunto; cada transferência uma vez, com `from_account` e `to_account`, e `transfers` com a quantidade e o total | "Mostre minhas compras na farmácia em setembro" |
| `get_account_balances` | `account_ids` | saldo de cada conta ativa | "Quanto tenho na poupança?" |
| `get_card_invoices` | `account_ids` | por cartão: fatura atual e parcelas futuras por mês e no total | "Quanto ainda tenho de parcelas no cartão?" |
| `propose_transaction` | `type`, `amount` (texto, por exemplo `"45"` ou `"45,90"`), `date_reference` (`today`, `yesterday` ou data explícita), `description`, `account_hint`, `category_hint` | proposta com conta e categoria resolvidas pelo backend, ou a lista do que falta | "gastei 45 no ifood ontem no cartão" |

**Total sem alguma coisa**: o modelo não subtrai. Para "se tirar esse saque, quanto gastei?"
ou "quanto gastei sem contar o aluguel?", ele chama o resumo de novo com
`exclude_description_contains` (trecho da descrição) ou `exclude_category_ids` (a categoria,
com as subcategorias), e o backend devolve o total já calculado sem isso.

**Transferências**: as duas linhas de uma transferência, a de saída e a de entrada, são um
movimento só. `search_transactions` a devolve e a conta uma vez, com a conta de onde o dinheiro
saiu e a conta em que entrou, mesmo quando o recorte só alcança uma das linhas; ela nunca entra
nas somas de despesas e de receitas.

`propose_transaction` não grava nada: nem lançamento, nem regra de categoria. O backend monta
a proposta, que o usuário salva como está, quando ela já tem conta e categoria, ou ajusta no
formulário:

- **Valor**: convertido com `Decimal`. Sem valor, a ferramenta devolve `missing: ["amount"]` e
  o modelo pergunta qual foi; um valor que não se lê volta como erro descritivo.
- **Data**: `today`, `yesterday` ou uma data explícita (`AAAA-MM-DD`, `DD/MM` ou `DD/MM/AAAA`),
  a partir do dia de hoje em Brasília. Sem `date_reference`, hoje.
- **Conta**: a dica vale pelo nome da conta, pelo nome da instituição ou pelo tipo ("cartão",
  "poupança", "débito"). Se duas contas servem (dois cartões para "no cartão"), ou se a frase
  cita uma conta que o usuário não tem, a conta fica em aberto. Sem dica, vale a última conta
  usada: a conta ativa do lançamento criado por último, sem contar transferências; em um
  recebimento, a última que não é cartão de crédito. Uma dica que só repete a descrição ("de
  um freela") não é uma conta.
- **Categoria**: primeiro a regra de categoria da descrição normalizada (FR-048), do usuário ou
  a sugestão da IA já guardada; só sem regra vale a `category_hint` do modelo, pelo nome ou
  pelo nome completo (`Categoria > Subcategoria`), do tipo do lançamento. Sem nenhuma das
  duas, a categoria fica em aberto. A categoria não gera outra chamada à IA.

Quando a ferramenta devolve uma proposta, ela já é a resposta: o backend grava a mensagem
`transaction_proposal` com um texto fixo e não chama o modelo de novo. O uso é registrado como
`text_entry` e conta como uma pergunta no limite do dia.

## Resposta final

- Tipos possíveis: `answer`, `clarification` (categoria ou conta que não existe, ou pedido
  realmente ambíguo; a falta de período não é motivo: vale o mês atual, dito na resposta),
  `refusal` (fora do tema de
  finanças do usuário), `transaction_proposal`, `error`. O modelo marca o esclarecimento e a
  recusa começando o texto com `[esclarecimento]` ou `[recusa]`; o backend tira a marca. Um
  texto sem marca e sem nenhuma consulta é um esclarecimento.
- Conferência numérica: todo valor em reais e todo percentual presente no texto final precisa
  existir nos resultados das ferramentas daquela pergunta. A comparação é pelo valor (em
  centavos, sem o sinal), e não pelos caracteres: `R$ 842,30` e `842,30 reais` são o mesmo
  valor; `R$ 842` e `R$ 850,00`, não. Em caso de falha, o backend pede a resposta de novo uma
  vez; se falhar de novo, monta a resposta por texto fixo a partir dos resultados. Sem nenhum
  resultado para sustentar um número, a resposta é do tipo `error`, sem o número.
- As transações exibidas junto da resposta vêm dos `transaction_ids` das ferramentas, nunca do
  texto do modelo.
- No máximo 5 rodadas de ferramentas por pergunta; depois da quinta, o modelo já não recebe
  ferramentas e precisa responder.

## Dados não confiáveis

Descrições e observações entram no prompt apenas dentro dos resultados das ferramentas. Os
nomes de contas e de categorias vão também em um bloco delimitado (`<dados_do_usuario>`), só
com id, nome e tipo, para o modelo escolher os ids. O prompt de sistema
instrui o modelo a nunca seguir instruções contidas neles. Os testes incluem transações com
descrições que tentam mudar o comportamento do assistente (FR-068).

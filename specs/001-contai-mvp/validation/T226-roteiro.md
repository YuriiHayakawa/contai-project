# T226: roteiro final em produção, com o Gemini real

Roteiro para conferir o Contaí de ponta a ponta no site de produção, com uma conta de teste e
dados fictícios. Os números esperados foram calculados antes, a partir dos arquivos desta pasta.
Por isso dá para conferir três coisas: a importação, o painel e se o assistente bate com o painel
(SC-010).

- **Arquivos**: [`t226-conta-corrente.ofx`](t226-conta-corrente.ofx) (20 lançamentos de agosto a
  novembro de 2026) e [`t226-fatura-cartao.pdf`](t226-fatura-cartao.pdf) (fatura fictícia com 4
  compras). Os dois são inventados: nenhum dado real.
- **Quando rodar**: em **08/11/2026**. O lançamento por texto usa "ontem" (07/11). Em outro dia
  de novembro, a data muda, mas os totais do mês continuam os mesmos.
- **Cota do Gemini**: o roteiro gasta umas 20 a 25 chamadas. Se a cota do dia acabar, o app avisa
  que volta amanhã. Nesse caso, anote até onde chegou e continue no dia seguinte.
- **Tempos**: as metas valem com o servidor acordado. Abra o site e espere a tela de entrada
  antes de começar a medir.

## 1. Conta de teste

1. No site, crie uma conta com um e-mail seu. No Gmail, dá para usar um apelido, por exemplo
   `seu.email+contai@gmail.com`.
2. Confirme pelo link do e-mail. Se não chegar, confira o spam (FR-089).
3. Entre.

## 2. Contas

Crie em **Contas**:

| Conta | Tipo | Saldo inicial | Data do saldo |
|-------|------|---------------|---------------|
| Conta Corrente | corrente | R$ 2.000,00 | 01/08/2026 |
| Poupança | poupança | R$ 5.000,00 | 01/08/2026 |
| Cartão Teste | cartão de crédito, fecha dia 25, vence dia 5 | R$ 0,00 | 01/08/2026 |

## 3. Importar o OFX

**Importações → Importar arquivo → Extrato**, na **Conta Corrente**, com `t226-conta-corrente.ofx`.

Na revisão:

- aparecem **20 linhas**;
- o saldo do banco no arquivo, **R$ 11.447,00**, bate com o do app, sem aviso de diferença;
- as categorias ficam como na tabela abaixo. A sugestão usa a IA: corrija as que vierem
  diferentes e anote quantas foram.

| Descrição | Categoria |
|-----------|-----------|
| SALARIO EMPRESA EXEMPLO LTDA (4×, R$ 4.500,00) | Salário |
| ALUGUEL APTO 12 (4×, R$ 1.500,00) | Moradia › Aluguel |
| SUPERMERCADO BOM PRECO (R$ 420,30, 380,00, 350,00 e 510,40) | Alimentação › Mercado |
| IFOOD PEDIDO (R$ 48,00 e 62,90) | Alimentação › Delivery |
| RESTAURANTE SABOR CASEIRO (R$ 132,50) | Alimentação › Restaurante |
| FARMACIA SAUDE MAIS (R$ 89,90 e 45,00) | Saúde › Farmácia |
| POSTO COMBUSTIVEL CENTRAL (R$ 250,00 e 200,00) | Transporte › Combustível |
| CINEMA CENTRO (R$ 64,00) | Lazer |

Confirme a importação.

## 4. Importar o PDF

**Importações → Importar arquivo → Extrato ou fatura**, no **Cartão Teste**, com
`t226-fatura-cartao.pdf`.

1. Aparece o aviso sobre o serviço de IA. Aceite.
2. Na revisão, aparecem **4 linhas**, e a soma, **R$ 323,30**, confere com o total do documento.
3. Confira as categorias e confirme:

| Data | Descrição | Valor | Categoria |
|------|-----------|-------|-----------|
| 28/09/2026 | LIVRARIA CENTRAL | R$ 89,00 | Educação |
| 03/10/2026 | STREAMING FILMES | R$ 55,90 | Assinaturas |
| 12/10/2026 | RESTAURANTE BOA MESA | R$ 146,00 | Alimentação › Restaurante |
| 18/10/2026 | APP TRANSPORTE | R$ 32,40 | Transporte › Aplicativo e táxi |

## 5. Compra parcelada, à mão

**Lançar → despesa**:
- conta **Cartão Teste**;
- descrição "Notebook";
- **R$ 1.800,00 em 6 parcelas**;
- data **02/11/2026**;
- categoria **Educação**.

Esperado: 6 parcelas de R$ 300,00, de 02/11/2026 a 02/04/2027.

## 6. Lançamento por texto (SC-005)

No **Assistente**, escreva:

> gastei 45 no ifood ontem no cartão

Chega um cartão com **R$ 45,00**, **07/11/2026**, **Cartão Teste** e **Alimentação ›
Delivery**. Clique em **Salvar**.

Meça o tempo do envio até o cartão aparecer. A meta é **menos de 10 segundos**, contando a
confirmação.

## 7. Painel de novembro de 2026

| O quê | Esperado |
|-------|----------|
| Entradas | R$ 4.500,00 |
| Saídas | R$ 2.463,30 |
| Moradia | R$ 1.500,00 |
| Alimentação | R$ 618,30 |
| Educação | R$ 300,00 |
| Saúde | R$ 45,00 |
| Saldo da Conta Corrente | R$ 11.447,00 |
| Saldo da Poupança | R$ 5.000,00 |
| Fatura fechada do Cartão Teste (fechou em 25/10, venceu em 05/11) | R$ 323,30 a pagar, com o aviso de fatura na tela inicial (FR-087) |
| Fatura atual do Cartão Teste (fecha em 25/11) | R$ 345,00 (1ª parcela do notebook + iFood) |
| Parcelas futuras do Cartão Teste | R$ 1.500,00 |

## 8. As seis perguntas de exemplo (SC-010 e SC-014)

Faça uma por vez e anote, para cada uma, o tempo até a resposta. A meta é que **pelo menos 5 das
6** respondam em **até 10 segundos**. Confira também que cada resposta lista os lançamentos que
compõem o valor.

| Pergunta | Esperado (e onde conferir no painel) |
|----------|--------------------------------------|
| Quanto gastei com comida esse mês? | **R$ 618,30**: Supermercado R$ 510,40, iFood R$ 62,90 e iFood R$ 45,00 (Alimentação em novembro) |
| Quanto recebi este ano? | **R$ 18.000,00**: quatro salários de R$ 4.500,00 (entradas de agosto a novembro) |
| Em que gastei mais que no mês passado? | **Alimentação** (R$ 618,30 contra R$ 544,00), **Educação** (R$ 300,00 contra R$ 0,00) e **Saúde** (R$ 45,00 contra R$ 0,00). Moradia ficou igual; Transporte e Assinaturas caíram |
| Quais foram meus 5 maiores gastos em agosto? | Aluguel R$ 1.500,00; Supermercado R$ 420,30; Posto R$ 250,00; Restaurante Sabor Caseiro R$ 132,50; Farmácia R$ 89,90 |
| Quanto tenho na poupança? | **R$ 5.000,00** |
| Quanto ainda tenho de parcelas no cartão? | **R$ 1.500,00**: cinco parcelas de R$ 300,00, de dezembro de 2026 a abril de 2027 |

Se sobrar cota, faça também:
- "e no mês anterior?" logo depois da primeira pergunta. O esperado é **R$ 544,00** de
  Alimentação em outubro.
- Uma pergunta fora do tema, por exemplo "qual a capital da França?". O esperado é uma recusa
  educada.

## 9. Resultado (executado em 2026-11-08)

Executado em produção (`contai-project.vercel.app`, Gemini real), pelo Claude Code, num navegador
Chromium sem tela e pela API, com a conta do mantenedor. Os dados de teste antigos dessa conta
(2 contas e 4 lançamentos) foram apagados antes, com a autorização dele.

- **Pela API**: contas, envio e confirmação das importações e parcelado.
- **Pela tela**: a revisão das importações, o lançamento por texto, o painel e as perguntas.
- **O aviso de IA antes do primeiro PDF** foi aceito pela API: a tela do aviso não foi exercitada
  nesta execução.

| Passo | Esperado | Obtido | Tempo | OK? |
|-------|----------|--------|-------|-----|
| 3. OFX | 20 linhas, saldo R$ 11.447,00 sem aviso | 20 linhas; `balance_check.matches = true` | 10,2 s até a revisão | ✅ |
| 3. Categorias sugeridas | 20 certas | 20 certas, nenhuma corrigida | | ✅ |
| 4. PDF | 4 linhas, soma R$ 323,30 confere | 4 linhas; `total_check.matches = true` (R$ 323,30); 4 categorias certas | 9,5 s até a revisão | ✅ |
| 5. Parcelado | 6 × R$ 300,00 | 6 × R$ 300,00, de 02/11/2026 a 02/04/2027 | | ✅ |
| 6. Por texto | R$ 45,00, 07/11, Cartão Teste, Delivery | R$ 45,00, "Ontem", Cartão Teste, Alimentação › Delivery; salvo | 2,9 s até o cartão; 4,1 s com o "Salvar" | ✅ |
| 7. Painel | tabela da seção 7 | todos os valores iguais, com o aviso "Fatura vencida: Cartão Teste, R$ 323,30" | | ✅ |
| 8.1 Comida | R$ 618,30 | R$ 618,30, com os 3 lançamentos | 4,9 s | ✅ |
| 8.1b "e no mês anterior?" | R$ 544,00 | 1ª vez: "Não consegui calcular isso com segurança agora"; 2ª vez: R$ 544,00, com os 3 lançamentos | 5,5 s | ⚠️ |
| 8.2 Recebi | R$ 18.000,00 | R$ 18.000,00, com os 4 salários | ~2,5 s | ✅ |
| 8.3 Gastei mais | Alimentação, Educação, Saúde | Educação, Alimentação (+R$ 74,30, 13,7%) e Saúde | ~2,5 s | ✅ |
| 8.4 Maiores de agosto | 5 itens da tabela | os 5, na ordem | ~2,5 s | ✅ |
| 8.5 Poupança | R$ 5.000,00 | R$ 5.000,00 | ~2,5 s | ✅ |
| 8.6 Parcelas | R$ 1.500,00 | R$ 1.500,00 | ~2,5 s | ✅ |
| Fora do tema | recusa | recusa educada, com sugestões | ~2,4 s | ✅ |

Os tempos com "~" vêm do intervalo entre as perguntas gravadas, porque cada uma só saía depois
da resposta anterior. Os outros foram medidos do envio até a resposta aparecer na tela. Todas as
respostas ficaram abaixo de 10 s.

**Critérios**: SC-005 ✅ (2,9 s); SC-010 ✅ (as seis perguntas certas, cada uma com a lista "De
onde veio esse número"); SC-014 ✅ (todas abaixo de 10 s).

**Observações**:

1. **Continuação "e no mês anterior?"**: na primeira tentativa, o modelo respondeu sem consultar
   os lançamentos de outubro. A conferência numérica (FR-062) recusou o valor, e o app mostrou
   "Não consegui calcular isso com segurança agora" em vez de um número errado. Na segunda
   tentativa, acertou. É uma falha do modelo, que a trava conteve. Fica como melhoria possível:
   reforçar no prompt que uma continuação também consulta as ferramentas.
2. **Lista de origem das parcelas**: a resposta de R$ 1.500,00 lista 7 lançamentos. A ferramenta
   `get_card_invoices` junta as compras da fatura atual (R$ 345,00) e as 5 parcelas futuras,
   porque responde as duas coisas de uma vez. O valor está certo; a lista é mais larga que a
   pergunta. Fica como melhoria possível: separar a origem por métrica.

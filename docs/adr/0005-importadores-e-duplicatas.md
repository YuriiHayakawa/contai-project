# ADR 0005: importadores e detecção de duplicatas

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seções 10 a 14; FR-050, FR-082, FR-083,
  SC-008

## Contexto

O Contaí importa extratos e comprovantes em OFX, CSV, planilha, PDF e imagem. Reimportar o mesmo
arquivo não pode gerar duplicatas, e arquivos reais de bancos brasileiros fogem do padrão.

## Decisão

- **OFX**: `ofxtools`, usando só o leitor de marcação (`TreeBuilder`), com uma etapa própria de
  pré-processamento tolerante (codificação, cabeçalho, datas fora do padrão) antes da leitura. O
  `FITID` vira o identificador externo; o `LEDGERBAL` alimenta a comparação de saldo (FR-082). A
  data vale como está escrita, sem hora nem fuso. Arquivo com mais de uma conta é recusado.
- **CSV e planilha**: `csv` da biblioteca padrão e `openpyxl` somente leitura. Um
  `ImportTemplate` é identificado pela assinatura do cabeçalho; o mapeamento guarda colunas,
  formato de data, separador decimal e convenção de sinal. Uma célula que o modelo não lê como
  data ou valor devolve a importação a `awaiting_mapping` com `mapping_mismatch`, em vez de pular
  em silêncio.
- **PDF e imagem**: lidos pela camada de IA (ver [[0003-camada-de-ia-e-garantia-numerica]]); PDF
  cifrado é recusado.
- **Fluxo**: `queued → processing → awaiting_review → completed → undone`, com os desvios
  `awaiting_mapping` e `failed`. As transações propostas ficam em `import_items` até a confirmação,
  feita em uma única requisição e uma única transação de banco. Uma importação em
  `awaiting_review` expira em 7 dias (FR-083).
- **Duplicatas em três níveis**, na preparação da revisão: (1) identificador externo, por índice
  único parcial em `(account_id, external_id)`, marca `exact`; (2) impressão digital (hash de
  conta, data, tipo, valor e descrição normalizada), comparada por contagem; (3) provável — mesma
  conta, mesmo sentido do dinheiro, mesmo valor, data com até 3 dias de diferença. Cada transação
  existente explica no máximo uma linha. Linhas `exact` e `probable` chegam desmarcadas.

## Alternativas rejeitadas

- **`ofxparse`**: mais tolerante, mas sem tipos e com dependências; fica como plano B só para um
  banco que falhe mesmo com o pré-processamento.
- **Índice único na impressão digital**: bloquearia compras legítimas repetidas no mesmo dia.
- **Salvar cada edição da revisão no servidor**: mais endpoints e estados; manter no navegador
  basta no MVP.

## Consequências

- Reimportar o mesmo arquivo gera zero duplicatas com a seleção padrão (SC-008), e o banco impede
  a duplicata de OFX mesmo se o código falhar.
- A tolerância do OFX fica isolada no importador e coberta por fixtures de vários bancos.
- Editar a revisão só no navegador perde o que não for confirmado se a página fechar — aceitável.

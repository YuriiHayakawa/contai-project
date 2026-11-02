# ADR 0006: uploads em volume privado, fora do banco e do backup

- **Situação**: substituído pelo [[0011-arquivos-enviados-no-banco]] (2026-11-02): o Render
  gratuito não tem disco permanente
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seção 9; constituição, Princípio V

## Contexto

Arquivos enviados para importar (extratos, faturas, comprovantes) são documentos bancários
sensíveis. Eles vivem minutos: são lidos e descartados. A política manda descartar o original, o
que conflita com guardá-lo onde ele entraria nas cópias de segurança por 14 dias.

## Decisão

- Limite de 10 MB aplicado no Caddy e de novo na API, lendo em blocos. O tipo real é conferido
  com `filetype` pelos primeiros bytes (PDF, JPG, PNG, XLSX) e por inspeção de conteúdo para OFX e
  CSV. PDF cifrado é detectado pelo marcador `/Encrypt` e recusado.
- O nome é gerado pelo sistema (UUID), e o arquivo é gravado num volume privado compartilhado só
  entre `api` e `worker`, fora de qualquer pasta servida. Esse volume **não entra no backup**.
- O arquivo é apagado quando a importação chega a `awaiting_review` ou `failed`; em
  `awaiting_mapping` é mantido por no máximo 24 horas. Uma tarefa periódica apaga os arquivos que
  nenhuma importação guarda. A exclusão definitiva de conta remove o que sobrou no disco.

## Alternativas rejeitadas

- **Arquivo em coluna `bytea`**: colocaria documentos bancários dentro dos backups por 14 dias,
  contra a regra de descartar o original.
- **Armazenamento de objetos externo**: infraestrutura a mais para arquivos que vivem minutos.

## Consequências

- Documentos originais não sobrevivem nas cópias de segurança.
- `api` e `worker` precisam do mesmo volume montado; é um acoplamento de infraestrutura assumido.
- A limpeza dos arquivos órfãos depende da tarefa periódica do worker (ver
  [[0001-fila-de-jobs-no-postgresql]]).

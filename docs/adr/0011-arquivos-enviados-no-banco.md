# ADR 0011: arquivos enviados no banco, fora do backup

- **Situação**: aceito; substitui o [[0006-uploads-em-volume-privado]]
- **Data**: 2026-11-02
- **Referência**: `specs/001-contai-mvp/research.md`, seção 9; constituição, Princípio V;
  [[0010-hospedagem-em-planos-gratuitos]]

## Contexto

O ADR 0006 guardava os arquivos enviados num volume privado, compartilhado entre a API e o
worker, e fora do backup. No plano gratuito do Render não há disco permanente: o que é gravado
no disco some a cada deploy, a cada reinício e sempre que o serviço dorme. Um arquivo enviado
pouco antes de o serviço dormir se perderia antes de ser lido.

As regras do ADR 0006 continuam: o arquivo é um documento bancário sensível, vive minutos, é
apagado depois do processamento e não pode ficar nas cópias de segurança por 14 dias.

## Decisão

- O conteúdo do arquivo vai para a tabela `import_files` (uma linha por importação, com
  `import_id`, `user_id` e o conteúdo em `bytea`), gravada pelo repositório de `imports`, com o
  `user_id` obrigatório como todo repositório (Princípio III).
- A linha é apagada quando a importação chega a `awaiting_review` ou `failed`; em
  `awaiting_mapping`, fica no máximo 24 horas. A exclusão da importação e a da conta apagam a
  linha em cascata. A tarefa periódica de limpeza apaga as que sobrarem.
- O backup copia a estrutura da tabela, mas **não os dados**:
  `pg_dump --exclude-table-data=import_files`.
- A validação do envio não muda: 10 MB no máximo, lidos em blocos; tipo real pelo conteúdo; PDF
  cifrado recusado. Não existe mais nome de arquivo no disco.

## Alternativas rejeitadas

- **Disco do serviço**: perde o arquivo quando o serviço reinicia ou dorme.
- **Armazenamento de objetos externo**: mais uma conta e mais uma credencial para arquivos que
  vivem minutos; o gratuito que não pede cartão é incerto.
- **Conteúdo no payload do job**: a fila guarda só identificadores (ADR 0001).

## Consequências

- O arquivo sobrevive a reinícios e à hibernação até ser processado.
- Os documentos originais continuam fora das cópias de segurança.
- O histórico de restauração do Neon guarda o conteúdo apagado por até 6 horas; depois disso,
  ele não existe mais em lugar nenhum.
- Um arquivo de 10 MB ocupa 10 MB do banco enquanto espera; com dezenas de usuários e arquivos
  que vivem minutos, isso cabe com folga no 1 GB do plano gratuito do Neon.
- A coluna `stored_filename` de `imports`, o volume `uploads` e `UPLOAD_DIR` deixam de existir.

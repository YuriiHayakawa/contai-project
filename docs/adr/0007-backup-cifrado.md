# ADR 0007: backup diário cifrado com chave pública

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seção 24; constituição, Princípio XII;
  política de privacidade (retenção de 14 dias)

## Contexto

Os dados do usuário precisam de cópia de segurança para recuperação. Mas uma invasão do servidor
não pode expor os backups antigos, e a política de privacidade promete que os dados de uma conta
excluída somem também das cópias em até 14 dias.

## Decisão

- Um contêiner `backup` roda `pg_dump` uma vez por dia, compacta, cifra com `age` usando uma
  **chave pública** (a chave privada fica fora do servidor) e envia com `rclone` a um
  armazenamento de objetos compatível com S3.
- Retenção de 14 dias, aplicada pela regra de ciclo de vida do bucket e conferida pelo script.
- `infra/backup/restore.sh` documenta e executa a restauração; o procedimento é testado
  restaurando num banco temporário, e o resultado fica registrado no `README.md` do serviço.
- O volume de uploads **não** entra no backup (ver [[0006-uploads-em-volume-privado]]).

## Alternativas rejeitadas

- **Cifra simétrica no servidor**: a chave moraria ao lado dos backups; uma invasão abriria tudo.
- **Backup sem cifra, confiando no bucket privado**: uma credencial vazada exporia os dados.
- **Retenção só no script, sem regra do bucket**: um script que falha em silêncio deixaria
  cópias antigas; a regra do bucket é a rede de segurança.

## Consequências

- Só quem tem a chave privada (fora do servidor) consegue restaurar — o procedimento precisa estar
  documentado e testado, senão a cópia é inútil na emergência.
- Como o worker apaga a conta no prazo de 7 dias e a retenção é de 14, os dados de uma conta
  excluída somem das cópias em até 14 dias após a exclusão definitiva, como promete a política.
- Este ADR descreve a decisão; a implementação (`infra/backup/`, `docker-compose.prod.yml`) é
  tarefa de infraestrutura, fora do grupo de qualidade e documentação.

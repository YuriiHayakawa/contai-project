# ADR 0007: backup diário cifrado com chave pública

- **Situação**: aceito; revisto em 2026-11-02 com a hospedagem em planos gratuitos
  ([[0010-hospedagem-em-planos-gratuitos]])
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seção 24; constituição, Princípio XII;
  política de privacidade (retenção de 14 dias)

## Contexto

Os dados do usuário precisam de cópia de segurança para recuperação. Mas uma invasão de quem
guarda os backups não pode expor o conteúdo deles, e a política de privacidade promete que os
dados de uma conta excluída somem também das cópias em até 14 dias.

Na revisão de 2026-11-02, o banco passou para o Neon gratuito, e não há mais servidor próprio
onde rodar um contêiner de backup. O repositório principal vai ser público (portfólio).

## Decisão

- Um workflow agendado do GitHub Actions (`backup.yml`) roda uma vez por dia num **repositório
  privado separado**, `contai-backups`, que só existe para isso.
- Ele roda `pg_dump` do Neon com um usuário **só de leitura**, sem os dados da tabela de
  arquivos enviados (`--exclude-table-data=import_files`, ver
  [[0011-arquivos-enviados-no-banco]]), compacta, cifra com `age` usando uma **chave pública** e
  guarda o resultado como artifact do workflow.
- Retenção de 14 dias, aplicada pela própria plataforma (`retention-days: 14` no artifact).
- A chave privada fica fora do GitHub, com o mantenedor (gerenciador de senhas e cópia offline).
- `infra/backup/restore.sh` documenta e executa a restauração (baixar o artifact, decifrar e
  `pg_restore`); o procedimento é testado restaurando num banco temporário, e o resultado fica
  registrado em `infra/backup/README.md`.
- Uma falha do workflow agendado chega ao mantenedor pelo e-mail de notificação do GitHub.

## Alternativas rejeitadas

- **Cifra simétrica**: a chave moraria ao lado dos backups; uma invasão abriria tudo.
- **Backup sem cifra, confiando no repositório privado**: uma credencial vazada exporia os dados.
- **Artifacts no repositório principal**: ele vai ser público, e os artifacts de um repositório
  público podem ser baixados por qualquer pessoa com conta no GitHub.
- **Armazenamento de objetos (S3, R2, B2) com `rclone`**: pede cartão ou não tem garantia clara de
  que não pede; seria mais uma conta e mais uma credencial.
- **Backup pelo próprio Neon**: o histórico de restauração do plano gratuito é de 6 horas, e a
  cópia precisa ficar fora do provedor do banco (Princípio XII).

## Consequências

- Só quem tem a chave privada consegue restaurar — o procedimento precisa estar documentado e
  testado, senão a cópia é inútil na emergência.
- As tarefas agendadas apagam a conta até 3 horas depois do prazo de 7 dias, e a retenção é de
  14 dias: os dados de uma conta excluída somem das cópias em até 14 dias após a exclusão
  definitiva, como promete a política.
- O repositório privado tem 500 MB para artifacts no plano gratuito; dumps compactados de
  dezenas de usuários ocupam poucos megabytes por dia.
- O usuário só de leitura do Neon limita o estrago de um vazamento da credencial do backup.

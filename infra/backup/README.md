# Backup diário cifrado

Uma vez por dia, um workflow do GitHub Actions copia o banco do Neon com um usuário só de
leitura, cifra a cópia com a chave pública do `age` e a guarda como artifact por 14 dias
([ADR 0007](../../docs/adr/0007-backup-cifrado.md)). O workflow roda num repositório
**privado** separado, `contai-backups`: os artifacts de um repositório público podem ser baixados
por qualquer pessoa com conta no GitHub.

| Arquivo | O que é |
|---------|---------|
| [`backup.yml`](backup.yml) | cópia de referência do workflow, que vai para `.github/workflows/backup.yml` do `contai-backups` |
| [`create-backup-role.sql`](create-backup-role.sql) | cria no Neon o usuário só de leitura `contai_backup` |
| [`restore.sh`](restore.sh) | decifra uma cópia e a restaura num banco temporário local ou num banco vazio |
| [`count-rows.sql`](count-rows.sql) | linhas de cada tabela, para comparar a cópia com a origem |

O que a cópia leva e o que fica fora:

- Todas as tabelas, sem dono nem privilégios, prontas para restaurar em qualquer banco vazio.
- Os dados de `import_files` ficam fora: os arquivos enviados só existem até serem lidos
  ([ADR 0011](../../docs/adr/0011-arquivos-enviados-no-banco.md)). A tabela volta vazia.
- O `pg_dump` roda na imagem oficial do PostgreSQL da mesma versão do servidor, e o nome da cópia
  registra essa versão (`contai-2026-11-08T0617Z-pg17.dump.age`).
- Antes de cifrar, o workflow confere que o `pg_restore` lê a cópia. A cópia sem cifra nunca sai
  do runner.

Uma falha da execução agendada chega por e-mail, pelas notificações do GitHub (Settings →
Notifications → Actions).

## Configuração

Feita uma vez pelo mantenedor. Nenhum segredo passa pelo repositório principal.

### 1. Repositório privado

Em <https://github.com/new>, crie `contai-backups` como **Private**, com um README, para ele já
ter a branch `main`.

### 2. Chaves do age

No Windows (PowerShell):

```powershell
winget install --id FiloSottile.age
# num PowerShell novo, para o PATH valer
New-Item -ItemType Directory -Force "$HOME\contai-backup"
age-keygen -o "$HOME\contai-backup\chave-age.txt"
```

No Linux ou no macOS, instale o pacote `age` e rode o mesmo `age-keygen -o`.

- A linha `Public key: age1…` é a chave pública. Ela não é segredo e vai para a variável do
  passo 4.
- O arquivo `chave-age.txt` é a **chave privada**: guarde o conteúdo dele no gerenciador de
  senhas e numa cópia offline. Sem ela, nenhuma cópia pode ser restaurada. Ela nunca vai para
  nenhum repositório.

### 3. Usuário só de leitura no Neon

1. Gere uma senha longa, por exemplo:
   `docker compose run --rm --no-deps -e RUN_MIGRATIONS=0 api python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. No SQL Editor do Neon, no ramo `production` (o principal, o mesmo do Render) e no banco do
   app, rode [`create-backup-role.sql`](create-backup-role.sql) com a senha no lugar de
   `COLE_A_SENHA_AQUI`. Rode como o mesmo papel do `DATABASE_URL` do Render, o dono das tabelas.
   Assim, as tabelas das próximas migrações também entram na cópia.
3. A consulta do fim do arquivo confere o papel: `rolsuper`, `rolcreaterole` e `neon_superuser`
   vêm `false`, e `rolconfig` traz `default_transaction_read_only=on`.
4. Apague a consulta do histórico do SQL Editor, porque ela tem a senha.

O papel é criado por SQL de propósito: um papel criado pelo painel do Neon entra no
`neon_superuser` e deixa de ser só de leitura. Os papéis do Neon são de cada ramo: o
`contai_backup` existe só no `production`. Se o banco do app passar para outro ramo, crie o papel
de novo nele e atualize o segredo.

### 4. Segredo e variável no `contai-backups`

Em Settings → Secrets and variables → Actions:

| Tipo | Nome | Valor |
|------|------|-------|
| Segredo | `BACKUP_DATABASE_URL` | `postgresql://contai_backup:<senha>@<host>/<banco>?sslmode=require` |
| Variável | `BACKUP_AGE_PUBLIC_KEY` | a chave pública `age1…` |

O host e o banco são os do `DATABASE_URL` do Render, no ramo `production`: o endpoint direto,
sem `-pooler`. O formato
muda em dois pontos: começa com `postgresql://`, sem o `+asyncpg`, e termina em `sslmode=require`
em vez de `ssl=require`.

### 5. Workflow

No `contai-backups`, crie `.github/workflows/backup.yml` com o conteúdo de
[`backup.yml`](backup.yml) e faça o commit na `main`. Depois, em Actions → Backup diário → Run
workflow, rode a primeira cópia à mão. A execução termina verde, com um artifact
`contai-<data>-pg<versão>` na página dela.

Quando o `backup.yml` mudar aqui, copie a versão nova para o `contai-backups`.

## Restauração

Precisa do `age`, do Docker e da chave privada. No Windows, rode pelo Git Bash.

1. Na execução do `backup.yml` que você quer restaurar (Actions → Backup diário), baixe o
   artifact. Ele vem num `.zip` com o `.dump.age` dentro.
2. Escolha o destino:

   - **Ensaio ou consulta**, num PostgreSQL descartável local:

     ```sh
     infra/backup/restore.sh --artifact ~/Downloads/contai-<data>-pg17.zip \
       --chave ~/contai-backup/chave-age.txt --temporario
     ```

     O script sobe o contêiner `contai-restore` na porta 5434, restaura nele e mostra as linhas
     de cada tabela e a versão das migrações. Apague o contêiner no fim:
     `docker rm -f contai-restore`.

   - **Recuperação de verdade**, num banco **vazio**, por exemplo um ramo novo do Neon criado sem
     dados:

     ```sh
     infra/backup/restore.sh --artifact ~/Downloads/contai-<data>-pg17.zip \
       --chave ~/contai-backup/chave-age.txt \
       --destino "postgresql://<usuário>:<senha>@<host>/<banco>?sslmode=require"
     ```

     Depois, aponte o `DATABASE_URL` do Render para esse banco. A API aplica as migrações que
     faltarem quando sobe.

O script confere a chave antes de mexer em qualquer banco e decifra direto para o
`pg_restore`, sem gravar a cópia aberta no disco. Ele restaura numa transação só: se algo falhar,
nada fica pela metade.

3. Compare a cópia com a origem: rode [`count-rows.sql`](count-rows.sql) no Neon e no banco
   restaurado. As contagens batem, menos `import_files`, que volta vazia, e o que mudou no Neon
   depois da hora da cópia.

## Ensaios de restauração

| Data | Cópia | Resultado |
|------|-------|-----------|
| 2026-11-08 | cópia de teste local, sem o Neon (banco descartável semeado com `scripts.seed_demo`) | ok: papel só de leitura recusou escrita; tabela criada depois do papel entrou na cópia; `import_files` voltou vazia; chave errada recusada; contagens iguais à origem nos modos `--temporario` e `--destino`, também pelo Git Bash do Windows com o `pg_restore` 18 instalado |
| — | primeira execução real do `backup.yml` (T217) | pendente |

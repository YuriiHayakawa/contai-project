#!/usr/bin/env bash
# Restaura uma cópia do backup diário (ADR 0007). Passo a passo em infra/backup/README.md.
#
# Uso:
#   infra/backup/restore.sh --artifact ARQUIVO --chave ARQUIVO --temporario
#   infra/backup/restore.sh --artifact ARQUIVO --chave ARQUIVO --destino URL
#
#   --artifact    o .zip baixado da execução do backup.yml, ou o .dump.age de dentro dele
#   --chave       o arquivo da chave privada do age, gerado pelo age-keygen
#   --temporario  sobe um PostgreSQL local descartável (contêiner contai-restore, porta 5434),
#                 restaura nele e mostra as linhas de cada tabela
#   --destino     URL de um banco VAZIO, por exemplo um ramo novo do Neon
#                 (postgresql://usuario:senha@host/banco?sslmode=require)
#
# Precisa do age e do Docker. Com --destino, usa o pg_restore instalado se ele for da versão da
# cópia ou mais novo; senão, o da imagem oficial do PostgreSQL. A cópia é decifrada direto para o
# pg_restore, sem passar pelo disco, e restaurada numa transação só: se algo falhar, nada fica
# pela metade.
set -euo pipefail

# No Git Bash do Windows, os caminhos passados ao age.exe são convertidos sozinhos; nenhum
# argumento do docker abaixo começa com barra, então nada vira caminho do Windows por engano.
CONTAINER="contai-restore"
PORT="5434"
DATABASE="contai"
# Senha do banco descartável, que só escuta em 127.0.0.1.
TEMP_PASSWORD="restore"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '4,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

fail() {
  echo "Erro: $*" >&2
  exit 1
}

artifact="" key="" target="" temporary=0
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) artifact="${2:-}"; shift 2 ;;
    --chave) key="${2:-}"; shift 2 ;;
    --destino) target="${2:-}"; shift 2 ;;
    --temporario) temporary=1; shift ;;
    -h | --help) usage ;;
    *) echo "Opção desconhecida: $1" >&2; usage ;;
  esac
done

[ -n "$artifact" ] && [ -n "$key" ] || usage
if [ "$temporary" -eq 1 ] && [ -n "$target" ]; then usage; fi
if [ "$temporary" -eq 0 ] && [ -z "$target" ]; then usage; fi
[ -f "$artifact" ] || fail "não achei o artifact $artifact"
[ -f "$key" ] || fail "não achei a chave $key"
command -v age > /dev/null || fail "instale o age (no Windows: winget install --id FiloSottile.age)"
command -v docker > /dev/null || fail "o Docker precisa estar instalado e rodando"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# O artifact baixado do GitHub vem num .zip com o .dump.age dentro.
encrypted="$artifact"
case "$artifact" in
  *.zip)
    command -v unzip > /dev/null || fail "instale o unzip, ou extraia o .dump.age e passe-o direto"
    unzip -q -o "$artifact" -d "$workdir"
    encrypted="$(find "$workdir" -name '*.dump.age' | head -n 1)"
    [ -n "$encrypted" ] || fail "o .zip não tem nenhum arquivo .dump.age"
    ;;
  *.dump.age) ;;
  *) fail "o artifact precisa ser o .zip baixado ou o .dump.age de dentro dele" ;;
esac

# O nome da cópia traz a versão do servidor de origem (contai-<data>-pg17.dump.age).
major="$(basename "$encrypted" | sed -n 's/.*-pg\([0-9][0-9]*\)\.dump\.age$/\1/p')"
major="${major:-17}"
image="postgres:${major}-alpine"
echo "Cópia: $(basename "$encrypted") (PostgreSQL $major)"

# Confere a chave antes de mexer em qualquer banco: toda cópia do pg_dump começa com PGDMP.
magic="$(age --decrypt --identity "$key" "$encrypted" 2> /dev/null | head -c 5 || true)"
[ "$magic" = "PGDMP" ] || fail "a chave não abre esta cópia, ou o arquivo não é uma cópia do pg_dump"

decrypt() {
  age --decrypt --identity "$key" "$encrypted"
}

restore_options=(--exit-on-error --single-transaction --no-owner --no-privileges)

if [ "$temporary" -eq 1 ]; then
  if docker container inspect "$CONTAINER" > /dev/null 2>&1; then
    fail "o contêiner $CONTAINER já existe; apague-o antes com: docker rm -f $CONTAINER"
  fi
  echo "Subindo o banco temporário ($image, porta $PORT)…"
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD="$TEMP_PASSWORD" -e POSTGRES_DB="$DATABASE" \
    -p "127.0.0.1:$PORT:5432" "$image" > /dev/null
  for _ in $(seq 1 60); do
    # O banco só aceita conexões pela rede depois de terminar a inicialização.
    if docker exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres -d "$DATABASE"; then
      break
    fi
    sleep 1
  done
  docker exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres -d "$DATABASE" \
    || fail "o banco temporário não ficou pronto; veja: docker logs $CONTAINER"

  echo "Restaurando…"
  decrypt | docker exec -i "$CONTAINER" pg_restore -U postgres -d "$DATABASE" "${restore_options[@]}"

  echo
  echo "Linhas de cada tabela na cópia restaurada:"
  docker exec -i "$CONTAINER" psql -X -U postgres -d "$DATABASE" < "$SCRIPT_DIR/count-rows.sql"
  echo "Versão das migrações:"
  docker exec "$CONTAINER" psql -X -U postgres -d "$DATABASE" -tAc "SELECT version_num FROM alembic_version"
  echo
  echo "Pronto. O banco restaurado fica em postgresql://postgres:$TEMP_PASSWORD@127.0.0.1:$PORT/$DATABASE"
  echo "Quando terminar, apague-o com: docker rm -f $CONTAINER"
else
  installed_major=""
  if command -v pg_restore > /dev/null; then
    installed_major="$(pg_restore --version | sed -n 's/.* \([0-9][0-9]*\)\..*/\1/p')"
  fi
  # Só o que vem depois do @: o usuário e a senha não aparecem na tela.
  echo "Restaurando em ${target#*@}…"
  if [ -n "$installed_major" ] && [ "$installed_major" -ge "$major" ]; then
    decrypt | pg_restore --dbname="$target" "${restore_options[@]}"
  else
    decrypt | docker run --rm -i -e TARGET="$target" "$image" \
      sh -c 'pg_restore --dbname="$TARGET" "$@"' sh "${restore_options[@]}"
  fi
  echo "Pronto. Confira as linhas de cada tabela com infra/backup/count-rows.sql."
fi

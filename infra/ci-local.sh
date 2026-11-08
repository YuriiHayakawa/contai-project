#!/usr/bin/env bash
# CI local: os mesmos passos de .github/workflows/ci.yml, em contêineres Linux, sem o GitHub
# Actions.
#
# Enquanto os Actions da conta estiverem bloqueados (desvio temporário do Princípio XII, ADR 0010),
# este script é o CI: rode-o antes de cada push e só faça o merge na main com tudo verde, porque
# o merge publica o app.
#
# Uso: infra/ci-local.sh [backend|frontend]    (sem argumento, roda os dois)
#
# Precisa só do Docker. Funciona no Git Bash do Windows, no Linux e no macOS. Não usa o banco nem
# os node_modules do ambiente local: o backend testa num PostgreSQL descartável, e o frontend
# instala as dependências dentro do contêiner, como no CI.
set -euo pipefail

# No Git Bash, impede que os caminhos de dentro dos contêineres virem caminhos do Windows.
export MSYS_NO_PATHCONV=1

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# O Docker do Windows precisa do caminho no formato C:/...; fora dele, pwd já serve.
host_root="$(cd "$root" && (pwd -W 2> /dev/null || pwd))"
run_id="contai-ci-$$"
postgres_password="contai_ci"

cleanup() {
  docker rm -f "$run_id-postgres" > /dev/null 2>&1 || true
  docker network rm "$run_id" > /dev/null 2>&1 || true
}
trap cleanup EXIT

step() {
  echo
  echo "== $*"
}

backend() {
  step "Backend: imagem com as dependências do uv.lock"
  docker build -q --target dev -t contai-ci-backend "$host_root/backend" > /dev/null

  step "Backend: PostgreSQL descartável"
  docker network create "$run_id" > /dev/null
  docker run -d --name "$run_id-postgres" --network "$run_id" \
    -e POSTGRES_USER=contai -e POSTGRES_PASSWORD="$postgres_password" \
    -e POSTGRES_DB=contai_test postgres:17-alpine > /dev/null
  for _ in $(seq 1 60); do
    if docker exec "$run_id-postgres" pg_isready -q -h 127.0.0.1 -U contai -d contai_test; then
      break
    fi
    sleep 1
  done

  step "Backend: lint, formatação, tipos, testes com cobertura e auditoria"
  docker run --rm --network "$run_id" -v "$host_root/backend:/app" -w /app \
    -e ENVIRONMENT=development -e AI_PROVIDER=fake \
    -e TEST_DATABASE_URL="postgresql+asyncpg://contai:$postgres_password@$run_id-postgres:5432/contai_test" \
    --entrypoint sh contai-ci-backend -c '
      set -e
      echo "-- ruff check";        ruff check .
      echo "-- ruff format";       ruff format --check .
      echo "-- mypy";              mypy app
      echo "-- pytest";            pytest --cov=app/modules --cov-fail-under=80 -q -p no:cacheprovider
      echo "-- pip-audit";         pip-audit
    '
}

frontend() {
  step "Frontend: npm ci, lint, formatação, tipos, testes e auditoria"
  # node_modules fica num volume anônimo: o do Windows não serve no Linux, e vice-versa.
  docker run --rm -v "$host_root/frontend:/app" -v /app/node_modules \
    -v contai-ci-npm-cache:/root/.npm -w /app node:24-alpine sh -c '
      set -e
      echo "-- npm ci";            npm ci --no-audit --no-fund --loglevel=error
      echo "-- lint";              npm run --silent lint
      echo "-- formatação";        npm run --silent format:check
      echo "-- tipos";             npm run --silent typecheck
      echo "-- testes";            npm test --silent
      echo "-- auditoria";         npm audit
    '
}

case "${1:-all}" in
  backend) backend ;;
  frontend) frontend ;;
  all)
    backend
    frontend
    ;;
  *)
    echo "Uso: infra/ci-local.sh [backend|frontend]" >&2
    exit 2
    ;;
esac

echo
echo "CI local verde."

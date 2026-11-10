#!/usr/bin/env bash
# Create the per-service logical databases on first volume initialization.
# This script is mounted at /docker-entrypoint-initdb.d and runs only when the
# PostgreSQL data directory is empty. It never creates application tables and
# never drops or truncates data.
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

create_database_if_missing() {
  local dbname="$1"

  psql \
    --no-password \
    -v ON_ERROR_STOP=1 \
    --set=dbname="$dbname" \
    --set=owner="$POSTGRES_USER" \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'dbname', :'owner')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'dbname')
\gexec
SQL
}

create_database_if_missing "products"
create_database_if_missing "payments"

printf 'Databases products and payments are ready.\n'

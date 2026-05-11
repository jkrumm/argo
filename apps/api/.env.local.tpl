# Local dev environment template.
# Usage: op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun run start
#
# Local Postgres runs on port 5433 (docker-compose.dev.yml).
# Same password as production; sourced from op://vps/argo/DB_PASSWORD.
# Production DATABASE_URL points to VPS Postgres — see Group 11 cutover notes.

DATABASE_URL=postgres://argo:op://vps/argo/DB_PASSWORD@localhost:5433/argo
ARGO_DB_PASSWORD=op://vps/argo/DB_PASSWORD

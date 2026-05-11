DB_COMPOSE := apps/api/docker-compose.dev.yml

# Sources .ralph-secrets.env if present (RALPH automation pre-fetches it).
# For manual dev, ensure ARGO_DB_PASSWORD is set in the environment or via:
#   op run --account tkrumm --env-file=apps/api/.env.local.tpl -- make db-up
-include .ralph-secrets.env
export

.PHONY: db-up db-down db-reset

db-up:
	docker compose -f $(DB_COMPOSE) up -d

db-down:
	docker compose -f $(DB_COMPOSE) down

db-reset:
	docker compose -f $(DB_COMPOSE) down -v
	docker compose -f $(DB_COMPOSE) up -d

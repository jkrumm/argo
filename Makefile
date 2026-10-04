# Argo Makefile — thin wrappers over the repo's own scripts and the exact CI gates.
# Self-documenting: `make` (or `make help`) lists every target below.

.DEFAULT_GOAL := help

.PHONY: help check deploy verify logs

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

check: ## Run exactly the local validation CI runs (drift, lint, format, typecheck, unit tests)
	./node_modules/.bin/basalt-ui sync --check
	bun run lint
	bun run format:check
	bun --cwd apps/api typecheck
	bun --cwd apps/dashboard typecheck
	DATABASE_URL=postgres://localhost:5432/placeholder API_SECRET=ci-placeholder bun --cwd apps/api test src/env.test.ts src/lib/

deploy: ## Report the deploy path (production deploys via CI on push to master)
	@echo "deployed by CI on push"

verify: ## Probe the production health endpoint (exit 0 = live and healthy)
	curl -fsS https://argo.jkrumm.com/api/health

logs: ## Tail the last 200 lines of production API logs, then exit (no follow)
	ssh vps 'docker logs --tail 200 $$(docker ps -q --filter "label=com.docker.compose.service=argo-api" | head -n1)'

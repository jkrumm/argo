# Argo Makefile — thin wrappers over the repo's own scripts and the exact CI gates.
# Self-documenting: `make` (or `make help`) lists every target below.

.DEFAULT_GOAL := help

.PHONY: help check deploy verify rollback logs evidence design-shot db-rehearse verify-pages

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

check: ## Run exactly the local validation CI runs (drift, lint, format, typecheck incl. scripts/, unit tests incl. dashboard)
	./node_modules/.bin/basalt-ui sync --check
	bun run lint
	bun run format:check
	bun --cwd apps/api typecheck
	bun --cwd apps/dashboard typecheck
	bun run typecheck:scripts
	bun --cwd apps/dashboard test
	DATABASE_URL=postgres://localhost:5432/placeholder API_SECRET=ci-placeholder bun --cwd apps/api test src/env.test.ts src/lib/

deploy: ## Deploy origin/master to the mini: release, LaunchAgent, health wait, rollback on failure (DRY_RUN=1 = plan only)
	@zsh scripts/deploy.sh

verify: ## Prove the deployed process: launchd, sha = origin/master, SPA + assets, bearer guard, both DB schemas, clean stderr
	@zsh scripts/verify.sh

rollback: ## Put the previous release live again (exit non-zero if it cannot); a second rollback goes forward
	@zsh scripts/deploy.sh rollback

logs: ## Last 200 lines of the mini's argo.out.log / argo.err.log, then exit (no follow)
	@for f in "$$HOME/Library/Logs/argo.out.log" "$$HOME/Library/Logs/argo.err.log"; do \
		if [ -f "$$f" ]; then echo "==> $$f <=="; tail -n 200 "$$f"; else echo "==> $$f: not found"; fi; \
	done

evidence: ## Real-data baseline (bundle/screens/lighthouse): make evidence LABEL=<label>
	@test -n "$(LABEL)" || { echo "usage: make evidence LABEL=<label>"; exit 2; }
	@bun scripts/evidence/index.ts "$(LABEL)"

design-shot: ## Live-data screenshots + crops board: make design-shot [ROUTES="/agents /warden"] [LABEL=<label>] [SKIP_BUILD=1]
	@DESIGN_SHOT_LABEL='$(LABEL)' DESIGN_SHOT_ROUTES='$(ROUTES)' DESIGN_SHOT_SKIP_BUILD='$(SKIP_BUILD)' bun scripts/design-shot/index.ts

db-rehearse: ## Copy the VPS argo schema into the mini's shared database and prove row counts + checksums (replaces shared.argo)
	@secrets-run run --env-file=apps/api/.env.local.tpl -- ./scripts/db-rehearse.sh

verify-pages: ## Load every dashboard route in Chrome against the running Argo (BASE=<origin>, default the mini loopback); exit 1 on page errors / 5xx
	@bun run verify:pages

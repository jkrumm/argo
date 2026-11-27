# API tests

Moved from `apps/api/AGENTS.md` §Tests. Read before running the API tests or adding a test.

## Tests

```bash
# Run all tests (from repo root). The admin connection is the unix socket in /tmp as the OS user, no
# password (ARGO_TEST_PG_USER + ARGO_TEST_PG_PASSWORD switch it to TCP); scripts/test.sh creates a
# scratch database argo_test_<12 hex> on that cluster, creates schemas `argo` and `usage`, applies usage-tracker's plain-SQL migrations
# (~/SourceRoot/usage-tracker/migrations/pg, or $USAGE_MIGRATIONS_DIR), points DATABASE_URL at it,
# runs `bun test --cwd apps/api` and drops the database in a trap. The argo tables come from the
# tests' own runMigrations(). Missing migrations dir or secrets: it fails with a message.
bun test:api

# Pass through filters/flags to `bun test`, e.g. a single file:
bun test:api src/routes/workouts.summary.test.ts

# Pure unit tests only (no DB): the DB-free set is the `test:unit` script in package.json
# (it sets placeholder DATABASE_URL / API_SECRET itself; this is what `make check` runs):
bun run --cwd apps/api test:unit
```

> The app role `argo` can only SELECT on schema `usage`, which is why the integration tests run as
> admin in a scratch database instead of the shared one. A bare `bun test` fails integration tests
> with `DATABASE_URL ... undefined`; use `bun test:api`. The Postgres on the mini must be up
> (see `~/SourceRoot/dotfiles/docs/postgres.md`).

Tests live alongside source files as `*.test.ts`:

- `src/lib/formulas.test.ts` — unit tests for pure formula functions (no DB)
- `src/env.test.ts` — env schema validation
- `src/routes/finance.test.ts` — `/finance/*` relay against a fake `fin serve` (no DB; in `make check`): status passthrough, 423/401/429/409, 503 on a dead service, and that the vault key never reaches logs or span attributes
- `src/routes/paper.test.ts` — `/paper/*` against a fake `hc` around a fake `paper` executable (no DB; in `make check`): refusal, timeout, unparseable output, core down, path escape, no scan or print without its POST (`docs/api/paper.md`)
- `src/routes/models.test.ts` — `GET /models/efficiency` relay against a fake modelpick server (no DB; in `make check`): bearer guard, no bearer forwarded, status passthrough, 503 on a dead service
- `src/serve-dashboard.test.ts`, `src/otlp-headers.test.ts` — native runtime serving + OTLP auth (no DB)
- `src/routes/openapi-auth.test.ts` — walks `/openapi/json` and asserts every non-public path answers 401 without a bearer (no DB; add a new public route to its `PUBLIC` set only on purpose)
- `src/routes/workouts.summary.test.ts` — integration: strength summary endpoint
- `src/routes/daily-metrics.summary.test.ts` — integration: health summary endpoint
- `src/routes/weight-log.summary.test.ts` — integration: weight summary endpoint

The DB-free set (everything in `test:unit`: `src/lib`, `src/clients`, `src/cron`, the env/runtime tests and the route tests that stub their upstreams) runs in `make check` and CI; a test that touches the database stays out of it. Integration tests seed fixtures in `beforeEach`/`afterEach` and require a live Postgres. The usage tests seed schema `usage` through `src/test/usage-seed.ts` (`seedUsageRecords` takes the records in the read model's column names and writes `usage.records`; `seedQuotaSamples`, `seedAccountPicks`, `seedIuPortal` and the `delete*` cleanups cover the other tables); `src/db/usage-source.test.ts` pins the `USAGE_ROWS` projection itself.

# Deploy verification

`GET /health` returns `{status, commit}`; behind the dashboard origin it is also `GET /api/health`. `commit` is the
`GIT_SHA` of the build, read once at module load in `apps/api/src/routes/health.ts`. A deploy is confirmed once that
value equals `git rev-parse origin/master`. Argo deploys one way, natively on the Mac mini:

- `make deploy` renders `GIT_SHA=<sha>` into the LaunchAgent plist and waits until
  `http://127.0.0.1:7737/api/health` reports `status: ok` and that sha; only then are `deployed-sha` / `previous-sha` written.
  `make verify` (`scripts/verify.sh`) re-proves the whole chain: serving sha = `deployed-sha` = `origin/master`, the SPA
  and its assets, the bearer guard and both database schemas (see `AGENTS.md` Verify & Monitor).
- From a tailnet client, `curl -s https://argo.jkrumm.com/api/health` answers the same sha through the Caddy door.

## Verification log

- 2026-09-10 — probe documented; verify with `curl -s https://argo.jkrumm.com/api/health`
- 2026-10-30 — native mini deploy added (`scripts/deploy.sh`, `verify.sh`, `launch.sh`)
- 2026-10-30 — cutover: the mini serves `argo.jkrumm.com`; the VPS path (RollHook, Dockerfiles, workflow) is retired

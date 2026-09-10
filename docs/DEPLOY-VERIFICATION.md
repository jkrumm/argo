# Deploy verification

`GET https://argo.jkrumm.com/api/health` returns `{status, commit}`. `commit` is the `GIT_SHA`
the Deploy workflow bakes into the api image at build time — set as a `rollhook-action` build
arg in `.github/workflows/deploy.yml`, read once at module load in
`apps/api/src/routes/health.ts`, and wired into the image by `apps/api/Dockerfile`. A deploy is
confirmed once that value equals `git rev-parse origin/master`.

The dashboard image carries no sha (its build only bakes `VITE_HYPERDX_API_KEY`), so only the
API can be verified this way — a landed dashboard deploy has no probe of its own.

## Verification log

- 2026-09-10 — probe documented; verify with `curl -s https://argo.jkrumm.com/api/health`

# Deploy-verification canary

`GET https://argo.jkrumm.com/api/health` returns `{ status, commit }`, where `commit` is
the `GIT_SHA` the Deploy workflow bakes into the api image as a build-arg
(`.github/workflows/deploy.yml` → `apps/api/Dockerfile` → `apps/api/src/routes/health.ts`).
An external control plane can compare `commit` against a merge SHA to confirm that a specific
change landed and is serving traffic, not just that the container is up.

This file is the one path such a control plane is allowed to change on its own.

## Verification log

- 2026-09-10: `docs/CANARY.md` added; probe verified against `apps/api/src/routes/health.ts`,
  `apps/api/Dockerfile`, and `.github/workflows/deploy.yml`.

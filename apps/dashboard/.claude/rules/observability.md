# Observability

`apps/dashboard/src/main.tsx`'s first line is `import './lib/hyperdx'`. The
HyperDX browser SDK monkey-patches `fetch` on init — if any module that uses
`fetch` (Eden Treaty, TanStack Query) loads before HyperDX, its network calls
do not get traced.

The OTLP endpoint is reached via Vite proxy (`/v1/traces`, `/v1/logs` →
`127.0.0.1:4318`) in dev. Production passes `VITE_HYPERDX_ENDPOINT` +
`VITE_HYPERDX_API_KEY` at build time via Docker `--build-arg`.

When `VITE_HYPERDX_API_KEY` is not set, HyperDX is silently disabled — no
errors, no traces. This is intentional for local dev without ClickStack running.

# Local dev: the Vite proxy (/api → localhost:4000) works without this var.
# Set it to bypass the proxy and hit the API directly.
# VITE_API_URL=http://localhost:4000

# HyperDX — local dev hits the unauthed ClickStack :4319 receiver via the Vite
# proxy, so the SDK key is effectively a placeholder (whatever value lands in
# the `authorization` header is ignored by :4319). The browser SDK still
# requires apiKey to be non-empty at init, so we hand it a literal sentinel.
# Prod build pulls VITE_HYPERDX_API_KEY from the GHA org secret HYPERDX_API_KEY_PROD
# (see .github/workflows/deploy.yml — that path stays authed via Traefik → :4318).
#
# VITE_HYPERDX_ENDPOINT MUST be an absolute origin (the SDK appends /v1/traces).
# Unset → window.location.origin → Vite proxy → 127.0.0.1:4319. Do NOT set this
# to a relative path like "/" — the OTLP exporter requires absolute URLs and
# will silently fall back to in-otel.hyperdx.io (HyperDX Cloud), bypassing
# local ClickStack.
# VITE_HYPERDX_ENDPOINT=
VITE_HYPERDX_API_KEY=local-dev-no-auth
VITE_HYPERDX_SERVICE_NAME=argo-dashboard

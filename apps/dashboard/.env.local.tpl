# Local dev: the Vite proxy (/api → localhost:4000) works without this var.
# Set it to bypass the proxy and hit the API directly.
# VITE_API_URL=http://localhost:4000

# HyperDX — see op://vps/argo/HYPERDX_API_KEY for the actual key.
# VITE_HYPERDX_ENDPOINT MUST be an absolute origin (the SDK appends /v1/traces).
# Unset → falls back to window.location.origin, which in dev hits the Vite proxy
# at /v1/traces → 127.0.0.1:4318. Do NOT set this to a relative path like "/" —
# the OTLP exporter requires absolute URLs and will silently fall back to
# in-otel.hyperdx.io (HyperDX Cloud), bypassing local ClickStack.
# VITE_HYPERDX_ENDPOINT=
VITE_HYPERDX_API_KEY=op://vps/argo/HYPERDX_API_KEY_LOCAL
VITE_HYPERDX_SERVICE_NAME=argo-dashboard

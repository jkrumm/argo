# Local dev: the Vite proxy (/api → localhost:4000) works without this var.
# Set it to bypass the proxy and hit the API directly.
# VITE_API_URL=http://localhost:4000

# HyperDX — see op://vps/argo/HYPERDX_API_KEY for the actual key.
# In dev, leave VITE_HYPERDX_ENDPOINT unset (defaults to window.location.origin,
# which the Vite proxy forwards to 127.0.0.1:4318).
VITE_HYPERDX_ENDPOINT=/
VITE_HYPERDX_API_KEY=op://vps/argo/HYPERDX_API_KEY
VITE_HYPERDX_SERVICE_NAME=argo-dashboard

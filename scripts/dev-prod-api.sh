#!/usr/bin/env bash
# Run the dashboard locally with its `/api/*` proxy pointed at prod
# (argo.jkrumm.com). No local API or Postgres needed.
#
# Auth still flows through the existing token modal — the bearer is sent on
# every request and the proxy forwards it. No secrets land on disk.
#
# Usage: bun dev:prod-api

set -euo pipefail

export VITE_API_TARGET="${VITE_API_TARGET:-https://argo.jkrumm.com/api}"

npx --yes kill-port 7715 >/dev/null 2>&1 || true

echo "→ dashboard proxy /api → $VITE_API_TARGET"
exec bun run --cwd apps/dashboard dev

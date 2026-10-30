#!/bin/zsh
# Argo process launcher: the ProgramArguments of the LaunchAgent (com.jkrumm.argo).
# Never point launchd at a Homebrew binary directly (macOS BTM silently disallows it); this wrapper is the indirection,
# and it fails closed (exit 78) unless every ref in .env.tpl resolves to a non-empty value. Runs from a release
# (~/.argo/releases/<sha>, the one the plist names), never the dev checkout. No secret is ever printed: refs are named,
# values never.
#
#   launch.sh            resolve, assemble, exec the API
#   launch.sh --check    resolve and verify only, then exit 0 (the deploy runs this before it stops anything)

set -u

DIR="${0:A:h:h}"  # scripts/launch.sh -> repo root
cd "$DIR" || { print -u2 "argo: cannot cd to $DIR"; exit 78; }

[[ "${1:-}" == "--check" ]] && export ARGO_LAUNCH_CHECK=1

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# `timeout` is a Homebrew coreutils binary (macOS ships none); a missing one must not read as an unrelated error.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
else
  print -u2 "argo: neither 'timeout' nor 'gtimeout' on PATH (brew install coreutils)"
  exit 78
fi

SECRETS_RUN="$HOME/.local/bin/secrets-run"
TPL="$DIR/.env.tpl"
ENTRY="apps/api/src/index.ts"

[[ -x "$SECRETS_RUN" ]] || { print -u2 "argo: $SECRETS_RUN missing"; exit 78; }
[[ -f "$TPL" ]]         || { print -u2 "argo: $TPL missing"; exit 78; }
[[ -f "$DIR/$ENTRY" ]]  || { print -u2 "argo: $ENTRY missing"; exit 78; }
command -v bun >/dev/null 2>&1 || { print -u2 "argo: bun not on PATH"; exit 78; }

# Every ref must resolve BEFORE the hand-off: an unresolved ref would otherwise reach the process as nothing at all.
RENDERED=$("$TIMEOUT_BIN" 20 "$SECRETS_RUN" export --env-file="$TPL" 2>/dev/null | /usr/bin/grep -c '^export ')
WANT=$(/usr/bin/grep -hoE '^[A-Za-z_][A-Za-z0-9_]*=' "$TPL" | /usr/bin/sort -u | /usr/bin/wc -l | /usr/bin/tr -d ' ')
if [[ -z "$RENDERED" || "$RENDERED" -lt "$WANT" ]]; then
  print -u2 "argo: only ${RENDERED:-0}/$WANT refs of .env.tpl resolved; refusing to start."
  # Name the refs that do not resolve (the ref, never a value). Failure path only: one read per ref.
  /usr/bin/grep -hoE '^[A-Za-z_][A-Za-z0-9_]*=op://[^[:space:]]+' "$TPL" | while IFS='=' read -r key ref; do
    "$TIMEOUT_BIN" 20 "$SECRETS_RUN" read "$ref" >/dev/null 2>&1 || print -u2 "  unresolved: $key ($ref)"
  done
  print -u2 "  Seed the missing refs (add to dotfiles-private/headless.refs, then \`make secrets-seed\` on the MacBook) and retry."
  exit 78
fi

# A ref can resolve to an empty value; that is as unusable as a missing one. Checked inside the child, where the
# values exist: the key is named, the value never printed. Keys come from the template, so `eval` sees only names.
KEYS=( ${(f)"$(/usr/bin/grep -hoE '^[A-Za-z_][A-Za-z0-9_]*=' "$TPL" | /usr/bin/tr -d =)"} )

# secrets-run resolves whole-value refs only, so the composite values are built after it, inside its child. The
# database URL targets the shared cluster: role argo, database shared; the argo schema is selected by Drizzle's
# pgSchema, no search_path. The raw ARGO_DB_PASSWORD and OTEL_EXPORTER_OTLP_AUTHORIZATION are dropped before the API
# starts; the built OTEL_EXPORTER_OTLP_HEADERS (`authorization=<ClickStack ingest key>`) is what the exporter reads.
exec "$SECRETS_RUN" run --env-file="$TPL" -- /bin/sh -c '
  for key in "$@"; do
    eval "value=\${$key-}"
    [ -n "$value" ] || { echo "argo: $key resolved to an empty value; refusing to start." >&2; exit 78; }
  done
  if [ -n "${ARGO_LAUNCH_CHECK:-}" ]; then
    echo "argo: all $# refs of .env.tpl resolved to non-empty values"
    exit 0
  fi
  DATABASE_URL="postgres://argo:$(bun -e "process.stdout.write(encodeURIComponent(process.env.ARGO_DB_PASSWORD))")@127.0.0.1:5432/shared"
  OTEL_EXPORTER_OTLP_HEADERS="authorization=$OTEL_EXPORTER_OTLP_AUTHORIZATION"
  export DATABASE_URL OTEL_EXPORTER_OTLP_HEADERS
  unset ARGO_DB_PASSWORD OTEL_EXPORTER_OTLP_AUTHORIZATION
  exec bun '"$ENTRY"'
' sh "${KEYS[@]}"

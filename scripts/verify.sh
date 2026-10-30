#!/bin/zsh
# Argo verify (`make verify`): exit 0 only if the deployed process is healthy, runs origin/master, serves the
# dashboard and the API, and reads both database schemas. Checks, in order:
#   1. the LaunchAgent is loaded
#   2. GET /api/health is ok and its commit == deployed-sha == origin/master of the clone (prints clearly when origin/master
#      moved ahead of the deploy)
#   3. GET / is the SPA, an /assets/* file it names answers 200 with an immutable Cache-Control
#   4. unauthenticated GET /api/usage/summary is 401
#   5. with the bearer: /api/usage/summary (usage schema) and /api/exercises (argo schema) answer 200 JSON, and
#      /api/openapi/json parses as JSON
#   6. the stderr log has no Unhandled / ECONNREFUSED on 5432 / password authentication failure since the process started
# ARGO_ROOT relocates ~/.argo (tests); the port is fixed.

set -u

LABEL="com.jkrumm.argo"
ROOT="${ARGO_ROOT:-$HOME/.argo}"
REPO_DIR="$ROOT/repo"
SHA_FILE="$ROOT/data/deployed-sha"
ERR_OFFSET_FILE="$ROOT/data/err-log-offset"
ERR_LOG="$HOME/Library/Logs/argo.err.log"
BASE="http://127.0.0.1:7737"
API_SECRET_REF="op://common/api/SECRET"
BAD_LOG='Unhandled|ECONNREFUSED.*5432|password authentication failed'

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() { print -u2 "verify: FAIL: $*"; exit 1; }
ok() { print "verify: ok: $*"; }

for tool in git curl jq secrets-run launchctl; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool not found on PATH"
done

root_body=$(mktemp -t argo-verify) || fail "cannot create a temp file"
asset_headers=$(mktemp -t argo-verify) || fail "cannot create a temp file"
body=$(mktemp -t argo-verify) || fail "cannot create a temp file"
trap 'rm -f -- "$root_body" "$asset_headers" "$body"' EXIT

# 1. launchd
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || fail "$LABEL is not loaded (run make deploy)"
ok "$LABEL is loaded"

# 2. health, and the sha chain: serving == deployed == origin/master
health=$(curl -fsS --max-time 5 "$BASE/api/health") || fail "no answer from $BASE/api/health"
[[ "$(print -r -- "$health" | jq -r '.status')" == "ok" ]] || fail "/api/health is not ok: $health"
commit=$(print -r -- "$health" | jq -r '.commit')
ok "/api/health ok (commit ${commit[1,12]})"

deployed=$(tr -d '[:space:]' < "$SHA_FILE" 2>/dev/null) || fail "$SHA_FILE missing: nothing was deployed"
[[ -n "$deployed" ]] || fail "$SHA_FILE is empty"
remote=$(git -C "$REPO_DIR" ls-remote origin refs/heads/master 2>/dev/null | awk '{print $1}')
[[ -n "$remote" ]] || fail "cannot read origin/master from $REPO_DIR (run make deploy first)"
[[ "$commit" == "$deployed" ]] || fail "the running process reports ${commit[1,12]}, deployed-sha is ${deployed[1,12]}"
[[ "$deployed" == "$remote" ]] || fail "origin/master moved ahead: deployed ${deployed[1,12]}, origin/master ${remote[1,12]} (run make deploy)"
ok "serving = deployed = origin/master (${deployed[1,12]})"

# 3. the SPA and a hashed asset
root_status=$(curl -sS --max-time 10 -o "$root_body" -w '%{http_code}' "$BASE/") || fail "no answer from GET /"
[[ "$root_status" == "200" ]] || fail "GET / answered $root_status, not 200"
/usr/bin/grep -q '<div id="root"' "$root_body" || fail "GET / is not the SPA (no <div id=\"root\">): $(head -c 200 "$root_body")"
asset=$(/usr/bin/grep -oE '/assets/[^"'"'"' )]+\.(js|css)' "$root_body" | head -n 1)
[[ -n "$asset" ]] || fail "the SPA names no /assets/* file"
asset_status=$(curl -sS --max-time 10 -D "$asset_headers" -o /dev/null -w '%{http_code}' "$BASE$asset") || fail "no answer from $asset"
[[ "$asset_status" == "200" ]] || fail "GET $asset answered $asset_status, not 200"
/usr/bin/grep -iq '^cache-control:.*immutable' "$asset_headers" \
  || fail "GET $asset has no immutable Cache-Control: $(/usr/bin/grep -i '^cache-control' "$asset_headers" || print 'no header')"
ok "GET / is the SPA; $asset is 200 and immutable"

# 4. the bearer guard
unauth=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/api/usage/summary") || fail "no answer from /api/usage/summary"
[[ "$unauth" == "401" ]] || fail "an unauthenticated GET /api/usage/summary got $unauth, not 401"
ok "unauthenticated /api/usage/summary is 401"

# 6. authenticated reads. The bearer goes through curl's config on stdin, never the command line (ps would show it).
secret=$(secrets-run read "$API_SECRET_REF" 2>/dev/null)
[[ -n "$secret" ]] || fail "cannot read $API_SECRET_REF through secrets-run"
authed_get() {  # $1 path -> body in $body; prints the status
  print -r -- "header = \"authorization: Bearer $secret\"" | curl -sS --max-time 30 -K - -o "$body" -w '%{http_code}' "$BASE$1"
}
check_json() {  # $1 path, $2 what it proves
  local status
  status=$(authed_get "$1") || fail "no answer from $1"
  [[ "$status" == "200" ]] || fail "authenticated GET $1 answered $status, not 200: $(head -c 300 "$body")"
  jq -e . "$body" >/dev/null 2>&1 || fail "GET $1 is not JSON: $(head -c 300 "$body")"
  ok "GET $1 is 200 JSON ($2)"
}
check_json /api/usage/summary "reads the usage schema"
check_json /api/exercises "reads the argo schema"
check_json /api/openapi/json "the OpenAPI document"

# 7. stderr since this process started: from the byte offset deploy recorded before bootstrap; without one, only when
# the log was written after the deploy marker (then its last 200 lines).
if [[ -f "$ERR_LOG" ]]; then
  offset=$(tr -d '[:space:]' < "$ERR_OFFSET_FILE" 2>/dev/null)
  size=$(/usr/bin/stat -f %z "$ERR_LOG")
  if [[ "$offset" == <-> && "$offset" -le "$size" ]]; then
    recent=$(tail -c +$((offset + 1)) "$ERR_LOG")
  elif [[ "$ERR_LOG" -nt "$SHA_FILE" ]]; then
    recent=$(tail -n 200 "$ERR_LOG")
  else
    recent=""
  fi
  bad=$(print -r -- "$recent" | /usr/bin/grep -E "$BAD_LOG" | head -n 5)
  [[ -z "$bad" ]] || fail "$ERR_LOG has error lines since the process started:"$'\n'"$bad"
fi
ok "no Unhandled / ECONNREFUSED :5432 / password authentication failed in the stderr log since start"

print "verify: PASS ${deployed[1,12]}"

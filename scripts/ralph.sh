#!/usr/bin/env bash
# Argo — RALPH Loop Runner
#
# Usage:
#   ./scripts/ralph.sh              # Run all pending groups
#   ./scripts/ralph.sh 3            # Run only group 3
#   ./scripts/ralph.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph.sh --status     # Print status and exit
#
# Logs: .ralph-logs/group-N.log
# Watch live: tail -f .ralph-logs/group-N.log
#
# Prerequisites:
#   brew install coreutils   # for gtimeout
#   claude CLI must be in PATH
#   bun, docker (Group 2+), op (1Password CLI, --account tkrumm)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/ralph"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"

MAX_RETRIES=3
CLAUDE_TIMEOUT=2700  # 45 minutes per group

# ── 1Password signing guard ───────────────────────────────────────────────────
# `commit.gpgsign=true` with op-ssh-sign hangs on Touch ID for every commit.
# We disable local signing for the loop and restore on exit. The global setting
# (and other repos) are untouched.

ORIG_GPGSIGN=""
GPGSIGN_TOUCHED=false

disable_commit_signing() {
  cd "$REPO_ROOT"
  ORIG_GPGSIGN="$(git config --local --get commit.gpgsign || echo '__unset__')"
  local effective
  effective="$(git config --get commit.gpgsign || echo 'false')"
  if [[ "$effective" == "true" ]]; then
    log_warn "commit.gpgsign=true detected — disabling for the loop (would block on Touch ID)."
    git config --local commit.gpgsign false
    GPGSIGN_TOUCHED=true
  fi
}

restore_commit_signing() {
  $GPGSIGN_TOUCHED || return 0
  cd "$REPO_ROOT" 2>/dev/null || return 0
  if [[ "$ORIG_GPGSIGN" == "__unset__" ]]; then
    git config --local --unset commit.gpgsign 2>/dev/null || true
  else
    git config --local commit.gpgsign "$ORIG_GPGSIGN"
  fi
  log_info "Restored commit.gpgsign (was: $ORIG_GPGSIGN)."
}

cleanup_on_exit() {
  restore_commit_signing
  remove_push_guard
  remove_secrets
}

trap cleanup_on_exit EXIT

# ── Master guard ──────────────────────────────────────────────────────────────
# Autonomous commits to the default branch are a hazard — deploy.yml fires on
# push. Refuse to run if HEAD is on master/main; let the user pick a branch.

refuse_default_branch() {
  cd "$REPO_ROOT"
  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  case "$current" in
    master|main)
      log_error "Refusing to run on '$current' — autonomous commits to the default branch are unsafe."
      log_error "Switch to a feature/migration branch first: git checkout -b <name>"
      exit 1
      ;;
  esac
  log_info "Running on branch: $current"
}

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

TOTAL_GROUPS=15

GROUP_TITLES=(
  ""  # 1-indexed
  "Workspace move & legacy preservation"
  "Strictness baseline (TS base + extended oxlint + lefthook)"
  "Postgres migration (driver + schema + data + dev)"
  "apps/dashboard scaffold"
  "Dashboard data layer (Eden + Query + Zustand + router-context)"
  "Extract visx to packages/charts"
  "API: schema lib swap (TypeBox → Zod) + OpenAPI plugin"
  "API: pagination convention swap"
  "API: summary endpoints (server-computed aggregates)"
  "OTel + HyperDX observability (backend + frontend)"
  "Garmin Health page"
  "Strength Tracker + Body Weight"
  "Tests + React Compiler + rules + CLAUDE.md + CI workflow"
  "Cutover + cleanup (frontend deploy + data migration + prune)"
  "Documentation polish (descriptive-voice final pass)"
)

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  local missing=0
  for cmd in claude gtimeout python3 bun op; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "$cmd not found."
      missing=1
    fi
  done
  [[ $missing -eq 0 ]] || { echo "Install: brew install coreutils oven-sh/bun/bun anthropic/cli 1password-cli"; exit 1; }
}

# ── 1Password session pre-flight ──────────────────────────────────────────────
# Groups that use `op run --account tkrumm` will hang on Touch ID if no session
# is active. Verify upfront so the user can sign in once before walking away.

require_op_session() {
  log_info "Verifying 1Password CLI session (op --account tkrumm)..."
  if ! gtimeout 5 op whoami --account tkrumm >/dev/null 2>&1; then
    log_error "1Password CLI session is not active for account 'tkrumm'."
    log_error "Sign in once before launching the loop:"
    log_error "  eval \$(op signin --account tkrumm)"
    log_error "Or extend the session cache in 1Password app settings."
    exit 1
  fi
  log_success "op session active."
}

# ── Secrets pre-fetch ─────────────────────────────────────────────────────────
# Read all prod secrets once at startup (Touch ID approvable now), write to
# .ralph-secrets.env (mode 600, gitignored). Groups source this file directly
# instead of invoking `op run` mid-loop. Trap deletes the file on exit.

SECRETS_FILE="$REPO_ROOT/.ralph-secrets.env"

prefetch_secrets() {
  log_info "Pre-fetching secrets via op (Touch ID may prompt)..."
  local db_password
  db_password="$(gtimeout 30 op read 'op://vps/argo/DB_PASSWORD' --account tkrumm 2>/dev/null || true)"
  if [[ -z "$db_password" ]]; then
    log_error "Failed to read op://vps/argo/DB_PASSWORD."
    log_error "Make sure the 1Password app is unlocked and you've approved Touch ID."
    exit 1
  fi
  umask 077
  cat > "$SECRETS_FILE" <<EOF
# Auto-generated by scripts/ralph.sh — DO NOT COMMIT. Deleted on runner exit.
# Single password used for both local dev container and production VPS Postgres.
ARGO_DB_PASSWORD=$db_password
ARGO_LOCAL_DATABASE_URL=postgres://argo:$db_password@localhost:5433/argo
EOF
  chmod 600 "$SECRETS_FILE"
  # Export into runner env so subprocesses (claude -p) inherit it.
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
  log_success "Secrets cached to .ralph-secrets.env (mode 600) and exported."
}

remove_secrets() {
  [[ -f "$SECRETS_FILE" ]] || return 0
  rm -f "$SECRETS_FILE"
  log_info "Removed .ralph-secrets.env."
}

# ── git push guard ────────────────────────────────────────────────────────────
# Belt-and-suspenders: even though the runner commits but never pushes, install
# a pre-push hook so an autonomous `git push` from Claude can't fire deploy.yml.

PRE_PUSH_HOOK=""
PRE_PUSH_BACKUP=""

install_push_guard() {
  cd "$REPO_ROOT"
  PRE_PUSH_HOOK="$(git rev-parse --git-path hooks)/pre-push"
  if [[ -f "$PRE_PUSH_HOOK" ]]; then
    PRE_PUSH_BACKUP="${PRE_PUSH_HOOK}.ralph-backup"
    mv "$PRE_PUSH_HOOK" "$PRE_PUSH_BACKUP"
  fi
  cat > "$PRE_PUSH_HOOK" <<'HOOK'
#!/usr/bin/env bash
echo "[ralph] pre-push hook: autonomous push blocked. Push manually after the loop completes." >&2
exit 1
HOOK
  chmod +x "$PRE_PUSH_HOOK"
}

remove_push_guard() {
  [[ -n "$PRE_PUSH_HOOK" && -f "$PRE_PUSH_HOOK" ]] || return 0
  rm -f "$PRE_PUSH_HOOK"
  if [[ -n "$PRE_PUSH_BACKUP" && -f "$PRE_PUSH_BACKUP" ]]; then
    mv "$PRE_PUSH_BACKUP" "$PRE_PUSH_HOOK"
  fi
}

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  [[ -f "$STATE_FILE" ]] && { log_info "Resuming from existing state."; return; }
  log_info "Initializing task state..."
  python3 - <<PYEOF
import json
titles = [
    "Workspace move & legacy preservation",
    "Strictness baseline (TS base + extended oxlint + lefthook)",
    "Postgres migration (driver + schema + data + dev)",
    "apps/dashboard scaffold",
    "Dashboard data layer (Eden + Query + Zustand + router-context)",
    "Extract visx to packages/charts",
    "API: schema lib swap (TypeBox → Zod) + OpenAPI plugin",
    "API: pagination convention swap",
    "API: summary endpoints (server-computed aggregates)",
    "OTel + HyperDX observability (backend + frontend)",
    "Garmin Health page",
    "Strength Tracker + Body Weight",
    "Tests + React Compiler + rules + CLAUDE.md + CI workflow",
    "Cutover + cleanup (frontend deploy + data migration + prune)",
    "Documentation polish (descriptive-voice final pass)",
]
groups = [{"id": i + 1, "title": t, "status": "pending", "attempts": 0,
           "started_at": None, "completed_at": None}
          for i, t in enumerate(titles)]
state = {"groups": groups, "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
with open("$STATE_FILE", "w") as f:
    json.dump(state, f, indent=2)
print("State initialized.")
PYEOF
}

get_field() {
  GROUP_ID="$1" FIELD="$2" python3 -c "
import json, os
gid = int(os.environ['GROUP_ID']); fld = os.environ['FIELD']
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == gid:
        v = g.get(fld, '')
        print('' if v is None else v)
        break
"
}

set_field() {
  GROUP_ID="$1" FIELD="$2" VAL="$3" python3 - <<'PYEOF'
import json, os
gid = int(os.environ['GROUP_ID']); fld = os.environ['FIELD']; raw = os.environ['VAL']
val = raw
if raw in ('True', 'False', 'None'):
    val = {'True': True, 'False': False, 'None': None}[raw]
with open(os.environ['STATE_FILE_PATH']) as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == gid:
        g[fld] = val
        break
with open(os.environ['STATE_FILE_PATH'], 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

# wrapper so set_field has access to STATE_FILE via env
_set_field() { STATE_FILE_PATH="$STATE_FILE" set_field "$@"; }

inc_attempts() {
  GROUP_ID="$1" STATE_FILE_PATH="$STATE_FILE" python3 - <<'PYEOF'
import json, os
gid = int(os.environ['GROUP_ID'])
with open(os.environ['STATE_FILE_PATH']) as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == gid:
        g['attempts'] = g.get('attempts', 0) + 1
        break
with open(os.environ['STATE_FILE_PATH'], 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

print_status() {
  STATE_FILE_PATH="$STATE_FILE" python3 - <<'PYEOF'
import json, os
with open(os.environ['STATE_FILE_PATH']) as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
print(f"  {total} groups | {done} complete | {pending} pending | {blocked} blocked")
print()
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f"  (attempt {g['attempts']})" if g['attempts'] > 0 else ""
    print(f"  {icon}  Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────
#
# The repo shape changes across the migration:
#   - Group 1 moves packages/api → apps/api.
#   - Group 3 adds apps/dashboard.
#   - Group 5 adds packages/charts.
#   - Group 10 adds bun test in apps/api.
#   - Group 11 prunes packages/dashboard.
# Validation is tolerant of missing workspaces — each check is guarded by [ -d … ].

validate() {
  local label=${1:-""}
  log_info "Validation${label:+ ($label)}..."
  cd "$REPO_ROOT"

  bun install --silent 2>&1 || { log_error "bun install failed"; return 1; }
  bun run lint 2>&1 || { log_error "lint failed"; return 1; }
  bun run format:check 2>&1 || { log_error "format:check failed"; return 1; }

  if [[ -d apps/api ]]; then
    bun --cwd apps/api typecheck 2>&1 || { log_error "apps/api typecheck failed"; return 1; }
  elif [[ -d packages/api ]]; then
    bun --cwd packages/api typecheck 2>&1 || { log_error "packages/api typecheck failed"; return 1; }
  fi

  if [[ -d apps/dashboard ]]; then
    bun --cwd apps/dashboard typecheck 2>&1 || { log_error "apps/dashboard typecheck failed"; return 1; }
  fi

  if [[ -d packages/charts ]]; then
    bun --cwd packages/charts typecheck 2>&1 || { log_error "packages/charts typecheck failed"; return 1; }
  fi

  if [[ -d packages/dashboard ]]; then
    bun --cwd packages/dashboard build 2>&1 || { log_warn "legacy packages/dashboard build failed (acceptable post-Group-6)"; }
  fi

  # bun test only exists after Group 10; tolerate absence by checking for the script
  if [[ -d apps/api ]] && grep -q '"test"' apps/api/package.json 2>/dev/null; then
    # Skip live tests in validation gate — CI runs them with a Postgres service.
    # Local validation just confirms the script exists.
    :
  fi

  log_success "Validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id="$1"
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$DOCS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"

  mkdir -p "$LOGS_DIR"

  if [[ ! -f "$prompt_file" ]]; then
    log_error "Prompt not found: $prompt_file"
    return 1
  fi

  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Claude running (timeout: ${CLAUDE_TIMEOUT}s) → log: .ralph-logs/group-$group_id.log"
  log_info "Watch live: tail -f .ralph-logs/group-$group_id.log"
  echo ""

  local exit_code=0
  if CLAUDE_CODE_ENABLE_TASKS=true CLAUDECODE="" gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" \
    --model sonnet \
    --effort high \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    < /dev/null > "$log_file" 2>&1; then
    exit_code=0
  else
    exit_code=$?
  fi

  # Check completion signal BEFORE the timeout guard — Claude may have finished its
  # work and emitted the signal, but post-signal cleanup pushed the process past
  # the timeout. In that case the group is done; don't treat it as failed.
  grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file" && return 0
  grep -q "RALPH_TASK_BLOCKED: Group $group_id"  "$log_file" && return 2

  [[ $exit_code -eq 124 ]] && { log_error "Timed out after ${CLAUDE_TIMEOUT}s"; return 1; }

  log_warn "Claude finished but no completion signal in log."
  return 1
}

# ── Report ────────────────────────────────────────────────────────────────────

generate_report() {
  STATE_FILE_PATH="$STATE_FILE" REPORT_FILE_PATH="$REPORT_FILE" GEN_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" python3 - <<'PYEOF'
import json, os
with open(os.environ['STATE_FILE_PATH']) as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
lines = [
    "# RALPH Report",
    "",
    f"Generated: {os.environ['GEN_TS']}",
    f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked",
    "",
    "## Status",
    "",
]
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")
lines += ["", "## Next Steps", ""]
if done == total:
    lines += [
        "All groups complete.",
        "",
        "1. Review: `git log --oneline -30`",
        "2. Run full smoke (api up, dashboard up, browser walkthrough)",
        "3. Confirm production stable; create a release tag if desired",
    ]
elif pending > 0:
    lines.append("Run `./scripts/ralph.sh` to continue, or `./scripts/ralph.sh N` for a specific group.")
elif blocked > 0:
    lines.append("Blocked groups need manual intervention. After fixing, reset with `./scripts/ralph.sh --reset N`.")
with open(os.environ['REPORT_FILE_PATH'], 'w') as f:
    f.write('\n'.join(lines) + '\n')
print(f"Report: {os.environ['REPORT_FILE_PATH']}")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group=""
  local do_reset=false
  local status_only=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status) status_only=true; shift ;;
      --reset) do_reset=true; target_group="${2:?'--reset requires a group number'}"; shift 2 ;;
      [0-9]*) target_group="$1"; shift ;;
      *) echo "Unknown: $1"; echo "Usage: ralph.sh [group] [--reset group] [--status]"; exit 1 ;;
    esac
  done

  echo ""
  echo -e "${BOLD}  Argo — RALPH Loop${NC}"
  echo ""

  require_commands
  cd "$REPO_ROOT"

  if ! $status_only; then
    refuse_default_branch
    require_op_session
    prefetch_secrets
    disable_commit_signing
    install_push_guard
  fi

  init_state

  if $status_only; then print_status; exit 0; fi

  if $do_reset; then
    log_info "Resetting Group $target_group to pending..."
    _set_field "$target_group" "status" "pending"
    GROUP_ID="$target_group" STATE_FILE_PATH="$STATE_FILE" python3 - <<'PYEOF'
import json, os
gid = int(os.environ['GROUP_ID'])
with open(os.environ['STATE_FILE_PATH']) as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == gid:
        g['attempts'] = 0
        g['started_at'] = None
        g['completed_at'] = None
        break
with open(os.environ['STATE_FILE_PATH'], 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
  fi

  print_status; echo ""

  local groups_to_run=()
  if [[ -n "$target_group" ]]; then
    groups_to_run=("$target_group")
  else
    for i in $(seq 1 $TOTAL_GROUPS); do groups_to_run+=("$i"); done
  fi

  for group_id in "${groups_to_run[@]}"; do
    local status
    status=$(get_field "$group_id" "status")

    if [[ "$status" == "complete" ]]; then
      echo -e "  ✅  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (complete)"
      continue
    fi
    if [[ "$status" == "blocked" ]]; then
      echo -e "  🚫  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (blocked)"
      continue
    fi

    local attempts
    attempts=$(get_field "$group_id" "attempts")

    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then
      log_warn "Group $group_id reached max retries. Marking blocked."
      _set_field "$group_id" "status" "blocked"
      continue
    fi

    echo ""
    echo "  ────────────────────────────────────────────"
    echo -e "  ${BOLD}Group $group_id: ${GROUP_TITLES[$group_id]}${NC}"
    echo "  Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "  ────────────────────────────────────────────"
    echo ""

    # Pre-group validation (skip group 1 — nothing to validate yet)
    if [[ "$group_id" -gt 1 ]]; then
      if ! validate "pre-group $group_id"; then
        log_error "Pre-group validation failed. Fix before continuing."
        exit 1
      fi
      echo ""
    fi

    _set_field "$group_id" "status" "in_progress"
    _set_field "$group_id" "started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    inc_attempts "$group_id"

    run_result=0
    run_group "$group_id" || run_result=$?
    echo ""

    if [[ $run_result -eq 0 ]]; then
      log_success "Group $group_id complete."
      _set_field "$group_id" "status" "complete"
      _set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo ""
      if validate "post-group $group_id"; then
        log_success "Post-group validation passed ✓"
      else
        log_warn "Post-group validation FAILED. Review log and fix."
        log_warn "Retry: ./scripts/ralph.sh --reset $group_id"
      fi
    elif [[ $run_result -eq 2 ]]; then
      log_warn "Group $group_id blocked. See: .ralph-logs/group-$group_id.log"
      _set_field "$group_id" "status" "blocked"
    else
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"
      _set_field "$group_id" "status" "pending"
      log_info "Log: .ralph-logs/group-$group_id.log"
      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then
        _set_field "$group_id" "status" "blocked"
      elif [[ -z "$target_group" ]]; then
        log_warn "Stopping. Fix Group $group_id before proceeding."
        break
      fi
    fi

    echo ""
  done

  echo ""
  generate_report
  echo ""
  echo -e "${BOLD}  RALPH loop done.${NC}"
  echo ""
  print_status
  echo ""
}

main "$@"

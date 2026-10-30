#!/bin/zsh
# Argo deploy (`make deploy`) and rollback (`make rollback`): releases, not an in-place clone. Same model as
# agent-workflows on this Mac mini.
#
#   ~/.argo/repo               the clone; fetch only, nothing runs from it
#   ~/.argo/releases/<sha>     one immutable export of a commit with its own node_modules and built dashboard
#   ~/.argo/current            symlink to the live release
#   ~/.argo/data/              deployed-sha, previous-sha, deploy.lock (written only after a release is healthy)
#   ~/.argo/state/             the app's DATA_DIR (OAuth token files ...): never inside a release, survives deploys
#
# The live release is never written to: a new release is exported, installed and built beside it, the LaunchAgent is
# switched to it, and /api/health must report its sha. If it never does, the previous release is booted again (rollback)
# and the deploy exits 1. The plist points at the release path, not at `current`: the plist is then the single
# statement of what runs, and a swap of the symlink can never change a running process's code underneath it.
#
#   deploy.sh             deploy origin/master
#   deploy.sh rollback    put previous-sha live again (same stop / render / bootstrap / wait machinery); the markers
#                         are swapped on success, so a second rollback goes forward again
#
# DRY_RUN=1 prints the plan and the rendered plist and touches nothing (no fetch, no build, no launchd, no ~/.argo).
# ARGO_ROOT relocates ~/.argo (tests).
#
# Everything lives inside functions and `main` is called on the last line: this file is tracked in the repo the deploy
# exports, and zsh parses a function body as one unit at definition time. After the release is built `main` re-executes
# that release's copy once (pinned to the same sha), so the orchestration that runs matches the code being deployed.
# ARGO_DEPLOY_SOURCE_ONLY=1 sources the functions without running `main` (scripts/test/deploy-logic.sh).

set -u

LABEL="com.jkrumm.argo"
PORT=7737
ROOT="${ARGO_ROOT:-$HOME/.argo}"
REPO_DIR="$ROOT/repo"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
DATA_DIR="$ROOT/data"
STATE_DIR="$ROOT/state"
SHA_FILE="$DATA_DIR/deployed-sha"
PREV_FILE="$DATA_DIR/previous-sha"
ERR_OFFSET_FILE="$DATA_DIR/err-log-offset"
ERR_LOG="$HOME/Library/Logs/argo.err.log"
OUT_LOG="$HOME/Library/Logs/argo.out.log"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HYPERDX_KEY_REF="op://vps/argo/HYPERDX_API_KEY_PROD"
KEEP_RELEASES=3
# A cold start applies pending migrations on the shared database before it listens: 120 s is generous.
HEALTH_WAIT_SECS="${HEALTH_WAIT_SECS:-120}"
SELF="${0:A}"
SELF_DIR="${SELF:h}"
LOCK="$DATA_DIR/deploy.lock"
DRY_RUN="${DRY_RUN:-}"
# The sha the plist on disk was last rendered for by this run: a rollback removes only what this run wrote.
RENDERED_SHA=""

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

log() { print "[deploy] $*"; }
die() { print -u2 "[deploy] ERROR: $*"; exit 1; }

# Print an action in a dry run, run it otherwise.
act() {
  if [[ -n "$DRY_RUN" ]]; then print "[dry-run] would run: $*"; return 0; fi
  "$@"
}

read_sha() { [[ -f "$1" ]] && tr -d '[:space:]' < "$1"; }

# Atomic: a reader must never see a partial file.
write_atomic() {  # $1 path, $2 content
  local tmp="$1.tmp.$$"
  print -r -- "$2" > "$tmp" && mv -f "$tmp" "$1"
}

# The dotfiles heartbeat pages on every restart of a KeepAlive job; one epoch line marks this one deliberate.
# Best-effort: a failed write costs a false page, never a deploy.
mark_deliberate_restart() {
  local dir="$HOME/.local/state/devhost/deliberate-restart"
  mkdir -p "$dir" 2>/dev/null && date +%s >> "$dir/$LABEL" 2>/dev/null || true
}

render_plist() {  # $1 template, $2 release dir, $3 sha -> stdout
  /usr/bin/sed -e "s|__HOME__|$HOME|g" -e "s|__RELEASE_DIR__|$2|g" -e "s|__SHA__|$3|g" -e "s|__ROOT__|$ROOT|g" "$1"
}

template_of() { print "$1/deploy/$LABEL.plist.template"; }  # $1 release dir
health_url() { print "http://127.0.0.1:$PORT/api/health"; }

tail_logs() {
  local f
  for f in "$ERR_LOG" "$OUT_LOG"; do
    [[ -f "$f" ]] && { print -u2 "--- tail -n 40 $f"; tail -n 40 "$f" >&2; }
  done
}

loaded() { launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; }

# SIGTERM shutdown may take up to the plist's ExitTimeOut before launchd kills the process: wait that long and a bit.
unload_wait_secs() {  # $1 plist or template
  local t
  t=$(plutil -extract ExitTimeOut raw -o - "$1" 2>/dev/null)
  print $(( ${t:-30} + 10 ))
}

stop_process() {  # $1 max seconds to wait for the unload
  loaded || return 0
  mark_deliberate_restart
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  local i=0
  while (( i < $1 )) && loaded; do sleep 1; i=$((i + 1)); done
  ! loaded
}

# Renders the plist for a release, installs it and bootstraps it. The size of the stderr log is recorded first, so
# `make verify` scans only what this process wrote.
start_process() {  # $1 release dir, $2 sha
  local tmp="$PLIST.tmp.$$"
  if ! { render_plist "$(template_of "$1")" "$1" "$2" > "$tmp" && plutil -lint "$tmp" >/dev/null; }; then
    print -u2 "[deploy] ERROR: rendering the plist failed ($tmp)"
    rm -f "$tmp"
    return 1
  fi
  mv -f "$tmp" "$PLIST" || return 1
  RENDERED_SHA="$2"
  write_atomic "$ERR_OFFSET_FILE" "$(/usr/bin/stat -f %z "$ERR_LOG" 2>/dev/null || print 0)"
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
}

# One probe: the process answers /api/health ok (in dashboard mode only /api/* reaches the API) at the sha.
is_healthy() {  # $1 sha
  local body
  body=$(curl -fsS --max-time 2 "$(health_url)" 2>/dev/null) \
    && [[ "$(print -r -- "$body" | jq -r '.status + " " + .commit' 2>/dev/null)" == "ok $1" ]]
}

wait_healthy() {  # $1 sha
  local i=0
  while (( i < HEALTH_WAIT_SECS )); do
    is_healthy "$1" && return 0
    sleep 1; i=$((i + 1))
  done
  print -u2 "[deploy] not healthy at ${1[1,12]}"
  return 1
}

# A process left booted out must not come back at the next login (RunAtLoad) on a release that failed: the plist goes,
# but only one this run rendered for that failed sha. Any other plist on disk is not this run's to remove.
remove_failed_plist() {  # $1 failed sha
  [[ "$RENDERED_SHA" == "$1" ]] || return 0
  rm -f "$PLIST" && print -u2 "[deploy] removed $PLIST ($LABEL stays down)"
}

is_sha() { [[ "$1" =~ '^[0-9a-f]{40}$' ]]; }

# The only place a release is deleted: the name must be a full sha, and both path parts are guarded against empty.
remove_release() {  # $1 sha
  is_sha "$1" || die "refusing to remove '$1': not a 40-hex sha"
  rm -rf "${RELEASES:?}/${1:?}"
}

# The dashboard bundle: same-origin API (VITE_API_URL empty -> `${origin}/api`, see apps/dashboard/src/lib/api-base.ts)
# and same-origin browser telemetry (VITE_HYPERDX_ENDPOINT empty -> window.location.origin, posting /v1/traces and
# /v1/logs). The HyperDX key is public by design (Sentry-DSN equivalent, baked into the static bundle), read through
# secrets-run and never printed. Set explicitly so nothing inherited from the calling shell leaks into the bundle.
build_dashboard() {  # $1 release dir
  local key
  key=$(secrets-run read "$HYPERDX_KEY_REF" 2>/dev/null)
  [[ -n "$key" ]] || { print -u2 "[deploy] cannot read $HYPERDX_KEY_REF through secrets-run"; return 1; }
  (
    cd "$1" || exit 1
    env VITE_API_URL= VITE_HYPERDX_ENDPOINT= VITE_HYPERDX_SERVICE_NAME=argo-dashboard VITE_HYPERDX_API_KEY="$key" \
      bun run --cwd apps/dashboard build
  ) || return 1
  [[ -f "$1/apps/dashboard/dist/index.html" ]] || { print -u2 "[deploy] dashboard build left no dist/index.html"; return 1; }
}

# Exports a commit, installs its dependencies and builds the dashboard beside the live release. A release with a
# `.complete` marker is reused untouched (a redeploy, a rollback target); anything else is a leftover of a failed build
# and is exported again from nothing. The marker is written last, so a half-built release can never be started; a
# failed build removes itself.
build_release() {  # $1 sha
  is_sha "$1" || die "'$1' is not a 40-hex sha"
  local dir="$RELEASES/$1"
  if [[ -f "$dir/.complete" ]]; then touch "$dir"; return 0; fi
  [[ -e "$dir" ]] && remove_release "$1"
  mkdir -p "$dir"
  git -C "$REPO_DIR" archive --format=tar "$1" | tar -x -C "$dir" || { remove_release "$1"; die "exporting $1 failed"; }
  (cd "$dir" && bun install --frozen-lockfile) || { remove_release "$1"; die "bun install failed; the live release is untouched"; }
  build_dashboard "$dir" || { remove_release "$1"; die "the dashboard build failed; the live release is untouched"; }
  chmod +x "$dir/scripts/"*.sh 2>/dev/null
  touch "$dir/.complete"
}

# Keeps the newest $KEEP_RELEASES releases plus the live and the previous one; removes older ones. Only entries named
# like a sha are considered (anything else in releases/ is left alone), and only completed releases.
prune_releases() {  # $@ shas never to remove
  local -a all; local n=0 d
  all=( ${(f)"$(ls -1t "$RELEASES" 2>/dev/null)"} )
  for d in $all; do
    is_sha "$d" || continue
    [[ -f "$RELEASES/$d/.complete" ]] || continue
    n=$((n + 1))
    (( n <= KEEP_RELEASES )) && continue
    (( ${@[(Ie)$d]} )) && continue
    log "pruning release ${d[1,12]}"
    remove_release "$d"
  done
}

# The new build never became healthy: say so with the log tails, then put the previous release back.
roll_back() {  # $1 failed sha, $2 previous sha ("" = none), $3 unload wait, $4 live sha ("" = none)
  print -u2 "[deploy] ERROR: ${1[1,12]} did not become healthy within ${HEALTH_WAIT_SECS}s"
  tail_logs
  if [[ -z "$2" ]]; then
    stop_process "$3" || print -u2 "[deploy] WARNING: could not unload $LABEL"
    if [[ -n "$4" && "$4" == "$1" ]]; then
      # A redeploy of the live sha (a transient health failure): same sha, same release, so its plist is the live
      # one. It is kept and bootstrapped once more; the deploy still exits 1, naming what is up.
      print -u2 "[deploy] redeploy of the live sha ${1[1,12]}: starting it again from its plist"
      [[ -f "$PLIST" ]] && launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null
      if wait_healthy "$1" >/dev/null 2>&1; then
        print -u2 "[deploy] redeploy of the live sha ${1[1,12]} failed; up again. Plist kept, deployed-sha unchanged."
      else
        print -u2 "[deploy] redeploy of the live sha ${1[1,12]} failed; still down. Plist kept, deployed-sha unchanged."
      fi
      return 0
    fi
    loaded || remove_failed_plist "$1"
    print -u2 "[deploy] no previous release (first deploy): left booted out so KeepAlive does not loop a failing launch. deployed-sha unchanged."
    return 0
  fi
  print -u2 "[deploy] rolling back to ${2[1,12]}"
  if ! stop_process "$3"; then
    print -u2 "[deploy] ROLLBACK FAILED: $LABEL did not unload within ${3}s"
    return 0
  fi
  if start_process "$RELEASES/$2" "$2" && wait_healthy "$2"; then
    print -u2 "[deploy] rollback OK: ${2[1,12]} is healthy again. deployed-sha unchanged."
  else
    stop_process "$3"
    remove_failed_plist "$2"
    print -u2 "[deploy] ROLLBACK FAILED: ${2[1,12]} did not become healthy either; left booted out."
  fi
}

preflight_tools() {
  local tool
  [[ -x "$HOME/.local/bin/secrets-run" ]] || die "$HOME/.local/bin/secrets-run not found: deploys run on the dev host (the Mac mini) only"
  command -v launchctl >/dev/null 2>&1 || die "launchctl not found: deploys run on the dev host (macOS) only"
  for tool in git bun curl jq plutil tar; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool not found on PATH"
  done
  if [[ -e "$CURRENT" && ! -L "$CURRENT" ]]; then
    die "$CURRENT exists and is not a symlink; remove it, then run again"
  fi
}

# The lock is a symlink whose target is the holder's pid: `ln -s` creates it atomically and fails when it exists, so a
# lock is never visible without its pid (a mkdir-then-write-pid lock has a window where a second deploy reads an empty
# pid and takes over). Removed as a file, never recursively, and only by its holder.
release_lock() {
  [[ "$(readlink "${LOCK:?}" 2>/dev/null)" == "$$" ]] && rm -f -- "${LOCK:?}"
  return 0
}

# One deploy at a time. The caller sets `trap release_lock EXIT` right after: zsh runs an EXIT trap set inside a
# function when that function returns, which would drop the lock at once. A lock whose holder is dead is taken over by
# an atomic rename of a fresh symlink over it, then confirmed by reading it back. Anything at $LOCK that is not a
# symlink (a directory from elsewhere) is never taken over.
take_lock() {
  mkdir -p "$DATA_DIR" "$RELEASES" "$STATE_DIR" "${PLIST:h}" "${ERR_LOG:h}"
  local holder tmp="$LOCK.$$"
  [[ -e "$LOCK" && ! -L "$LOCK" ]] && die "$LOCK exists and is not a lock symlink; remove it, then run again"
  if ! ln -s "$$" "$LOCK" 2>/dev/null; then
    holder=$(readlink "$LOCK" 2>/dev/null)
    if [[ "$holder" == <-> ]] && kill -0 "$holder" 2>/dev/null; then die "another deploy is running (pid $holder)"; fi
    ln -s "$$" "$tmp" 2>/dev/null && mv -f "$tmp" "$LOCK" || { rm -f -- "$tmp"; die "cannot take $LOCK"; }
    [[ "$(readlink "$LOCK" 2>/dev/null)" == "$$" ]] || die "another deploy took $LOCK first"
  fi
}

# An INT/TERM/HUP during the switch leaves the live process unverified: say so and stop. No automatic rollback from a
# signal handler; the EXIT trap releases the lock.
SWITCH_SHA=""
interrupted() {
  print -u2 "[deploy] interrupted at ${SWITCH_SHA[1,12]}; live is unverified, run make verify or make rollback"
  exit 130
}
begin_switch() { SWITCH_SHA="$1"; trap interrupted INT TERM HUP; }
end_switch() { trap - INT TERM HUP; SWITCH_SHA=""; }

main() {
  local repo_url sha old prev="" release unload_secs

  preflight_tools
  repo_url="${ARGO_REPO_URL:-$(git -C "$SELF_DIR" remote get-url origin 2>/dev/null)}"

  if [[ -n "$DRY_RUN" ]]; then
    local repo_root="${SELF_DIR:h}"
    sha=$(git -C "$repo_root" rev-parse origin/master 2>/dev/null || print "<origin/master sha>")
    old=$(read_sha "$SHA_FILE")
    [[ -n "$old" && "$old" != "$sha" && -f "$RELEASES/$old/.complete" ]] && prev="$old"
    release="$RELEASES/$sha"
    log "DRY RUN: nothing is changed. Release ${sha[1,12]}, live ${old:-none}, root $ROOT"
    log "preflight: would read $HYPERDX_KEY_REF through secrets-run for the dashboard build (value never printed)"
    [[ -d "$REPO_DIR/.git" ]] || act git clone "${repo_url:-<origin url>}" "$REPO_DIR"
    act git -C "$REPO_DIR" fetch --prune origin master
    act "git -C $REPO_DIR archive $sha | tar -x -C $release   (the live release is never written to)"
    act bun install --frozen-lockfile "(in $release)"
    act "env VITE_API_URL= VITE_HYPERDX_ENDPOINT= VITE_HYPERDX_SERVICE_NAME=argo-dashboard VITE_HYPERDX_API_KEY=<redacted> bun run --cwd apps/dashboard build (in $release)"
    act "touch $release/.complete (written last; a failed build removes the release)"
    act "re-exec $release/scripts/deploy.sh once, pinned to $sha"
    act "$release/scripts/launch.sh --check   (every .env.tpl ref resolves to a non-empty value; refuses before anything is stopped)"
    log "rendered $PLIST (points at the release, not at current):"
    render_plist "$(template_of "$repo_root")" "$release" "$sha"
    act "launchctl bootout $LABEL, waiting up to $(unload_wait_secs "$(template_of "$repo_root")")s for the unload (ExitTimeOut + 10)"
    act launchctl bootstrap "gui/$(id -u)" "$PLIST"
    act "wait up to ${HEALTH_WAIT_SECS}s for $(health_url) = ok, commit $sha"
    if [[ -n "$prev" ]]; then
      act "on failure: print the log tails, bootout, re-render ${prev[1,12]}, bootstrap, wait for its commit; exit 1"
    elif [[ -n "$old" && "$old" == "$sha" ]]; then
      act "on failure: print the log tails, bootout, bootstrap again from the kept plist (a redeploy of the live sha: same release), wait once more, exit 1"
    else
      act "on failure: print the log tails, bootout and remove the plist this deploy rendered (no previous release: left down, not crash-looping, not back at login), exit 1"
    fi
    act "write $SHA_FILE ($sha)"
    [[ -n "$old" && "$old" != "$sha" ]] && act "write $PREV_FILE ($old)"
    act ln -sfn "$release" "$CURRENT"
    act "prune releases beyond the newest $KEEP_RELEASES (never ${sha[1,12]} or ${old:+${old[1,12]}})"
    return 0
  fi

  take_lock
  trap release_lock EXIT

  # --- the release: exported, installed and built beside the live one
  if [[ -z "${ARGO_DEPLOY_SHA:-}" ]]; then
    if [[ ! -d "$REPO_DIR/.git" ]]; then
      [[ -n "$repo_url" ]] || die "no origin url (set ARGO_REPO_URL)"
      log "cloning $repo_url -> $REPO_DIR"
      git clone --quiet "$repo_url" "$REPO_DIR" || die "git clone failed"
    fi
    git -C "$REPO_DIR" fetch --quiet --prune origin master || die "git fetch origin master failed (network or credential helper)"
    sha=$(git -C "$REPO_DIR" rev-parse origin/master)
  else
    sha="$ARGO_DEPLOY_SHA"
  fi
  release="$RELEASES/$sha"
  log "building release ${sha[1,12]}"
  build_release "$sha"

  [[ -f "$release/scripts/deploy.sh" && -f "$release/scripts/launch.sh" && -f "$(template_of "$release")" && -f "$release/.env.tpl" ]] \
    || die "release ${sha[1,12]} lacks the native deploy files (scripts/deploy.sh, scripts/launch.sh, deploy/$LABEL.plist.template, .env.tpl): commit and push them to origin/master first"

  # Continue with the release's own copy of this script, once.
  if [[ -z "${ARGO_DEPLOY_REEXEC:-}" && "$SELF" != "${release:A}/scripts/deploy.sh" ]]; then
    trap - EXIT; release_lock
    ARGO_DEPLOY_REEXEC=1 ARGO_DEPLOY_SHA="$sha" exec /bin/zsh "$release/scripts/deploy.sh"
  fi

  unload_secs=$(unload_wait_secs "$(template_of "$release")")

  # Every ref must resolve before anything is stopped: a failing launch is a refusal here, not a rollback.
  /bin/zsh "$release/scripts/launch.sh" --check || die "the secrets for ${sha[1,12]} do not resolve (see above); nothing was stopped"

  # The release that is live now is the rollback target, unless it is the one being deployed again.
  old=$(read_sha "$SHA_FILE")
  [[ -n "$old" && "$old" != "$sha" && -f "$RELEASES/$old/.complete" ]] && prev="$old"

  # --- switch
  log "deploying ${sha[1,12]} (live: ${old:-none})"
  begin_switch "$sha"
  stop_process "$unload_secs" || die "$LABEL is still loaded ${unload_secs}s after bootout (ExitTimeOut + 10); not bootstrapping over it. It may still be shutting down: retry the deploy."
  if ! start_process "$release" "$sha"; then
    print -u2 "[deploy] ERROR: launchctl bootstrap failed at ${sha[1,12]}"
    roll_back "$sha" "$prev" "$unload_secs" "$old"
    end_switch
    return 1
  fi
  log "waiting up to ${HEALTH_WAIT_SECS}s for $(health_url) (commit ${sha[1,12]})"
  if ! wait_healthy "$sha"; then
    roll_back "$sha" "$prev" "$unload_secs" "$old"
    end_switch
    return 1
  fi

  # --- healthy: deployed-sha (the source of truth) first, then previous-sha, then current: a death in between leaves
  # markers that name the live sha
  write_atomic "$SHA_FILE" "$sha" || die "writing $SHA_FILE failed"
  [[ -n "$old" && "$old" != "$sha" ]] && write_atomic "$PREV_FILE" "$old"
  ln -sfn "$release" "$CURRENT" || die "updating $CURRENT failed"
  end_switch
  prune_releases "$sha" "$(read_sha "$PREV_FILE")"
  log "deploy OK: ${sha[1,12]} healthy at $(health_url)"
}

# `make rollback`: previous-sha goes live. The release is already built (releases are kept for exactly this), so
# nothing is fetched or built. On success current and the markers are swapped (deployed <-> previous), so a second
# rollback goes forward again. On failure the release that was live is booted again, and the exit is non-zero.
# `make verify` fails after a rollback until the next deploy: the live sha is, by intent, not origin/master.
rollback_main() {
  local live prev unload_secs

  preflight_tools
  # The lock first, then the markers: a deploy that finishes while this waits must be seen, not rolled over.
  if [[ -z "$DRY_RUN" ]]; then take_lock; trap release_lock EXIT; fi
  live=$(read_sha "$SHA_FILE")
  prev=$(read_sha "$PREV_FILE")
  [[ -n "$prev" ]] || die "no $PREV_FILE: there is no previous release to roll back to"
  is_sha "$prev" || die "$PREV_FILE does not hold a 40-hex sha"
  [[ -f "$RELEASES/$prev/.complete" ]] || die "release ${prev[1,12]} is not in $RELEASES (pruned or incomplete)"
  [[ -f "$(template_of "$RELEASES/$prev")" ]] || die "release ${prev[1,12]} has no deploy/$LABEL.plist.template"
  [[ "$prev" != "$live" ]] || die "previous-sha equals deployed-sha (${prev[1,12]}): nothing to roll back to"
  unload_secs=$(unload_wait_secs "$(template_of "$RELEASES/$prev")")

  if [[ -n "$DRY_RUN" ]]; then
    log "DRY RUN: nothing is changed. Rolling back ${live:+${live[1,12]} }-> ${prev[1,12]}"
    log "rendered $PLIST:"
    render_plist "$(template_of "$RELEASES/$prev")" "$RELEASES/$prev" "$prev"
    act "launchctl bootout $LABEL, wait up to ${unload_secs}s; bootstrap the plist above; wait up to ${HEALTH_WAIT_SECS}s for commit $prev"
    act "write $SHA_FILE ($prev) and $PREV_FILE (${live:-none}): the markers swap"
    act ln -sfn "$RELEASES/$prev" "$CURRENT"
    return 0
  fi

  log "rolling back ${live:+${live[1,12]} }-> ${prev[1,12]}"
  begin_switch "$prev"
  stop_process "$unload_secs" || die "$LABEL is still loaded ${unload_secs}s after bootout; not bootstrapping over it"
  if start_process "$RELEASES/$prev" "$prev" && wait_healthy "$prev"; then
    write_atomic "$SHA_FILE" "$prev" || die "writing $SHA_FILE failed"
    [[ -n "$live" ]] && write_atomic "$PREV_FILE" "$live"
    ln -sfn "$RELEASES/$prev" "$CURRENT" || die "updating $CURRENT failed"
    end_switch
    log "rollback OK: ${prev[1,12]} is live (previous is now ${live:+${live[1,12]}}); 'make verify' fails until the next deploy"
    return 0
  fi

  print -u2 "[deploy] ERROR: ${prev[1,12]} did not become healthy"
  tail_logs
  stop_process "$unload_secs" || print -u2 "[deploy] WARNING: could not unload $LABEL"
  if [[ -n "$live" && -f "$RELEASES/$live/.complete" ]] && start_process "$RELEASES/$live" "$live" && wait_healthy "$live"; then
    end_switch
    print -u2 "[deploy] ROLLBACK FAILED; ${live[1,12]} is live again. Markers unchanged."
    return 1
  fi
  stop_process "$unload_secs"
  remove_failed_plist "$RENDERED_SHA"
  end_switch
  print -u2 "[deploy] ROLLBACK FAILED and ${live:+${live[1,12]} }did not come back either; $LABEL left booted out."
  return 1
}

[[ -n "${ARGO_DEPLOY_SOURCE_ONLY:-}" ]] && return 0

case "${1:-deploy}" in
  deploy) main ;;
  rollback) rollback_main ;;
  *) die "unknown command '$1' (deploy or rollback)" ;;
esac

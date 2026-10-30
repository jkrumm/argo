#!/bin/zsh
# Logic test for scripts/deploy.sh without launchd: the deploy file is sourced (ARGO_DEPLOY_SOURCE_ONLY) and the
# launchd-touching functions are replaced by a fake "what is running" world. Covers the rollback branches, the
# `make rollback` marker swap and release pruning. Not part of `make check`: `zsh scripts/test/deploy-logic.sh`.

set -u
TMP=$(mktemp -d) || exit 1
# The one recursive delete in this test: the scratch dir itself, only when it is a temp path.
cleanup() {
  test -d "$TMP" || return 0
  case "$TMP" in
    /var/folders/*|/tmp/*|/private/tmp/*|/private/var/folders/*) rm -rf -- "$TMP" ;;
    *) print -u2 "refusing to remove $TMP" ;;
  esac
}
trap cleanup EXIT
SCRIPT_DIR="${0:A:h:h}"
export HOME="$TMP/home" ARGO_DEPLOY_SOURCE_ONLY=1 HEALTH_WAIT_SECS=2
mkdir -p "$HOME"

A=$(printf 'a%.0s' {1..40}); B=$(printf 'b%.0s' {1..40}); C=$(printf 'c%.0s' {1..40})
UPF="$TMP/up"   # the sha the fake launchd job runs ("" = booted out); a file, so subshell runs are visible
up() { cat "$UPF" 2>/dev/null; }
set_up() { print -rn -- "$1" > "$UPF"; }
set_up ""
BAD=()       # shas that start but never become healthy

# A new world per case: a fresh ARGO_ROOT and the deploy file sourced again (no path is ever deleted), then the stubs.
world=0
load_world() {
  world=$((world + 1)); export ARGO_ROOT="$TMP/argo$world"
  source "$SCRIPT_DIR/deploy.sh"
  install_stubs
}
install_stubs() {
preflight_tools() { :; }
tail_logs() { :; }
sleep() { :; }
loaded() { [[ -n "$(up)" ]]; }
stop_process() { set_up ""; }
start_process() { RENDERED_SHA="$2"; print x > "$PLIST"; set_up "$2"; }
launchctl() { [[ "$1" == bootstrap ]] && set_up "$LIVE"; return 0; }
is_healthy() { [[ "$(up)" == "$1" && ${BAD[(Ie)$1]} -eq 0 ]]; }
}

fails=0
check() {  # $1 name, $2... condition
  local name=$1; shift
  if "$@"; then print "ok   $name"; else print "FAIL $name"; fails=$((fails + 1)); fi
}
fresh() {  # a world with releases A (previous) and B (live)
  load_world; mkdir -p "$DATA_DIR" "$RELEASES" "${PLIST:h}"
  local s; for s in $A $B; do mkdir -p "$RELEASES/$s/deploy"; touch "$RELEASES/$s/.complete" "$(template_of "$RELEASES/$s")"; done
  print $B > "$SHA_FILE"; print $A > "$PREV_FILE"; set_up $B; BAD=(); LIVE=$B; RENDERED_SHA=""
}

fresh; (rollback_main) >/dev/null 2>&1
check "rollback: previous goes live"      test "$(up)" = "$A"
check "rollback: markers swap"            test "$(read_sha "$SHA_FILE")/$(read_sha "$PREV_FILE")" = "$A/$B"
check "rollback: current points at it"    test "$(readlink "$CURRENT")" = "$RELEASES/$A"
fresh; (rollback_main) >/dev/null 2>&1; (rollback_main) >/dev/null 2>&1
check "rollback twice goes forward"       test "$(read_sha "$SHA_FILE")/$(up)" = "$B/$B"

fresh; BAD=($A); (rollback_main) >/dev/null 2>&1; rc=$?
check "rollback to a bad release: exit 1" test $rc -eq 1
check "rollback to a bad release: live restored" test "$(up)" = "$B"
check "rollback to a bad release: markers kept" test "$(read_sha "$SHA_FILE")/$(read_sha "$PREV_FILE")" = "$B/$A"

fresh; rm "$PREV_FILE"; (rollback_main) >/dev/null 2>&1; rc=$?
check "rollback without previous-sha: exit 1" test $rc -eq 1

fresh; set_up $C; BAD=($C); roll_back $C $A 10 $B >/dev/null 2>&1
check "deploy failure: previous release booted again" test "$(up)" = "$A"
check "deploy failure: deployed-sha untouched" test "$(read_sha "$SHA_FILE")" = "$B"

fresh; set_up $C; BAD=($C); RENDERED_SHA=$C; print x > "$PLIST"; roll_back $C "" 10 "" >/dev/null 2>&1
check "first deploy failure: left booted out" test -z "$(up)"
check "first deploy failure: failed plist removed" test ! -e "$PLIST"

fresh; set_up $B; print x > "$PLIST"; RENDERED_SHA=$B; roll_back $B "" 10 $B >/dev/null 2>&1
check "redeploy of live sha: started again from the kept plist" test "$(up)" = "$B"
check "redeploy of live sha: plist kept" test -e "$PLIST"

# 1. the lock: a symlink to the holder's pid, so it never exists without one
fresh; command sleep 30 & holder=$!
ln -s "$holder" "$LOCK"; (take_lock) >/dev/null 2>&1; rc=$?
check "lock held by a live pid: not taken over" test $rc -eq 1 -a "$(readlink "$LOCK")" = "$holder"
kill $holder 2>/dev/null
fresh; mkdir "$LOCK"; (take_lock) >/dev/null 2>&1; rc=$?
check "pid-less lock (a directory): not taken over" test $rc -eq 1 -a -d "$LOCK" -a ! -L "$LOCK"
fresh; command true & dead=$!; wait $dead; ln -s "$dead" "$LOCK"
got=$( (take_lock; trap release_lock EXIT; readlink "$LOCK") 2>/dev/null )
check "lock held by a dead pid: taken over" test "$got" = "$$"
check "lock released at exit" test ! -e "$LOCK" -a ! -L "$LOCK"

# 2. rollback reads the markers only after it holds the lock (the lock stub plays a deploy finishing meanwhile)
fresh; take_lock() { print $C > "$SHA_FILE"; }; (rollback_main) >/dev/null 2>&1
check "rollback: markers read after the lock" test "$(read_sha "$SHA_FILE")/$(read_sha "$PREV_FILE")" = "$A/$C"

# 3. a rollback that cannot recover leaves no plist for the failed sha behind
fresh; set_up $C; BAD=($C $A); roll_back $C $A 10 $B >/dev/null 2>&1
check "deploy failure, rollback failed too: left booted out" test -z "$(up)"
check "deploy failure, rollback failed too: no plist" test ! -e "$PLIST"
fresh; BAD=($A $B); (rollback_main) >/dev/null 2>&1; rc=$?
check "make rollback failed everywhere: exit 1" test $rc -eq 1
check "make rollback failed everywhere: booted out, no plist" test -z "$(up)" -a ! -e "$PLIST"

# 5. a signal during the switch
out=$( (SWITCH_SHA=$A; interrupted) 2>&1 ); rc=$?
check "interrupted: names the sha, exits non-zero" test $rc -ne 0 -a "${out#*interrupted at ${A[1,12]}}" != "$out"

fresh
for i in 1 2 3 4 5; do
  s=$(printf "%d%.0s" $i {1..40}); mkdir -p "$RELEASES/$s"; touch "$RELEASES/$s/.complete"; touch -t 20260101000$i "$RELEASES/$s"
done
mkdir "$RELEASES/not-a-sha"; touch -t 200001010000 "$RELEASES/$A" "$RELEASES/$B"
(prune_releases $A $B) >/dev/null 2>&1
check "prune: live and previous kept"     test -d "$RELEASES/$A" -a -d "$RELEASES/$B"
check "prune: oldest of the rest removed" test ! -d "$RELEASES/$(printf '1%.0s' {1..40})"
check "prune: non-sha entry untouched"    test -d "$RELEASES/not-a-sha"

(( fails == 0 )) && print "PASS" || { print "$fails FAILED"; exit 1; }

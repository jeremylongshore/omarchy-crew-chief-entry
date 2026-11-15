#!/usr/bin/env bash
# Drive the shipped FocusChain.qml in a real Quickshell on the Omarchy rig.
#
# The row-click chain depends on how Quickshell's Process orders a run's end
# (stream end, exited, runningChanged) and on relaunching from `exited`. Node
# tests cannot load QML and the render never clicks, so this loads the exact
# FocusChain.qml and Model.js in Quickshell under headless sway, with a stand-in
# hyprctl on PATH that logs every call and answers by selector:
#
#   address 0x2, or project "good", in the Lua form -> "ok", exit 0
#   address 0x3 in the Lua form                      -> "ok" but exit 1 (a miss)
#   project "slow" in the Lua form                   -> hangs (the deadline must end it)
#   project "stubborn" in the Lua form               -> hangs and ignores SIGTERM
#   any other Lua form                       -> "warning: hl.focus: window not found"
#   any classic form                         -> a Lua syntax error, exit 1
#
# Fail-closed: each scenario carries the attempts and notice it must produce,
# every executed call must match a launch, and any mismatch, missing result or
# QML warning makes this script exit 1.
#
# A live Hyprland is not available on the rig: its headless backend needs a
# render node the container lacks. This proves the chain, not Hyprland itself.
#
# Usage: scripts/rig-focus-chain.sh [plugin-dir]   (default: repo root)
set -euo pipefail

TARGET="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HOST="${OMARCHY_RIG_HOST:-intent-ops-buzz}"
CONTAINER="${OMARCHY_RIG_CONTAINER:-omarchy-rig}"
RUN_ID="focus-chain-$$"

TGZ="$(mktemp -t crew-chief-chain-XXXXXX.tgz)"
REMOTE="$(mktemp -t crew-chief-chain-XXXXXX.sh)"
trap 'rm -f "$TGZ" "$REMOTE"' EXIT
tar czf "$TGZ" -C "$TARGET" FocusChain.qml Model.js

cat > "$REMOTE" <<'REMOTE_EOF'
#!/bin/sh
set -eu
RUN_ID="$1"
BASE="/tmp/$RUN_ID"
RUNTIME="$BASE/runtime"
rm -rf "$BASE"
mkdir -p "$BASE/shell" "$BASE/bin" "$BASE/sys"
mkdir -m 700 "$RUNTIME"
tar xzf "/tmp/$RUN_ID.tgz" -C "$BASE/shell"
SWAY_PID=""; QS_PID=""
cleanup() {
  [ -z "$QS_PID" ] || kill "$QS_PID" 2>/dev/null || true
  [ -z "$SWAY_PID" ] || kill "$SWAY_PID" 2>/dev/null || true
  rm -rf "$BASE" "/tmp/$RUN_ID.tgz" "/tmp/$RUN_ID.sh"
}
trap cleanup EXIT

CALL_LOG="$BASE/calls.log"
: > "$CALL_LOG"
cat > "$BASE/bin/hyprctl" <<FAKE
#!/bin/sh
printf '%s\n' "\$*" >> "$CALL_LOG"
case "\$*" in
  *hl.dsp.focus*address:0x2*|*hl.dsp.focus*good*) echo ok ;;
  *hl.dsp.focus*address:0x3*) echo ok; exit 1 ;;
  *hl.dsp.focus*slow*) exec sleep 30 >/dev/null ;;
  *hl.dsp.focus*stubborn*) trap '' TERM; sleep 30 >/dev/null ;;
  *hl.dsp.focus*) echo 'warning: hl.focus: window not found' ;;
  *) echo 'error: 3 [string "return hl.dispatch(focuswindow ...)"]: syntax error'; exit 1 ;;
esac
FAKE
chmod +x "$BASE/bin/hyprctl"
# Quickshell's children get a PATH holding only the stand-in hyprctl plus sh, mv
# and sleep, so hiding the stand-in makes hyprctl genuinely missing. On Arch /usr/sbin
# is /usr/bin, so the real hyprctl would otherwise still be found.
ln -s "$(command -v sh)" "$BASE/sys/sh"
ln -s "$(command -v mv)" "$BASE/sys/mv"
ln -s "$(command -v sleep)" "$BASE/sys/sleep"

cat > "$BASE/shell/shell.qml" <<'QML'
import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

ShellRoot {
  id: root
  // lua(sel) and classic(sel) are the two attempt forms as hyprctl receives
  // them; t(name) is the title selector the shipped Model builds for a project.
  function lua(sel) { return Model.focusArgv(sel, "lua").slice(2).join(" ") }
  function classic(sel) { return Model.focusArgv(sel, "classic").slice(2).join(" ") }
  function t(name) { return Model.titleSelector(name) }
  readonly property string miss: "couldn't find that session's window"
  property var scenarios: [
    { name: "address-miss-then-title-hit", session: { window: "0x1", project: "good" },
      expect: [lua("address:0x1"), classic("address:0x1"), lua(t("good"))], notice: "" },
    { name: "address-hit-first-try", session: { window: "0x2", project: "good" },
      expect: [lua("address:0x2")], notice: "" },
    { name: "ok-with-failed-exit-is-a-miss", session: { window: "0x3", project: "good" },
      expect: [lua("address:0x3"), classic("address:0x3"), lua(t("good"))], notice: "" },
    { name: "every-attempt-refused", session: { window: "", project: "never" },
      expect: [lua(t("never")), classic(t("never"))], notice: miss },
    { name: "hung-attempt-times-out", session: { window: "", project: "slow" },
      expect: [lua(t("slow")), classic(t("slow"))], notice: miss, minMs: 2900 },
    { name: "sigterm-ignoring-attempt-is-killed", session: { window: "", project: "stubborn" },
      expect: [lua(t("stubborn")), classic(t("stubborn"))], notice: miss, minMs: 3900 },
    { name: "second-click-while-busy-is-ignored", session: { window: "0x1", project: "good" },
      secondClick: { window: "0x2", project: "good" },
      expect: [lua("address:0x1"), classic("address:0x1"), lua(t("good"))], notice: "" },
    { name: "nothing-to-focus", session: { window: "", project: "" },
      expect: [], notice: "no window recorded for that session" },
    { name: "hyprctl-missing", session: { window: "0x2", project: "good" }, hideBinary: true,
      expect: [lua("address:0x2")], notice: "hyprctl did not start" }
  ]
  property int index: -1
  property int polls: 0
  property int failures: 0
  property double startedAt: 0

  FocusChain { id: chain }

  Process {
    id: hideProc
    command: ["sh", "-c", "mv \"$FAKE_BIN/hyprctl\" \"$FAKE_BIN/hyprctl.off\""]
    onExited: root.start()
  }

  function begin() {
    index++
    if (index >= scenarios.length) {
      console.log("RESULT-DONE failures=" + failures)
      Qt.quit()
      return
    }
    if (scenarios[index].hideBinary) hideProc.running = true
    else start()
  }

  function start() {
    chain.launched = []
    chain.notice = ""
    polls = 0
    startedAt = Date.now()
    chain.run(scenarios[index].session)
    if (scenarios[index].secondClick) chain.run(scenarios[index].secondClick)
    poll.restart()
  }

  Timer {
    id: poll
    interval: 200
    repeat: true
    onTriggered: {
      root.polls++
      if (chain.awaitingExit && root.polls < 75) return
      stop()
      var sc = root.scenarios[root.index]
      var got = chain.launched.map(function(argv) { return argv.slice(2).join(" ") })
      var elapsed = Date.now() - root.startedAt
      // A hang scenario must actually have waited for the deadline, or the
      // stand-in exited early and the timeout path was never exercised.
      var pass = !chain.awaitingExit && JSON.stringify(got) === JSON.stringify(sc.expect)
        && chain.notice === sc.notice && elapsed >= (sc.minMs || 0)
      if (!pass) root.failures++
      console.log("RESULT " + (pass ? "PASS " : "FAIL ") + JSON.stringify({
        name: sc.name, ms: elapsed, launched: got, notice: chain.notice, expected: sc.expect, expectedNotice: sc.notice
      }))
      if (!sc.hideBinary) for (var i = 0; i < got.length; i++) console.log("LAUNCH dispatch " + got[i])
      root.begin()
    }
  }

  Component.onCompleted: begin()
}
QML

export XDG_RUNTIME_DIR="$RUNTIME"
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
  sway --config /dev/null >"$BASE/sway.log" 2>&1 &
SWAY_PID=$!
attempt=0
while [ $attempt -lt 30 ]; do
  SOCKET=$(find "$RUNTIME" -maxdepth 1 -type s -name 'wayland-*' | head -1)
  [ -z "$SOCKET" ] || break
  attempt=$((attempt + 1)); sleep 1
done
[ -n "${SOCKET:-}" ] || { echo "rig-focus-chain: Wayland socket did not start" >&2; exit 1; }
export WAYLAND_DISPLAY="${SOCKET##*/}"

QS_BIN="$(command -v qs)"
TIMEOUT_BIN="$(command -v timeout)"
export FAKE_BIN="$BASE/bin"
PATH="$BASE/bin:$BASE/sys" "$TIMEOUT_BIN" 120 "$QS_BIN" -p "$BASE/shell" >"$BASE/qs.log" 2>&1 &
QS_PID=$!
wait "$QS_PID" || true
QS_PID=""

echo "===RESULTS==="
grep -a -oE 'RESULT( .*|-DONE.*)$' "$BASE/qs.log" || true
echo "===CALLS==="
cat "$CALL_LOG"
echo "===QML WARNINGS==="
WARNINGS=$(grep -a -iE "(WARN|ERROR).*(qml|scene)|(qml|scene).*(WARN|ERROR)|is not a type|cannot assign|ReferenceError|TypeError" "$BASE/qs.log" \
  | grep -avE "libEGL|MESA|ZINK|failed to get driver|failed to create dri2" | head -20 || true)
printf '%s\n' "$WARNINGS"
echo "===QUICKSHELL=== $(qs --version 2>/dev/null | head -1)"
echo "===TESTED FILES==="
(cd "$BASE/shell" && sha256sum FocusChain.qml Model.js)

# Verdict: every scenario passed, the run finished, no QML warnings, and the
# stand-in received exactly the attempts the chain launched, in order.
grep -a -oE 'LAUNCH .*$' "$BASE/qs.log" | sed 's/^LAUNCH //' > "$BASE/launched.log" || true
VERDICT=PASS
grep -aq 'RESULT-DONE failures=0$' "$BASE/qs.log" || VERDICT=FAIL
[ -z "$WARNINGS" ] || VERDICT=FAIL
# No cmp or diff in the rig image; compare the two logs as strings.
[ "$(cat "$CALL_LOG")" = "$(cat "$BASE/launched.log")" ] || { echo "call log does not match the launches"; VERDICT=FAIL; }
echo "===VERDICT=== $VERDICT"
[ "$VERDICT" = PASS ]
REMOTE_EOF

scp -q -o BatchMode=yes "$TGZ" "$HOST:/tmp/$RUN_ID.tgz"
scp -q -o BatchMode=yes "$REMOTE" "$HOST:/tmp/$RUN_ID.sh"
ssh -o BatchMode=yes "$HOST" "docker cp /tmp/$RUN_ID.tgz $CONTAINER:/tmp/ >/dev/null && \
  docker cp /tmp/$RUN_ID.sh $CONTAINER:/tmp/ >/dev/null && \
  rm -f /tmp/$RUN_ID.tgz /tmp/$RUN_ID.sh && \
  docker exec $CONTAINER sh /tmp/$RUN_ID.sh $RUN_ID"

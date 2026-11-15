#!/usr/bin/env bash
# Drive the shipped FocusChain.qml in a real Quickshell on the Omarchy rig.
#
# The row-click chain depends on how Quickshell's Process orders a run's end
# (stream end, exited, runningChanged) and on relaunching from `exited`. Node
# tests cannot load QML and the render never clicks, so this loads the exact
# FocusChain.qml and Model.js in Quickshell under headless sway, with a stand-in
# hyprctl on PATH that logs every call and answers by selector:
#
#   address:0x2 or title:good in the Lua form -> "ok"
#   any other Lua form                       -> "warning: hl.focus: window not found"
#   any classic form                         -> a Lua syntax error, exit 1
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
  *'window = "address:0x2"'*|*'window = "title:good"'*) echo ok ;;
  *'hl.dsp.focus'*) echo 'warning: hl.focus: window not found' ;;
  *) echo 'error: 3 [string "return hl.dispatch(focuswindow ...)"]: syntax error'; exit 1 ;;
esac
FAKE
chmod +x "$BASE/bin/hyprctl"
# Quickshell's children get a PATH holding only the stand-in hyprctl plus sh and
# mv, so hiding the stand-in makes hyprctl genuinely missing. On Arch /usr/sbin
# is /usr/bin, so the real hyprctl would otherwise still be found.
ln -s "$(command -v sh)" "$BASE/sys/sh"
ln -s "$(command -v mv)" "$BASE/sys/mv"

cat > "$BASE/shell/shell.qml" <<'QML'
import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
  id: root
  property var scenarios: [
    { name: "address-miss-then-title-hit", session: { window: "0x1", project: "good" } },
    { name: "address-hit-first-try", session: { window: "0x2", project: "good" } },
    { name: "every-attempt-refused", session: { window: "", project: "never" } },
    { name: "nothing-to-focus", session: { window: "", project: "" } },
    { name: "hyprctl-missing", session: { window: "0x2", project: "good" }, hideBinary: true }
  ]
  property int index: -1
  property int polls: 0

  FocusChain { id: chain }

  Process {
    id: hideProc
    command: ["sh", "-c", "mv \"$FAKE_BIN/hyprctl\" \"$FAKE_BIN/hyprctl.off\""]
    onExited: root.start()
  }

  function begin() {
    index++
    if (index >= scenarios.length) { console.log("RESULT-DONE"); Qt.quit(); return }
    if (scenarios[index].hideBinary) hideProc.running = true
    else start()
  }

  function start() {
    chain.launched = []
    chain.notice = ""
    polls = 0
    chain.run(scenarios[index].session)
    poll.restart()
  }

  Timer {
    id: poll
    interval: 200
    repeat: true
    onTriggered: {
      root.polls++
      if (chain.awaitingExit && root.polls < 50) return
      stop()
      console.log("RESULT " + JSON.stringify({
        name: root.scenarios[root.index].name,
        launched: chain.launched.map(function(argv) { return argv.slice(2).join(" ") }),
        notice: chain.notice,
        settled: !chain.awaitingExit
      }))
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
PATH="$BASE/bin:$BASE/sys" "$TIMEOUT_BIN" 60 "$QS_BIN" -p "$BASE/shell" >"$BASE/qs.log" 2>&1 &
QS_PID=$!
wait "$QS_PID" || true
QS_PID=""

echo "===RESULTS==="
grep -a -oE 'RESULT( .*|-DONE)$' "$BASE/qs.log" || true
echo "===CALLS==="
cat "$CALL_LOG"
echo "===QML WARNINGS==="
grep -a -iE "(WARN|ERROR).*(qml|scene)|(qml|scene).*(WARN|ERROR)|is not a type|cannot assign|ReferenceError|TypeError" "$BASE/qs.log" \
  | grep -avE "libEGL|MESA|ZINK|failed to get driver|failed to create dri2" | head -20 || true
echo "===QUICKSHELL=== $(qs --version 2>/dev/null | head -1)"
REMOTE_EOF

scp -q -o BatchMode=yes "$TGZ" "$HOST:/tmp/$RUN_ID.tgz"
scp -q -o BatchMode=yes "$REMOTE" "$HOST:/tmp/$RUN_ID.sh"
ssh -o BatchMode=yes "$HOST" "docker cp /tmp/$RUN_ID.tgz $CONTAINER:/tmp/ >/dev/null && \
  docker cp /tmp/$RUN_ID.sh $CONTAINER:/tmp/ >/dev/null && \
  rm -f /tmp/$RUN_ID.tgz /tmp/$RUN_ID.sh && \
  docker exec $CONTAINER sh /tmp/$RUN_ID.sh $RUN_ID"

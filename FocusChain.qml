import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Runs a row click's focus attempts (Model.focusAttempts) one at a time and
// stops at the first one hyprctl reports as "ok" with exit status 0. When every
// attempt is refused, times out, or hyprctl cannot be started, `notice` says so
// for five seconds. An attempt that runs past `attemptTimeoutMs` is sent
// SIGTERM, then SIGKILL a second later, and counts as refused.
//
// Kept apart from Panel.qml so the exact shipped chain can be loaded on its own
// in a real Quickshell and driven against a stand-in hyprctl
// (scripts/rig-focus-chain.sh).
//
// The chain leans on how Quickshell's Process ends a run (src/io/process.cpp,
// Process::onFinished): it clears the process, so `running` is false, ends the
// stdout stream, emits `exited`, then emits `runningChanged`. So the reply is
// already captured when `exited` runs, and setting `running = true` there
// starts the next attempt at once. A command that fails to start emits neither
// `exited` nor a stream end, only `runningChanged`, while an attempt is still
// awaiting its exit.
Item {
  id: chain
  visible: false

  property string notice: ""
  // Remaining attempts for the click in progress.
  property var queue: []
  // True from the moment an attempt is launched until its exit is handled.
  property bool awaitingExit: false
  // The argv list of every attempt in the current click, for the rig harness to
  // inspect. Reset on each click, so a long-lived shell never accumulates it.
  property var launched: []
  property int attemptTimeoutMs: 3000
  property bool terminateSent: false

  // Not named focus: every Item already has a `focus` property, which shadows a
  // function of that name, so a call would throw "not a function".
  function run(session) {
    if (proc.running || awaitingExit) return
    var attempts = Model.focusAttempts(session)
    if (attempts.length === 0) {
      showNotice("no window recorded for that session")
      return
    }
    notice = ""
    launched = []
    queue = attempts.slice(1)
    launch(attempts[0])
  }

  function launch(argv) {
    launched = launched.concat([argv])
    proc.command = argv
    awaitingExit = true
    terminateSent = false
    deadline.interval = attemptTimeoutMs
    deadline.restart()
    proc.running = true
  }

  function next() {
    if (queue.length === 0) {
      showNotice("couldn't find that session's window")
      return
    }
    var argv = queue[0]
    queue = queue.slice(1)
    launch(argv)
  }

  function showNotice(text) {
    notice = text
    noticeTimer.restart()
  }

  Process {
    id: proc
    property string reply: ""
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: proc.reply = text
    }
    onExited: function(exitCode, exitStatus) {
      deadline.stop()
      chain.awaitingExit = false
      var ok = Model.focusSucceeded(reply, exitCode)
      reply = ""
      if (ok) {
        chain.queue = []
        return
      }
      chain.next()
    }
    onRunningChanged: {
      if (running || !chain.awaitingExit) return
      deadline.stop()
      chain.awaitingExit = false
      chain.queue = []
      chain.showNotice("hyprctl did not start")
    }
  }

  // A hung hyprctl must not hold the chain forever: terminate, then kill. Its
  // exit then runs the normal onExited path with no "ok" reply.
  Timer {
    id: deadline
    onTriggered: {
      if (!proc.running) return
      if (!chain.terminateSent) {
        chain.terminateSent = true
        proc.signal(15)
        interval = 1000
        restart()
        return
      }
      proc.signal(9)
    }
  }

  Timer {
    id: noticeTimer
    interval: 5000
    onTriggered: chain.notice = ""
  }
}

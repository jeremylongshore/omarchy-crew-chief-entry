import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Crew Chief panel: polls the spool directory the Claude Code hook writes
// (one JSON file per session) and renders the fleet, attention first.
Panel {
  id: root
  moduleName: "io.github.jeremylongshore.crew-chief"
  ipcTarget: "io.github.jeremylongshore.crew-chief"
  manageIpc: false

  property var anchorItem: null
  property bool openedFromHotkey: false
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  function open() {
    openedFromHotkey = false
    root.controller.show()
    root.refresh()
  }

  function openFromHotkey() {
    openedFromHotkey = true
    root.controller.show()
    root.refresh()
  }

  function close() {
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") !== ""
    ? Quickshell.env("XDG_STATE_HOME")
    : Quickshell.env("HOME") + "/.local/state"
  readonly property string spoolDir: stateHome + "/omarchy/crew-chief"

  // Set when the last read hit a bound, so the hero can say the fleet shown is
  // partial instead of pretending it is complete.
  property bool spoolTruncated: false

  // How many sessions exist that the bounded reader did not return, so the hero
  // can name the gap instead of hinting at one.
  property int spoolHidden: 0

  property var sessions: []
  property double nowMs: Date.now()
  property int selIdx: 0

  readonly property int pollSec: Math.max(1, parseInt(setting("pollSec", 3), 10) || 3)
  readonly property int staleMinutes: Math.max(30, parseInt(setting("staleMinutes", 240), 10) || 240)
  readonly property bool showDone: String(setting("showDone", "On")) !== "Off"
  readonly property bool herdrSync: String(setting("herdrSync", "On")) !== "Off"

  // Bundled herdr adapter, resolved relative to this plugin's directory.
  readonly property string herdrAdapterPath: Qt.resolvedUrl("adapters/herdr-sync").toString().replace(/^file:\/\//, "")
  // Keep the bounded spool scan in a bundled executable. Passing these as
  // Process argv entries—not through `bash -c`—means an apostrophe in HOME or
  // a path can never alter the command that reads the session spool.
  readonly property string spoolReaderPath: Qt.resolvedUrl("bin/read-spool").toString().replace(/^file:\/\//, "")
  readonly property string spoolHelperPath: Qt.resolvedUrl("bin/crew-chief-spool").toString().replace(/^file:\/\//, "")
  property var dismissQueue: []

  readonly property var liveList: Model.liveSessions(sessions, nowMs, staleMinutes * 60000)
  readonly property var visibleList: {
    var rows = Model.sortSessions(liveList)
    if (showDone) return rows
    var out = []
    for (var i = 0; i < rows.length; i++) if (rows[i].state !== "done") out.push(rows[i])
    return out
  }
  readonly property var summary: Model.summarize(liveList)
  readonly property bool needsAttention: summary.needs > 0

  onVisibleListChanged: {
    if (selIdx >= visibleList.length) selIdx = visibleList.length > 0 ? visibleList.length - 1 : 0
  }

  function moveCursor(dy) {
    if (visibleList.length === 0) return
    selIdx = Math.max(0, Math.min(visibleList.length - 1, selIdx + dy))
  }

  function activateSelected() {
    if (visibleList.length === 0) return
    focusProject(visibleList[selIdx].project)
  }

  function dismissSelected() {
    if (visibleList.length === 0) return
    dismiss(visibleList[selIdx].id)
  }

  // Bar pill: headset glyph + fleet status. Empty (slot collapses) with no
  // live sessions.
  readonly property string label: {
    var text = Model.pillText(summary)
    return text === "" ? "" : "󰋎 " + text
  }

  readonly property string tooltip: summary.total === 0 ? "" :
    summary.total + " agent session" + (summary.total === 1 ? "" : "s")
    + (summary.needs > 0 ? " · " + summary.needs + " waiting on you" : "")

  function refresh() {
    nowMs = Date.now()
    if (!spoolProc.running) spoolProc.running = true
  }

  function runNextDismiss() {
    if (dismissProc.running || dismissQueue.length === 0) return
    dismissProc.command = [spoolHelperPath, "remove", spoolDir, dismissQueue[0]]
    dismissProc.running = true
  }

  // Dismiss through the same descriptor-bound lifecycle as every writer.
  function dismiss(id) {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return
    if (dismissQueue.indexOf(id) < 0) dismissQueue = dismissQueue.concat([id])
    runNextDismiss()
  }

  function clearFinished() {
    var rows = liveList
    for (var i = 0; i < rows.length; i++)
      if (rows[i].state === "done") dismiss(rows[i].id)
  }

  // Project labels originate in hook-written records. Give hyprctl one argv
  // item so quotes and shell metacharacters remain literal title text.
  function focusProject(project) {
    var target = Model.focusTarget(project)
    if (target === "" || focusProc.running) return
    focusProc.command = ["hyprctl", "dispatch", "focuswindow", "title:" + target]
    focusProc.running = true
  }

  Process {
    id: spoolProc
    // Optionally refresh herdr-detected sessions (self-noops without herdr),
    // then read a BOUNDED slice of the spool.
    //
    // This used to be `cat <spool>/*.json`, with no limit on how many files it
    // read or how large any of them were. The spool is written by agents, and
    // this plugin advertises that anything able to run a command may write to
    // it, so its size is not under this widget's control. A long-lived shell
    // process reading it every few seconds is exactly where unbounded growth
    // becomes a memory problem. Reported against submission 1436.
    //
    // Bounded three ways now: the newest MAX_SPOOL_FILES files only, at most
    // MAX_FILE_BYTES from each, and Model.parseSpool caps again on the way in.
    // The newest-first ordering means an overflowing spool loses the stalest
    // rows, which are the ones that age out anyway.
    command: [root.spoolReaderPath, spoolDir,
      root.herdrSync ? root.herdrAdapterPath : ""]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.sessions = Model.parseSpool(text)
        root.spoolTruncated = Model.spoolTruncated()
        root.spoolHidden = Math.max(0, Model.spoolTotal() - root.sessions.length)
      }
    }
  }

  Process {
    id: dismissProc
    onExited: {
      root.dismissQueue = root.dismissQueue.slice(1)
      root.runNextDismiss()
      root.refresh()
    }
  }

  Process { id: focusProc }

  Timer {
    interval: root.pollSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { root.refresh() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    // The marketplace preview and a real multi-agent fleet need enough width
    // to show project, harness, state, age, and the blocked headline together.
    contentWidth: panel.fittedContentWidth(Style.space(680))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) { root.moveCursor(dy) }
      onActivateRequested: root.activateSelected()
      onDeleteRequested: root.dismissSelected()
      onTextKey: function(t) {
        if (t === "r") root.refresh()
        else if (t === "o") root.activateSelected()
        else if (t === "x") root.dismissSelected()
        else if (t === "c") root.clearFinished()
      }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: contentColumn
          width: parent.width
          spacing: Style.space(10)

          // ---- Hero: fleet summary.
          PanelHero {
            title: root.summary.total === 0 ? "NO SESSIONS ON TRACK"
              : (root.summary.needs > 0
                ? root.summary.needs + " WAITING ON YOU"
                : root.summary.total + " ON TRACK")
            // A truncated fleet is said out loud. Silently showing a partial
            // list would be a worse bug than the unbounded read it replaced:
            // this widget's whole claim is that it shows you everything that is
            // waiting on you, so quietly dropping rows breaks the promise while
            // looking healthy.
            meta: root.summary.total === 0
              ? "Wire a harness (Claude Code, Codex, Goose, ...) and sessions report in here."
              : (root.summary.working + " working · " + root.summary.needs + " blocked · "
                 + root.summary.done + " done"
                 + (root.spoolTruncated && root.spoolHidden > 0
                    ? "  ·  +" + root.spoolHidden + " not shown"
                    : ""))
            foreground: root.bar ? root.bar.foreground : Color.foreground
            fontFamily: root.bar ? root.bar.fontFamily : Style.font.family

            iconComponent: Component {
              Text {
                text: "󰋎"
                color: root.needsAttention && root.bar ? root.bar.urgent
                  : (root.bar ? root.bar.foreground : Color.foreground)
                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                font.pixelSize: Style.font.display
              }
            }
          }

          PanelSeparator {
            visible: root.visibleList.length > 0
            foreground: root.bar ? root.bar.foreground : Color.foreground
          }

          // ---- Session rows, attention first.
          Repeater {
            model: root.visibleList

            Item {
              id: row
              required property int index
              required property var modelData
              readonly property bool blocked: modelData.state === "needs_you"
              readonly property bool selected: index === root.selIdx
              readonly property color fg: root.bar ? root.bar.foreground : Color.foreground
              width: contentColumn.width
              height: rowCol.implicitHeight + Style.space(10)

              Rectangle {
                anchors.fill: parent
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(8)
                radius: Style.cornerRadius
                color: row.selected || rowArea.containsMouse
                  ? Style.hoverFillFor(row.fg, Color.accent) : "transparent"
              }

              Column {
                id: rowCol
                anchors.left: parent.left
                anchors.leftMargin: Style.space(16)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(16)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Item {
                  width: parent.width
                  height: projectText.implicitHeight

                  Rectangle {
                    id: stateDot
                    width: Style.space(8)
                    height: Style.space(8)
                    radius: width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    color: row.blocked ? (root.bar ? root.bar.urgent : Color.urgent)
                      : modelData.state === "done" ? Qt.darker(row.fg, 1.6) : row.fg

                    SequentialAnimation on opacity {
                      running: row.blocked
                      loops: Animation.Infinite
                      NumberAnimation { from: 1; to: 0.25; duration: 700 }
                      NumberAnimation { from: 0.25; to: 1; duration: 700 }
                    }
                  }

                  Text {
                    id: projectText
                    anchors.left: stateDot.right
                    anchors.leftMargin: Style.space(10)
                    text: modelData.project || modelData.id.substring(0, 8)
                    // A project name is written by whoever ran the agent, so it
                    // is unbounded input on a fixed-width bar row. Cap it and
                    // elide. Math.min keeps short names rendering at their
                    // natural width, so nothing about the common case moves.
                    textFormat: Text.PlainText
                    width: Math.min(implicitWidth, parent.width * 0.45)
                    elide: Text.ElideRight
                    color: row.fg
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.body
                    font.bold: row.blocked
                  }

                  Text {
                    visible: modelData.agent !== ""
                    anchors.left: projectText.right
                    anchors.leftMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.agent
                    textFormat: Text.PlainText
                    width: Math.min(implicitWidth, parent.width * 0.25)
                    elide: Text.ElideRight
                    color: Qt.darker(row.fg, 1.6)
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.caption
                  }

                  Text {
                    anchors.right: ageText.left
                    anchors.rightMargin: Style.space(10)
                    anchors.verticalCenter: parent.verticalCenter
                    text: Model.stateLabel(modelData.state)
                    textFormat: Text.PlainText
                    width: Math.min(implicitWidth, parent.width * 0.2)
                    elide: Text.ElideRight
                    color: row.blocked ? (root.bar ? root.bar.urgent : Color.urgent) : Qt.darker(row.fg, 1.4)
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.caption
                    font.letterSpacing: 1
                  }

                  Text {
                    id: ageText
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: Model.ageText(modelData.ts, root.nowMs)
                    textFormat: Text.PlainText
                    width: Math.min(implicitWidth, parent.width * 0.15)
                    elide: Text.ElideRight
                    color: Qt.darker(row.fg, 1.5)
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.caption
                  }
                }

                Text {
                  visible: row.blocked && modelData.message !== ""
                  width: parent.width
                  leftPadding: Style.space(18)
                  text: modelData.message
                  textFormat: Text.PlainText
                  color: Qt.darker(row.fg, 1.3)
                  font.family: root.bar ? root.bar.fontFamily : Style.font.family
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                  maximumLineCount: 1
                }
              }

              MouseArea {
                id: rowArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                acceptedButtons: Qt.LeftButton | Qt.RightButton
                Accessible.role: Accessible.Button
                Accessible.name: (row.modelData.project || row.modelData.id)
                  + ", " + Model.stateLabel(row.modelData.state)
                onClicked: function(mouse) {
                  root.selIdx = row.index
                  if (mouse.button === Qt.RightButton) {
                    root.dismiss(row.modelData.id)
                    return
                  }
                  // Best-effort jump to the terminal running this project.
                  if (root.bar && row.modelData.project !== "")
                    root.focusProject(row.modelData.project)
                }
              }
            }
          }

          // ---- Footer: clear finished runs.
          Item {
            visible: root.summary.done > 0
            width: parent.width
            height: clearText.implicitHeight + Style.space(12)

            Text {
              id: clearText
              anchors.right: parent.right
              anchors.rightMargin: Style.space(16)
              anchors.verticalCenter: parent.verticalCenter
              text: "CLEAR FINISHED"
              color: clearArea.containsMouse
                ? (root.bar ? root.bar.foreground : Color.foreground)
                : Qt.darker(root.bar ? root.bar.foreground : Color.foreground, 1.4)
              font.family: root.bar ? root.bar.fontFamily : Style.font.family
              font.pixelSize: Style.font.caption
              font.letterSpacing: 1

              MouseArea {
                id: clearArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                Accessible.role: Accessible.Button
                Accessible.name: "Clear finished Crew Chief sessions"
                onClicked: root.clearFinished()
              }
            }
          }

          Item { width: 1; height: Style.space(4) }
        }
      }
    }
  }
}

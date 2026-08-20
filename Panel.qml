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

  readonly property string spoolDir: Quickshell.env("HOME") + "/.local/state/omarchy/crew-chief"

  property var sessions: []
  property double nowMs: Date.now()

  readonly property int pollSec: Math.max(1, parseInt(setting("pollSec", 3), 10) || 3)
  readonly property int staleMinutes: Math.max(30, parseInt(setting("staleMinutes", 240), 10) || 240)
  readonly property bool showDone: String(setting("showDone", "On")) !== "Off"

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

  // Bar pill: headset glyph + fleet status. Empty (slot collapses) with no
  // live sessions.
  readonly property string label: {
    var text = Model.pillText(summary)
    return text === "" ? "" : "󰋎 " + text
  }

  readonly property string tooltip: summary.total === 0 ? "" :
    summary.total + " Claude Code session" + (summary.total === 1 ? "" : "s")
    + (summary.needs > 0 ? " · " + summary.needs + " waiting on you" : "")

  function refresh() {
    nowMs = Date.now()
    if (!spoolProc.running) spoolProc.running = true
  }

  // Dismiss one session row (rm its spool file). Ids come from hook-written
  // file content; only act on shapes that cannot escape the spool dir.
  function dismiss(id) {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return
    dismissProc.command = ["rm", "-f", spoolDir + "/" + id + ".json"]
    dismissProc.running = true
  }

  function clearFinished() {
    var rows = liveList
    for (var i = 0; i < rows.length; i++)
      if (rows[i].state === "done") dismiss(rows[i].id)
  }

  Process {
    id: spoolProc
    // cat the whole spool; each file is one compact JSON line.
    command: ["bash", "-c", "cat " + spoolDir + "/*.json 2>/dev/null; true"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.sessions = Model.parseSpool(text)
    }
  }

  Process {
    id: dismissProc
    onExited: root.refresh()
  }

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
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

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
            meta: root.summary.total === 0
              ? "Start a Claude Code session and it reports in here."
              : root.summary.working + " working · " + root.summary.needs + " blocked · " + root.summary.done + " done"
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
              required property var modelData
              readonly property bool blocked: modelData.state === "needs_you"
              readonly property color fg: root.bar ? root.bar.foreground : Color.foreground
              width: contentColumn.width
              height: rowCol.implicitHeight + Style.space(10)

              Rectangle {
                anchors.fill: parent
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(8)
                radius: Style.cornerRadius
                color: rowArea.containsMouse ? Style.hoverFillFor(row.fg, Color.accent) : "transparent"
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
                    color: row.fg
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.body
                    font.bold: row.blocked
                  }

                  Text {
                    anchors.right: ageText.left
                    anchors.rightMargin: Style.space(10)
                    anchors.verticalCenter: parent.verticalCenter
                    text: Model.stateLabel(modelData.state)
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
                onClicked: function(mouse) {
                  if (mouse.button === Qt.RightButton) {
                    root.dismiss(row.modelData.id)
                    return
                  }
                  // Best-effort jump to the terminal running this project.
                  if (root.bar && row.modelData.project !== "")
                    root.bar.run("hyprctl dispatch focuswindow 'title:" + row.modelData.project + "'")
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

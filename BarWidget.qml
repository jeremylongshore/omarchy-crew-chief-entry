import QtQuick
import qs.Commons
import qs.Ui

// Bar host for Crew Chief. Mirrors the first-party split: this widget owns
// the bar slot and pill; Panel.qml owns the spool watching and the popup.
BarWidget {
  id: root
  moduleName: "io.github.jeremylongshore.crew-chief"

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function refresh() {
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  // No sessions -> no slot. The pill only exists when there is a fleet.
  visible: panelLoader.item && panelLoader.item.label !== ""
  implicitWidth: visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: panelLoader.item ? panelLoader.item.label : ""
    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
    // A blocked session lights the pill in the bar's active color: the crew
    // chief is on the radio.
    active: panelLoader.item ? panelLoader.item.needsAttention === true : false
    tooltipText: panelLoader.item ? panelLoader.item.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
  }
}

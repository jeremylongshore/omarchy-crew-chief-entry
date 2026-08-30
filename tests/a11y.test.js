const test = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { join } = require("node:path")

const root = join(__dirname, "..")
const panel = readFileSync(join(root, "Panel.qml"), "utf8")
const bar = readFileSync(join(root, "BarWidget.qml"), "utf8")

test("the bar exposes a dynamic accessible button name", () => {
  assert.match(bar, /Accessible\.role:\s*Accessible\.Button/)
  assert.match(bar, /Accessible\.name:\s*root\.opened\s*\?\s*"Close Crew Chief"\s*:\s*"Open Crew Chief"/)
})

test("session rows and the clear control are named buttons", () => {
  assert.match(panel, /Accessible\.name:\s*\(row\.modelData\.project \|\| row\.modelData\.id\)/)
  assert.match(panel, /Accessible\.name:\s*"Clear finished Crew Chief sessions"/)
  assert.ok((panel.match(/Accessible\.role:\s*Accessible\.Button/g) || []).length >= 2)
})

test("the keyboard contract covers navigation, activation, deletion, close, tab, and commands", () => {
  for (const token of [
    "onCloseRequested: root.close()",
    "onTabRequested: function(direction) { root.switchPanel(direction) }",
    "onMoveRequested: function(dx, dy) { root.moveCursor(dy) }",
    "onActivateRequested: root.activateSelected()",
    "onDeleteRequested: root.dismissSelected()",
    't === "r"', 't === "o"', 't === "x"', 't === "c"'
  ]) assert.ok(panel.includes(token), token)
})

test("every session-derived Text explicitly renders plain text", () => {
  for (const expression of [
    "text: modelData.project || modelData.id.substring(0, 8)",
    "text: modelData.agent",
    "text: Model.stateLabel(modelData.state)",
    "text: Model.ageText(modelData.ts, root.nowMs)",
    "text: modelData.message"
  ]) {
    const start = panel.indexOf(expression)
    assert.ok(start >= 0, expression)
    assert.match(panel.slice(start, start + 500), /textFormat:\s*Text\.PlainText/)
  }
})


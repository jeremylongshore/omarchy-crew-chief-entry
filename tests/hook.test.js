const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const HOOK = path.join(__dirname, "..", "hooks", "crew-chief-event")

function runHook(spool, payload) {
  execFileSync("bash", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CREW_CHIEF_SPOOL: spool }
  })
}

function readSpool(spool, id) {
  return JSON.parse(fs.readFileSync(path.join(spool, id + ".json"), "utf8"))
}

test("hook writes, updates, and removes one spool file per session", (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-test-"))
  t.after(() => fs.rmSync(spool, { recursive: true, force: true }))

  runHook(spool, { session_id: "s1", hook_event_name: "SessionStart", cwd: "/tmp/proj" })
  let row = readSpool(spool, "s1")
  assert.equal(row.state, "working")
  assert.equal(row.cwd, "/tmp/proj")
  assert.ok(row.ts > 0)

  runHook(spool, { session_id: "s1", hook_event_name: "Notification", cwd: "/tmp/proj", message: "needs permission" })
  row = readSpool(spool, "s1")
  assert.equal(row.state, "needs_you")
  assert.equal(row.message, "needs permission")

  runHook(spool, { session_id: "s1", hook_event_name: "Stop", cwd: "/tmp/proj" })
  row = readSpool(spool, "s1")
  assert.equal(row.state, "done")
  assert.equal(row.message, "")

  runHook(spool, { session_id: "s1", hook_event_name: "SessionEnd", cwd: "/tmp/proj" })
  assert.equal(fs.existsSync(path.join(spool, "s1.json")), false)
})

test("hook ignores payloads without a session id", (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-test-"))
  t.after(() => fs.rmSync(spool, { recursive: true, force: true }))
  runHook(spool, { hook_event_name: "Notification" })
  assert.deepEqual(fs.readdirSync(spool), [])
})

test("hook output is single-line JSON the widget can cat together", (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-test-"))
  t.after(() => fs.rmSync(spool, { recursive: true, force: true }))
  runHook(spool, { session_id: "a", hook_event_name: "SessionStart", cwd: "/x/one" })
  runHook(spool, { session_id: "b", hook_event_name: "Notification", cwd: "/x/two", message: "hi" })
  const cat = fs.readdirSync(spool).sort()
    .map((f) => fs.readFileSync(path.join(spool, f), "utf8").trim())
    .join("\n")
  const Model = require("../Model.js")
  const sessions = Model.parseSpool(cat)
  assert.equal(sessions.length, 2)
  assert.deepEqual(sessions.map((s) => s.project).sort(), ["one", "two"])
})

test("installer wires all five events idempotently", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-settings-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const settings = path.join(dir, "settings.json")
  fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook" }] }] } }))

  const installer = path.join(__dirname, "..", "hooks", "install-claude-hooks")
  execFileSync("bash", [installer], { env: { ...process.env, CLAUDE_SETTINGS: settings } })
  execFileSync("bash", [installer], { env: { ...process.env, CLAUDE_SETTINGS: settings } })

  const out = JSON.parse(fs.readFileSync(settings, "utf8"))
  for (const event of ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "SessionEnd"]) {
    const commands = out.hooks[event].flatMap((m) => m.hooks.map((h) => h.command))
    const ours = commands.filter((c) => c.endsWith("crew-chief-event"))
    assert.equal(ours.length, 1, event + " has exactly one crew-chief entry")
  }
  // Pre-existing hook preserved.
  const stopCommands = out.hooks.Stop.flatMap((m) => m.hooks.map((h) => h.command))
  assert.ok(stopCommands.includes("existing-hook"))
})

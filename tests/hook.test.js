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

test("generic reporter covers any harness: states, defaults, end", (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-report-"))
  t.after(() => fs.rmSync(spool, { recursive: true, force: true }))
  const reporter = path.join(__dirname, "..", "bin", "crew-chief-report")
  const env = { ...process.env, CREW_CHIEF_SPOOL: spool, CREW_CHIEF_AGENT: "goose" }

  execFileSync("bash", [reporter, "needs_you", "--id", "g1", "--cwd", "/p/api", "--message", "approve tool?"], { env })
  let row = JSON.parse(fs.readFileSync(path.join(spool, "g1.json"), "utf8"))
  assert.equal(row.state, "needs_you")
  assert.equal(row.agent, "goose")
  assert.equal(row.message, "approve tool?")

  execFileSync("bash", [reporter, "working", "--id", "g1", "--agent", "kilo"], { env })
  row = JSON.parse(fs.readFileSync(path.join(spool, "g1.json"), "utf8"))
  assert.equal(row.state, "working")
  assert.equal(row.agent, "kilo")

  // Hostile id characters are flattened, never a path escape.
  execFileSync("bash", [reporter, "done", "--id", "../../evil"], { env })
  assert.ok(fs.existsSync(path.join(spool, "-..-..-evil".replace(/^/, "") + ".json")) ||
    fs.readdirSync(spool).every((f) => !f.includes("/")))

  execFileSync("bash", [reporter, "end", "--id", "g1"], { env })
  assert.equal(fs.existsSync(path.join(spool, "g1.json")), false)

  // Bad state refuses loudly.
  assert.throws(() => execFileSync("bash", [reporter, "exploded", "--id", "x"], { env }))
})

test("codex notify adapter maps turn completion to done", (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-codex-"))
  t.after(() => fs.rmSync(spool, { recursive: true, force: true }))
  const adapter = path.join(__dirname, "..", "adapters", "codex-notify")
  const env = { ...process.env, CREW_CHIEF_SPOOL: spool }

  execFileSync("bash", [adapter, JSON.stringify({ type: "agent-turn-complete", "turn-id": "t-42", cwd: "/p/webapp" })], { env })
  const row = JSON.parse(fs.readFileSync(path.join(spool, "t-42.json"), "utf8"))
  assert.equal(row.state, "done")
  assert.equal(row.agent, "codex")
  assert.equal(row.cwd, "/p/webapp")

  // Unknown event types are ignored, not errors.
  execFileSync("bash", [adapter, JSON.stringify({ type: "something-else" })], { env })
  assert.equal(fs.readdirSync(spool).length, 1)
  // Garbage payload exits quietly too.
  execFileSync("bash", [adapter, "not json"], { env })
  assert.equal(fs.readdirSync(spool).length, 1)
})

test("spool rows carry the agent through parseSpool", () => {
  const Model = require("../Model.js")
  const rows = Model.parseSpool(JSON.stringify(
    { id: "a", state: "working", cwd: "/p/x", agent: "hermes", message: "", ts: 5 }))
  assert.equal(rows[0].agent, "hermes")
  const bare = Model.parseSpool(JSON.stringify({ id: "b", state: "done", cwd: "", ts: 5 }))
  assert.equal(bare[0].agent, "")
})

test("herdr adapter snapshots agents, maps states, prunes vanished rows", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-chief-herdr-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const spool = path.join(dir, "spool")
  const fakeBin = path.join(dir, "bin")
  fs.mkdirSync(fakeBin, { recursive: true })
  const adapter = path.join(__dirname, "..", "adapters", "herdr-sync")

  const snapshot = (agents) => JSON.stringify({ id: "cli:agent:list", result: { agents, type: "agent_list" } })
  const writeFake = (agents) => {
    fs.writeFileSync(path.join(fakeBin, "herdr"),
      "#!/bin/bash\necho '" + snapshot(agents) + "'\n", { mode: 0o755 })
  }
  const env = { ...process.env, CREW_CHIEF_SPOOL: spool, PATH: fakeBin + ":" + process.env.PATH }

  writeFake([
    { agent: "codex", agent_status: "blocked", cwd: "/p/payments-api", terminal_id: "t1", terminal_title_stripped: "fix webhook retries" },
    { agent: "claude", agent_status: "working", cwd: "/p/blog", terminal_id: "t2", terminal_title_stripped: "draft post" },
    { agent: "amp", agent_status: "idle", cwd: "/p/dotfiles", terminal_id: "t3", terminal_title_stripped: "" }
  ])
  // A non-herdr row must survive the snapshot sync untouched.
  fs.mkdirSync(spool, { recursive: true })
  fs.writeFileSync(path.join(spool, "manual.json"), JSON.stringify({ id: "manual", state: "working", cwd: "/p/x", agent: "goose", message: "", ts: 5 }))

  execFileSync("bash", [adapter], { env })
  const rows = Object.fromEntries(fs.readdirSync(spool).map((f) => [f, JSON.parse(fs.readFileSync(path.join(spool, f), "utf8"))]))
  assert.equal(rows["herdr-t1.json"].state, "needs_you")
  assert.equal(rows["herdr-t1.json"].agent, "codex")
  assert.equal(rows["herdr-t1.json"].message, "fix webhook retries")
  assert.equal(rows["herdr-t2.json"].state, "working")
  assert.equal(rows["herdr-t3.json"].state, "done") // idle -> your move
  assert.ok(rows["manual.json"])

  // Pane t2 vanishes -> its row is pruned; manual row still untouched.
  writeFake([{ agent: "codex", agent_status: "working", cwd: "/p/payments-api", terminal_id: "t1", terminal_title_stripped: "" }])
  execFileSync("bash", [adapter], { env })
  const after = fs.readdirSync(spool).sort()
  assert.deepEqual(after, ["herdr-t1.json", "manual.json"])

  // No herdr on PATH -> silent no-op.
  execFileSync("bash", [adapter], { env: { ...process.env, CREW_CHIEF_SPOOL: spool, PATH: "/usr/bin:/bin" } })
  assert.deepEqual(fs.readdirSync(spool).sort(), ["herdr-t1.json", "manual.json"])
})

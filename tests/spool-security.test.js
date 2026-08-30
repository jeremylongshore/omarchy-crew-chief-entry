const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync, spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.join(__dirname, "..")
const helper = path.join(root, "bin", "crew-chief-spool")
const hook = path.join(root, "hooks", "crew-chief-event")

function tempRoot(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), label))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function row(id, state = "working", ts = Date.now()) {
  return JSON.stringify({ id, state, cwd: "/p/demo", agent: "codex", message: "", ts })
}

function run(op, spool, id, input = "", env = {}) {
  const args = [op, spool]
  if (id !== undefined) args.push(id)
  return spawnSync(helper, args, {
    input,
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, ...env }
  })
}

test("hook rejects oversized input and traversal ids before final-file removal", (t) => {
  const base = tempRoot(t, "crew-chief-hook-hostile-")
  const spool = path.join(base, "spool")
  fs.mkdirSync(spool)
  const outside = path.join(base, "escape.json")
  fs.writeFileSync(outside, "do-not-delete")

  execFileSync("bash", [hook], {
    input: JSON.stringify({ session_id: "../escape", hook_event_name: "SessionEnd" }),
    env: { ...process.env, CREW_CHIEF_SPOOL: spool }
  })
  assert.equal(fs.readFileSync(outside, "utf8"), "do-not-delete")

  const huge = JSON.stringify({
    session_id: "too-large",
    hook_event_name: "Notification",
    message: "x".repeat(17000)
  })
  execFileSync("bash", [hook], {
    input: huge,
    env: { ...process.env, CREW_CHIEF_SPOOL: spool }
  })
  assert.equal(fs.existsSync(path.join(spool, "too-large.json")), false)
})

test("final symlink is replaced without following its target", (t) => {
  const base = tempRoot(t, "crew-chief-final-")
  const spool = path.join(base, "spool")
  fs.mkdirSync(spool)
  const target = path.join(base, "target")
  fs.writeFileSync(target, "unchanged")
  fs.symlinkSync(target, path.join(spool, "safe.json"))

  const result = run("write", spool, "safe", row("safe"))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(target, "utf8"), "unchanged")
  assert.equal(fs.lstatSync(path.join(spool, "safe.json")).isFile(), true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(spool, "safe.json"))).id, "safe")
})

test("planted temporary symlink fails closed and never touches its target", (t) => {
  const base = tempRoot(t, "crew-chief-temp-")
  const spool = path.join(base, "spool")
  fs.mkdirSync(spool)
  const target = path.join(base, "target")
  fs.writeFileSync(target, "unchanged")
  fs.symlinkSync(target, path.join(spool, ".forced.tmp"))

  const result = run("write", spool, "safe", row("safe"), {
    CREW_CHIEF_TEST_TEMP_NAME: "forced"
  })
  assert.notEqual(result.status, 0)
  assert.equal(fs.readFileSync(target, "utf8"), "unchanged")
  assert.equal(fs.existsSync(path.join(spool, "safe.json")), false)
})

test("parent-directory swap stays bound to the directory opened by the helper", async (t) => {
  const base = tempRoot(t, "crew-chief-parent-")
  const spool = path.join(base, "spool")
  const pinned = path.join(base, "pinned")
  fs.mkdirSync(spool)

  const child = spawn(helper, ["write", spool, "safe"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CREW_CHIEF_TEST_PARENT_DELAY_MS: "500" }
  })
  child.stdin.end(row("safe"))
  await new Promise(resolve => setTimeout(resolve, 150))
  fs.renameSync(spool, pinned)
  fs.mkdirSync(spool)

  const status = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })
  assert.equal(status, 0)
  assert.equal(fs.existsSync(path.join(pinned, "safe.json")), true)
  assert.equal(fs.existsSync(path.join(spool, "safe.json")), false)
})

test("FIFO and oversized records cannot hang or enter the bounded list", (t) => {
  const base = tempRoot(t, "crew-chief-fifo-")
  const spool = path.join(base, "spool")
  fs.mkdirSync(spool)
  execFileSync("mkfifo", [path.join(spool, "pipe.json")])
  fs.writeFileSync(path.join(spool, "huge.json"), "x".repeat(5000))
  assert.equal(run("write", spool, "normal", row("normal")).status, 0)

  const result = run("list", spool)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"id":"normal"/)
  assert.doesNotMatch(result.stdout, /pipe|huge/)
})

test("concurrent writers serialize and publish only complete JSON records", async (t) => {
  const base = tempRoot(t, "crew-chief-concurrent-")
  const spool = path.join(base, "spool")
  const children = []
  for (let i = 0; i < 24; i++) {
    const id = `s${i}`
    const child = spawn(helper, ["write", spool, id], { stdio: ["pipe", "ignore", "pipe"] })
    child.stdin.end(row(id, i % 3 === 0 ? "needs_you" : "working", Date.now() + i))
    children.push(child)
  }
  const statuses = await Promise.all(children.map(child => new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })))
  assert.deepEqual(new Set(statuses), new Set([0]))
  const records = fs.readdirSync(spool).filter(name => name.endsWith(".json"))
  assert.equal(records.length, 24)
  for (const name of records) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(spool, name))))
})

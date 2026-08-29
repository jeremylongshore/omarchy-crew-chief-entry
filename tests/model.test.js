const test = require("node:test")
const assert = require("node:assert/strict")
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { spawnSync } = require("node:child_process")

const Model = require("../Model.js")

const NOW = 1_766_200_000_000

const spool = [
  JSON.stringify({ id: "aaa", state: "working", cwd: "/home/dev/projects/payments-api", message: "", ts: NOW - 30_000 }),
  JSON.stringify({ id: "bbb", state: "needs_you", cwd: "/home/dev/projects/marketing-site", message: "Claude needs your permission to use Bash", ts: NOW - 300_000 }),
  JSON.stringify({ id: "ccc", state: "done", cwd: "/home/dev/projects/blog/", message: "", ts: NOW - 120_000 }),
  JSON.stringify({ id: "ddd", state: "needs_you", cwd: "/srv/x", message: "waiting for input", ts: NOW - 60_000 }),
  "not json at all",
  JSON.stringify({ nope: true }),
  ""
].join("\n")

test("parseSpool reads one session per line and drops garbage", () => {
  const sessions = Model.parseSpool(spool)
  assert.equal(sessions.length, 4)
  assert.deepEqual(sessions.map((s) => s.id), ["aaa", "bbb", "ccc", "ddd"])
  assert.equal(sessions[1].project, "marketing-site")
  assert.equal(sessions[2].project, "blog") // trailing slash trimmed
  assert.equal(sessions[1].message, "Claude needs your permission to use Bash")
})

test("parseSpool defaults unknown states to working and tolerates junk input", () => {
  const rows = Model.parseSpool(JSON.stringify({ id: "x", state: "wat", cwd: "", ts: 5 }))
  assert.equal(rows[0].state, "working")
  assert.deepEqual(Model.parseSpool(""), [])
  assert.deepEqual(Model.parseSpool(null), [])
})

test("parseSpool survives glued objects with no newline between them", () => {
  const glued =
    JSON.stringify({ id: "x1", state: "needs_you", cwd: "/p/alpha", message: "has {braces} \"and\\\" quotes", ts: NOW }) +
    JSON.stringify({ id: "x2", state: "working", cwd: "/p/beta", message: "", ts: NOW }) +
    "\n" +
    JSON.stringify({ id: "x3", state: "done", cwd: "/p/gamma", message: "", ts: NOW })
  const sessions = Model.parseSpool(glued)
  assert.deepEqual(sessions.map((s) => s.id), ["x1", "x2", "x3"])
  assert.equal(sessions[0].message, 'has {braces} "and\\" quotes')
})

test("splitJsonObjects handles noise around and between objects", () => {
  assert.deepEqual(Model.splitJsonObjects('junk {"a":1} mid {"b":"}{"} end'), ['{"a":1}', '{"b":"}{"}'])
  assert.deepEqual(Model.splitJsonObjects(""), [])
  assert.deepEqual(Model.splitJsonObjects("}}}"), [])
})

test("projectName takes the last path segment", () => {
  assert.equal(Model.projectName("/a/b/c"), "c")
  assert.equal(Model.projectName("/a/b/c///"), "c")
  assert.equal(Model.projectName(""), "")
})

test("focusTarget retains literal punctuation but rejects control characters", () => {
  assert.equal(Model.focusTarget("repo'; touch /tmp/nope; #"), "repo'; touch /tmp/nope; #")
  assert.equal(Model.focusTarget("  spaced repo  "), "spaced repo")
  assert.equal(Model.focusTarget("bad\nselector"), "")
  assert.equal(Model.focusTarget(""), "")
})

test("bounded spool reader accepts an apostrophe in its directory as argv", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew chief's spool-"))
  try {
    writeFileSync(join(dir, "safe.json"), JSON.stringify({ id: "safe", state: "working" }))
    const result = spawnSync(join(__dirname, "..", "bin", "read-spool"), [dir, ""], {
      encoding: "utf8"
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /"__spoolTotal":1/)
    assert.match(result.stdout, /"id":"safe"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("liveSessions drops stale entries", () => {
  const sessions = Model.parseSpool(spool)
  const live = Model.liveSessions(sessions, NOW, 240_000)
  assert.deepEqual(live.map((s) => s.id), ["aaa", "ccc", "ddd"])
  assert.equal(Model.liveSessions(sessions, NOW, 3_600_000).length, 4)
})

test("sortSessions puts oldest attention first, then working, then done", () => {
  const sorted = Model.sortSessions(Model.parseSpool(spool))
  assert.deepEqual(sorted.map((s) => s.id), ["bbb", "ddd", "aaa", "ccc"])
})

test("summarize counts states", () => {
  const s = Model.summarize(Model.parseSpool(spool))
  assert.deepEqual(s, { total: 4, needs: 2, working: 1, done: 1 })
})

test("pillText escalates: silent, count, done, needs-you", () => {
  assert.equal(Model.pillText({ total: 0, needs: 0, working: 0, done: 0 }), "")
  assert.equal(Model.pillText(null), "")
  assert.equal(Model.pillText({ total: 3, needs: 0, working: 3, done: 0 }), "3")
  assert.equal(Model.pillText({ total: 2, needs: 0, working: 0, done: 2 }), "2 done")
  assert.equal(Model.pillText({ total: 4, needs: 1, working: 3, done: 0 }), "1 needs you")
  assert.equal(Model.pillText({ total: 4, needs: 2, working: 2, done: 0 }), "2 need you")
})

test("stateLabel and ageText render row chrome", () => {
  assert.equal(Model.stateLabel("needs_you"), "NEEDS YOU")
  assert.equal(Model.stateLabel("done"), "DONE")
  assert.equal(Model.stateLabel("working"), "WORKING")
  assert.equal(Model.ageText(NOW - 10_000, NOW), "now")
  assert.equal(Model.ageText(NOW - 3 * 60_000, NOW), "3m")
  assert.equal(Model.ageText(NOW - 2 * 3_600_000, NOW), "2h")
  assert.equal(Model.ageText(NOW - 30 * 3_600_000, NOW), "1d")
})

// ------------------------------------------------------ spool bounds (1436)

test("parseSpool caps the number of sessions it will build", () => {
  // The spool is written by AGENTS. This plugin advertises that anything able
  // to run a command may write to it, so its size is not under the widget's
  // control, and the widget lives in a long-running shell that must never grow
  // without limit. Reported against submission 1436.
  const many = Array.from({ length: 500 }, (_, i) =>
    JSON.stringify({ id: "s" + i, state: "working", cwd: "/p", ts: 1 })).join("\n")
  const rows = Model.parseSpool(many)
  assert.equal(rows.length, Model.MAX_SESSIONS)
  assert.equal(Model.spoolTruncated(), true)
})

test("parseSpool caps total input characters", () => {
  const one = JSON.stringify({ id: "a", state: "working", cwd: "/x", ts: 1 }) + "\n"
  const huge = one.repeat(200000)
  assert.ok(huge.length > Model.MAX_SPOOL_CHARS)
  const rows = Model.parseSpool(huge)
  assert.ok(rows.length <= Model.MAX_SESSIONS)
  assert.equal(Model.spoolTruncated(), true)
})

test("a normal spool is not reported as truncated", () => {
  // The flag must mean something, so it has to be false in the common case.
  const few = Array.from({ length: 3 }, (_, i) =>
    JSON.stringify({ id: "s" + i, state: "working", cwd: "/p", ts: 1 })).join("\n")
  assert.equal(Model.parseSpool(few).length, 3)
  assert.equal(Model.spoolTruncated(), false)
})

test("the spool bounds are consistent with each other", () => {
  assert.equal(Model.MAX_SPOOL_CHARS, Model.MAX_SPOOL_FILES * Model.MAX_FILE_BYTES)
  for (const n of [Model.MAX_SPOOL_FILES, Model.MAX_FILE_BYTES, Model.MAX_SESSIONS]) {
    assert.ok(Number.isInteger(n) && n > 0)
  }
})

test("parseSpool survives a mid-file truncation without leaking garbage", () => {
  // head -c cuts mid-file, so a partial JSON line reaching the parser is the
  // NORMAL case under the new bounds rather than an edge case.
  const partial = '{"id":"a","state":"working","cwd":"/x","ts":1}\n{"id":"b","st'
  const rows = Model.parseSpool(partial)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "a")
  for (const bad of ["", null, undefined, "not json", "  "]) {
    assert.ok(Array.isArray(Model.parseSpool(bad)))
  }
})

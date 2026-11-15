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
  assert.deepEqual(Model.splitJsonObjects(null), [])
  assert.deepEqual(Model.splitJsonObjects("}}}"), [])
  assert.deepEqual(Model.splitJsonObjects('}{"a":{"b":2}}{'), ['{"a":{"b":2}}'])
  assert.deepEqual(Model.splitJsonObjects('{"a":"escaped \\\" quote and \\\\ slash"}'), ['{"a":"escaped \\\" quote and \\\\ slash"}'])
  assert.deepEqual(Model.splitJsonObjects('{"unfinished":true'), [])
})

test("projectName takes the last path segment", () => {
  assert.equal(Model.projectName("/a/b/c"), "c")
  assert.equal(Model.projectName("/a/b/c///"), "c")
  assert.equal(Model.projectName(""), "")
  assert.equal(Model.projectName(null), "")
  assert.equal(Model.projectName("/"), "")
})

test("focusTarget retains literal punctuation but rejects control characters", () => {
  assert.equal(Model.focusTarget("repo'; touch /tmp/nope; #"), "repo'; touch /tmp/nope; #")
  assert.equal(Model.focusTarget("  spaced repo  "), "spaced repo")
  assert.equal(Model.focusTarget("bad\nselector"), "")
  assert.equal(Model.focusTarget(""), "")
  assert.equal(Model.focusTarget(null), "")
  assert.equal(Model.focusTarget("x".repeat(121)), "x".repeat(120))
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
  assert.deepEqual(Model.liveSessions([{ id: "edge", ts: NOW - 10 }], NOW, 10).map((s) => s.id), ["edge"])
})

test("sortSessions puts oldest attention first, then working, then done", () => {
  const sorted = Model.sortSessions(Model.parseSpool(spool))
  assert.deepEqual(sorted.map((s) => s.id), ["bbb", "ddd", "aaa", "ccc"])
  const working = Model.sortSessions([
    { id: "older", state: "working", ts: 1 },
    { id: "newer", state: "working", ts: 2 }
  ])
  assert.deepEqual(working.map((s) => s.id), ["newer", "older"])
  const waiting = Model.sortSessions([
    { id: "new-wait", state: "needs_you", ts: 9 },
    { id: "old-wait", state: "needs_you", ts: 1 },
    { id: "done", state: "done", ts: 20 }
  ])
  assert.deepEqual(waiting.map((s) => s.id), ["old-wait", "new-wait", "done"])
})

test("summarize counts states", () => {
  const s = Model.summarize(Model.parseSpool(spool))
  assert.deepEqual(s, { total: 4, needs: 2, working: 1, done: 1 })
  assert.deepEqual(Model.summarize([{ state: "unknown" }, { state: "done" }]), {
    total: 2, needs: 0, working: 1, done: 1
  })
})

test("pillText escalates: silent, count, done, needs-you", () => {
  assert.equal(Model.pillText({ total: 0, needs: 0, working: 0, done: 0 }), "")
  assert.equal(Model.pillText(null), "")
  assert.equal(Model.pillText({ total: 3, needs: 0, working: 3, done: 0 }), "3")
  assert.equal(Model.pillText({ total: 2, needs: 0, working: 0, done: 2 }), "2 done")
  assert.equal(Model.pillText({ total: 4, needs: 1, working: 3, done: 0 }), "1 needs you")
  assert.equal(Model.pillText({ total: 4, needs: 2, working: 2, done: 0 }), "2 need you")
  assert.equal(Model.pillText({ total: 3, needs: 0, working: 1, done: 2 }), "3")
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

test("parseSpool preserves exact limits and normalizes every public field", () => {
  const exact = Array.from({ length: Model.MAX_SESSIONS }, (_, i) =>
    JSON.stringify({ id: i + 1, state: "working", cwd: null, agent: null, message: null, ts: "bad" })).join("\n")
  const rows = Model.parseSpool(exact)
  assert.equal(rows.length, Model.MAX_SESSIONS)
  assert.equal(Model.spoolTruncated(), false)
  assert.deepEqual(rows[0], {
    id: "1", state: "working", cwd: "", project: "", agent: "", message: "", window: "", ts: 0
  })
})

test("parseSpool rejects non-records and invalid records without poisoning later rows", () => {
  const raw = [
    "null", "[]", "42", '"text"', '{"id":""}', '{"id":"ok","state":"done","cwd":"/p/ok","ts":7}'
  ].join("\n")
  assert.deepEqual(Model.parseSpool(raw).map((r) => r.id), ["ok"])
})

test("spool census accepts whitespace and multi-digit totals, and resets between parses", () => {
  const row = '{"id":"one","state":"working","ts":1}'
  assert.equal(Model.spoolCensus('{"__spoolTotal":   123}'), 123)
  assert.equal(Model.spoolCensus(null), -1)
  Model.parseSpool('{"__spoolTotal":123}\n' + row)
  assert.equal(Model.spoolTotal(), 123)
  assert.equal(Model.spoolTruncated(), true)
  Model.parseSpool(row)
  assert.equal(Model.spoolTotal(), 0)
  assert.equal(Model.spoolTruncated(), false)
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
  assert.equal(Model.spoolTotal(), 0)
  Model.parseSpool('{"__spoolTotal":9}\n' + few)
  assert.equal(Model.spoolTotal(), 9)
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

test("windowAddress keeps only hyprctl-style window addresses", () => {
  assert.equal(Model.windowAddress("0x55d3c2a1b2c0"), "0x55d3c2a1b2c0")
  assert.equal(Model.windowAddress("0xABCDEF"), "0xABCDEF")
  assert.equal(Model.windowAddress("0x"), "")
  assert.equal(Model.windowAddress("0x" + "f".repeat(17)), "")
  assert.equal(Model.windowAddress("55d3c2a1b2c0"), "")
  assert.equal(Model.windowAddress("0x12; rm -rf ~"), "")
  assert.equal(Model.windowAddress(" 0x12"), "")
  assert.equal(Model.windowAddress(null), "")
  assert.equal(Model.windowAddress(["0xabc"]), "")
  assert.equal(Model.windowAddress({ toString: () => "0xabc" }), "")
  assert.equal(Model.windowAddress(0xabc), "")
})

test("parseSpool carries a recorded window and drops a forged one", () => {
  const rows = Model.parseSpool([
    JSON.stringify({ id: "a", state: "working", cwd: "/p/one", ts: NOW, window: "0xabc123" }),
    JSON.stringify({ id: "b", state: "working", cwd: "/p/two", ts: NOW, window: "title:evil" }),
    JSON.stringify({ id: "c", state: "working", cwd: "/p/three", ts: NOW })
  ].join("\n"))
  assert.deepEqual(rows.map((r) => r.window), ["0xabc123", "", ""])
})

// Decode a Lua string literal the way Lua does for the escapes luaString emits.
function luaDecode(literal) {
  assert.ok(literal.startsWith('"') && literal.endsWith('"'))
  const body = literal.slice(1, -1)
  assert.doesNotMatch(body, /"/)
  const bytes = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") {
      assert.match(body.slice(i + 1, i + 4), /^\d{3}$/)
      bytes.push(Number(body.slice(i + 1, i + 4)))
      i += 3
    } else bytes.push(body.charCodeAt(i))
  }
  return Buffer.from(bytes).toString("utf8")
}

test("focusSelectors prefers the recorded window, then the title, then nothing", () => {
  assert.deepEqual(Model.focusSelectors({ window: "0xabc123", project: "repo" }), ["address:0xabc123", "title:repo"])
  assert.deepEqual(Model.focusSelectors({ window: "", project: "repo" }), ["title:repo"])
  assert.deepEqual(Model.focusSelectors({ window: "not-an-address", project: "repo" }), ["title:repo"])
  assert.deepEqual(Model.focusSelectors({ window: "0xabc123", project: "" }), ["address:0xabc123"])
  assert.deepEqual(Model.focusSelectors({ window: "", project: "bad\nselector" }), [])
  assert.deepEqual(Model.focusSelectors(null), [])
})

test("focusArgv builds the Lua and classic dispatch forms as one argv each", () => {
  assert.deepEqual(Model.focusArgv("address:0xabc", "lua"),
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "address:0xabc" })'])
  assert.deepEqual(Model.focusArgv("address:0xabc", "classic"),
    ["hyprctl", "dispatch", "focuswindow", "address:0xabc"])
})

test("focusAttempts tries each selector in Lua form, then classic form", () => {
  assert.deepEqual(Model.focusAttempts({ window: "0xabc", project: "web" }), [
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "address:0xabc" })'],
    ["hyprctl", "dispatch", "focuswindow", "address:0xabc"],
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "title:web" })'],
    ["hyprctl", "dispatch", "focuswindow", "title:web"]
  ])
  assert.deepEqual(Model.focusAttempts({ window: "", project: "" }), [])
})

test("luaString cannot be broken out of, and decodes back to the exact text", () => {
  for (const text of [
    'repo"]) os.execute("touch /tmp/pwned") --',
    "back\\slash", "brackets]]==]", "accent é and emoji 😀", "digits after escape \"1", "!'()*~", "plain repo-name_1.0"
  ]) {
    const literal = Model.luaString(text)
    assert.equal(luaDecode(literal), text, text)
    assert.doesNotMatch(literal.slice(1, -1), /["\]()\n]/)
  }
  assert.equal(Model.luaString("title:plain repo-1.0"), '"title:plain repo-1.0"')
  assert.equal(Model.luaString(""), '""')
  assert.equal(Model.luaString(null), '""')
  assert.equal(Model.luaString("\uD800"), '""')
})

test("luaString pads every escape to three digits and handles surrogate edges", () => {
  assert.equal(Model.luaString("a\tb"), '"a\\009b"')
  assert.equal(Model.luaString("a\nb"), '"a\\010b"')
  assert.equal(Model.luaString("a\nb").length, '"a\\010b"'.length)
  for (const text of ["\t1", "\n1", "\u{10000}", "\u{10FFFF}", "x\u{10000}y"]) {
    assert.equal(luaDecode(Model.luaString(text)), text, JSON.stringify(text))
  }
  assert.equal(Model.luaString("\uDC00a"), '"a"')
  assert.equal(Model.luaString("x\uD800"), '"x"')
})

test("focusSucceeded is true only when hyprctl reports ok", () => {
  assert.equal(Model.focusSucceeded("ok\n"), true)
  assert.equal(Model.focusSucceeded("  ok  "), true)
  assert.equal(Model.focusSucceeded("No such window found"), false)
  assert.equal(Model.focusSucceeded("okay"), false)
  assert.equal(Model.focusSucceeded(""), false)
  assert.equal(Model.focusSucceeded(undefined), false)
})

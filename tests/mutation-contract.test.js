const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const Model = require("../Model.js")

test("the public Crew Chief model has a deterministic behavioral signature", () => {
  const now = 1_800_000_000_000
  const raw = [
    '{"__spoolTotal":4}',
    JSON.stringify({ id: "a", state: "working", cwd: "/p/api", agent: "codex", message: "", ts: now - 1000 }),
    JSON.stringify({ id: "b", state: "needs_you", cwd: "/p/web", agent: "claude", message: "approve", ts: now - 5000 }),
    JSON.stringify({ id: "c", state: "done", cwd: "/p/docs", agent: "goose", message: "", ts: now - 2000 })
  ].join("\n")
  const rows = Model.parseSpool(raw)
  const signature = {
    constants: [Model.MAX_SPOOL_FILES, Model.MAX_FILE_BYTES, Model.MAX_SPOOL_CHARS, Model.MAX_SESSIONS],
    rows,
    total: Model.spoolTotal(),
    truncated: Model.spoolTruncated(),
    live: Model.liveSessions(rows, now, 4000).map(r => r.id),
    sorted: Model.sortSessions(rows).map(r => r.id),
    summary: Model.summarize(rows),
    pills: [
      Model.pillText({ total: 0, needs: 0, working: 0, done: 0 }),
      Model.pillText({ total: 3, needs: 1, working: 1, done: 1 }),
      Model.pillText({ total: 2, needs: 0, working: 0, done: 2 })
    ],
    labels: ["needs_you", "working", "done", "unknown"].map(Model.stateLabel),
    ages: [0, 60000, 3600000, 86400000].map(delta => Model.ageText(now - delta, now)),
    project: Model.projectName("/p/demo///"),
    focus: Model.focusTarget(" demo repo ")
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(signature)).digest("hex")
  assert.equal(digest, "0eafaad062c7cf4f39d04b48d9a19cefda9d0fe822de11140ace20123cf7d61e")
})

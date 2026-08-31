const test = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { join } = require("node:path")

const root = join(__dirname, "..")
const text = (path) => readFileSync(join(root, path), "utf8")
const manifest = JSON.parse(text("manifest.json"))

test("marketplace descriptions use the complete 500-character allowance", () => {
  assert.equal(manifest.description.length, 500)
  assert.equal(manifest.barWidget.description.length, 500)
  assert.equal(manifest.barWidget.description, manifest.description)
  for (const claim of [
    "local attention queue", "Claude Code, Codex, Herdr", "working, blocked, or done",
    "bar hides when idle", "alert color for NEEDS YOU", "sorts blocked rows first",
    "bounded attention headline", "best-effort focus its project window",
    "No network, account, API key, telemetry, or transcript polling"
  ]) assert.match(manifest.description, new RegExp(claim))
})

test("manifest identity and version are release-specific", () => {
  assert.equal(manifest.id, "io.github.jeremylongshore.crew-chief")
  assert.equal(manifest.name, "Crew Chief")
  assert.equal(manifest.version, "1.1.0")
  assert.deepEqual(manifest.kinds, ["bar-widget"])
})

test("the banner is a Crew Chief story rather than a generic initials tile", () => {
  const banner = text("assets/banner.svg")
  assert.match(banner, /aria-label="Crew Chief:/)
  assert.match(banner, />CREW CHIEF</)
  assert.match(banner, /NEEDS YOU/)
  assert.match(banner, /payments-api/)
  assert.match(banner, /#4ade80/)
})

test("all state lifecycle paths use the descriptor-bound helper", () => {
  for (const path of ["hooks/crew-chief-event", "adapters/codex-notify", "adapters/herdr-sync", "bin/crew-chief-report", "bin/read-spool"]) {
    const source = text(path)
    assert.match(source, /crew-chief-spool/, path)
    assert.doesNotMatch(source, /\b(?:rm|find|sort|cat)\b.*crew-chief/, path)
  }
  const panel = text("Panel.qml")
  assert.match(panel, /spoolHelperPath/)
  assert.match(panel, /\[spoolHelperPath, "remove", spoolDir/)
  assert.doesNotMatch(panel, /command:\s*\["(?:rm|bash|sh)"/)
})

test("the spool helper pins identities and hard-bounds all work", () => {
  const helper = text("bin/crew-chief-spool")
  for (const token of ["O_NOFOLLOW", "O_EXCL", "O_NONBLOCK", "flock", "MAX_FILE_BYTES", "MAX_FILES", "MAX_CENSUS", "MAX_RETAINED"]) {
    assert.ok(helper.includes(token), token)
  }
})

test("presentation proof is fail-closed and hash-bound", () => {
  const gate = text("scripts/gates/c43-omarchy-marketplace-presentation.sh")
  for (const token of ["500", "1280", "720", "visualInspection", "previewSha256", "sourceDirty"]) {
    assert.ok(gate.includes(token), token)
  }
  assert.match(text("scripts/approve-preview.sh"), /sha256sum/)
})

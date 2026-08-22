// Crew Chief data layer: pure parse/shape functions over the spool the
// Claude Code hook writes. No QML or filesystem access — the same file loads
// in Quickshell (`import "Model.js" as Model`) and in node for the unit suite.

var STATE_ORDER = { needs_you: 0, working: 1, done: 2 }

// The spool is cat'd whole — normally one compact JSON object per line, but
// a writer that skips the trailing newline glues objects together, so walk
// the stream by brace depth (string-aware) instead of trusting line breaks.
function splitJsonObjects(raw) {
  var text = String(raw || "")
  var objects = []
  var depth = 0
  var start = -1
  var inString = false
  var escaped = false
  for (var i = 0; i < text.length; i++) {
    var ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1))
        start = -1
      } else if (depth < 0) {
        depth = 0
      }
    }
  }
  return objects
}

// Unparseable chunks are dropped, never fatal.
// Hard bounds on everything that enters from the spool.
//
// The spool is written by AGENTS, not by this plugin: any harness that can run a
// command can drop a file in it, and Crew Chief advertises exactly that as a
// feature. So its size is attacker-or-bug controlled, and this widget lives
// inside a long-running shell process that must never grow without limit.
//
// Reported against submission 1436: Panel.qml cat'd every spool file into a
// StdioCollector every few seconds with no file-count or byte bound.
//
// 64 concurrent agent sessions is already an absurd fleet, and one session
// record is a single compact JSON line, so 4 KB each is generous. The two
// numbers multiply to the character cap, and the cap is enforced HERE as well
// as in the shell command, because a bound that exists in only one layer is a
// bound that a refactor can delete by accident.
var MAX_SPOOL_FILES = 64
var MAX_FILE_BYTES = 4096
var MAX_SPOOL_CHARS = MAX_SPOOL_FILES * MAX_FILE_BYTES
var MAX_SESSIONS = 64

// True when the last parse hit a limit, so the panel can say so rather than
// silently showing a partial fleet.
//
// Declared as a top-level function, NOT as an anonymous one attached to
// module.exports. QML's `import "Model.js" as Model` exposes top-level function
// declarations and top-level vars; it does not evaluate module.exports, which
// only exists for node. An exports-only definition therefore passes every
// offline test and then throws "Property is not a function" inside the shell,
// which is exactly what happened here and what the rig render caught.
var lastParseTruncated = false
var lastSpoolTotal = 0

function spoolTruncated() {
  return lastParseTruncated
}

// How many spool files exist, from the census, so the panel can say how many it
// is NOT showing rather than only that it is showing some.
function spoolTotal() {
  return lastSpoolTotal
}

// The reader emits a census line before the records: {"__spoolTotal":N}, the
// number of files that EXIST, not the number it read.
//
// Without it the truncation notice could never fire in practice. The bound that
// actually bites is the shell one (newest N files), and the parser cannot see
// what the shell chose not to send: under a 401-file flood the parser received
// 64 well-formed chunks, decided nothing had been dropped, and the panel
// cheerfully reported a complete fleet that was missing 337 sessions. A UI
// claim that can never fire is worse than no claim.
function spoolCensus(text) {
  var m = /\{"__spoolTotal":\s*(\d+)\}/.exec(String(text || ""))
  return m ? parseInt(m[1], 10) : -1
}

function parseSpool(raw) {
  lastParseTruncated = false
  var text = String(raw || "")
  var total = spoolCensus(text)
  lastSpoolTotal = total > 0 ? total : 0
  if (text.length > MAX_SPOOL_CHARS) {
    text = text.slice(0, MAX_SPOOL_CHARS)
    lastParseTruncated = true
  }
  var chunks = splitJsonObjects(text)
  if (chunks.length > MAX_SESSIONS) {
    chunks = chunks.slice(0, MAX_SESSIONS)
    lastParseTruncated = true
  }
  var sessions = []
  for (var i = 0; i < chunks.length; i++) {
    var row
    try { row = JSON.parse(chunks[i]) } catch (e) { continue }
    if (!row || typeof row !== "object" || !row.id) continue
    var cwd = String(row.cwd || "")
    sessions.push({
      id: String(row.id),
      state: STATE_ORDER[row.state] !== undefined ? row.state : "working",
      cwd: cwd,
      project: projectName(cwd),
      agent: String(row.agent || ""),
      message: String(row.message || ""),
      ts: Number(row.ts) || 0
    })
  }
  // The census counts FILES that exist; a valid session is one file, so a
  // census above what we built means the reader dropped some.
  if (total > sessions.length) lastParseTruncated = true
  return sessions
}

// Last path segment reads as the project; fall back to a short session id so
// a row is never blank.
function projectName(cwd) {
  var trimmed = String(cwd || "").replace(/\/+$/, "")
  if (!trimmed) return ""
  var parts = trimmed.split("/")
  return parts[parts.length - 1] || ""
}

// Sessions with no event inside staleMs are treated as gone (crashed shell,
// old machine boot) and dropped from every surface.
function liveSessions(sessions, nowMs, staleMs) {
  var out = []
  for (var i = 0; i < sessions.length; i++) {
    if (nowMs - sessions[i].ts <= staleMs) out.push(sessions[i])
  }
  return out
}

// Attention first (oldest waiting at the top — they've waited longest),
// then working, then done; ties break on recency.
function sortSessions(sessions) {
  var copy = sessions.slice()
  copy.sort(function(a, b) {
    var byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (byState !== 0) return byState
    if (a.state === "needs_you") return a.ts - b.ts
    return b.ts - a.ts
  })
  return copy
}

function summarize(sessions) {
  var s = { total: sessions.length, needs: 0, working: 0, done: 0 }
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].state === "needs_you") s.needs++
    else if (sessions[i].state === "done") s.done++
    else s.working++
  }
  return s
}

// Bar pill: silent with no sessions; "N" agents running; needs-attention
// count takes over the pill when someone is blocked on you.
function pillText(summary) {
  if (!summary || summary.total === 0) return ""
  if (summary.needs > 0) return summary.needs + " need" + (summary.needs === 1 ? "s" : "") + " you"
  if (summary.done > 0 && summary.working === 0) return summary.done + " done"
  return String(summary.total)
}

function stateLabel(state) {
  if (state === "needs_you") return "NEEDS YOU"
  if (state === "done") return "DONE"
  return "WORKING"
}

// Compact age: "now", "3m", "2h", "1d".
function ageText(ts, nowMs) {
  var delta = Math.max(0, nowMs - ts)
  if (delta < 60000) return "now"
  var minutes = Math.floor(delta / 60000)
  if (minutes < 60) return minutes + "m"
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h"
  return Math.floor(hours / 24) + "d"
}

if (typeof module !== "undefined") {
  module.exports = {
    splitJsonObjects: splitJsonObjects,
    MAX_SPOOL_FILES: MAX_SPOOL_FILES,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_SPOOL_CHARS: MAX_SPOOL_CHARS,
    MAX_SESSIONS: MAX_SESSIONS,
    spoolTruncated: spoolTruncated,
    spoolCensus: spoolCensus,
    spoolTotal: spoolTotal,
    parseSpool: parseSpool,
    projectName: projectName,
    liveSessions: liveSessions,
    sortSessions: sortSessions,
    summarize: summarize,
    pillText: pillText,
    stateLabel: stateLabel,
    ageText: ageText
  }
}

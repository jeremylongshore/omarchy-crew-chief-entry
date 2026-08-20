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
function parseSpool(raw) {
  var chunks = splitJsonObjects(raw)
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

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
      window: windowAddress(row.window),
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

// `focuswindow title:` is passed to hyprctl as one process argument. Keep
// control characters out of that selector and cap an untrusted hook label to
// the same fixed-width intent as the UI; punctuation is deliberately allowed
// because argv transport makes it data rather than shell syntax.
function focusTarget(project) {
  var value = String(project || "").trim()
  if (!value || /[\x00-\x1F\x7F]/.test(value)) return ""
  return value.slice(0, 120)
}

// A Hyprland window address exactly as `hyprctl clients -j` prints it
// ("0x55d3c2a1b2c0"), or "" for anything else, including a non-string. The
// value comes from whoever wrote the spool record, so it is checked here
// before it reaches hyprctl.
function windowAddress(value) {
  if (typeof value !== "string") return ""
  return /^0x[0-9a-fA-F]{1,16}$/.test(value) ? value : ""
}

// Window selectors to try for one session, best first. The address the
// session's own reporter recorded names the exact terminal window. The title
// match is the fallback for reporters that could not see a window, and it only
// works while the terminal title still contains the project folder (issue #7:
// Claude Code renames its terminal to the current task).
function focusSelectors(session) {
  if (!session) return []
  var out = []
  var address = windowAddress(session.window)
  if (address) out.push("address:" + address)
  var target = focusTarget(session.project)
  if (target) out.push("title:" + target)
  return out
}

function pad3(n) {
  return n < 10 ? "00" + n : (n < 100 ? "0" + n : String(n))
}

// A Lua string literal for text that Hyprland evaluates as Lua. Every byte
// outside a plain safe set becomes a three-digit \ddd escape, so a project name
// can never close the string and inject code the compositor would run.
function luaString(text) {
  var value = String(text || "")
  var out = ""
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i)
    if (/[A-Za-z0-9 ._:-]/.test(ch)) { out += ch; continue }
    var chunk = ch
    var code = value.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
      chunk = value.substr(i, 2)
      i++
    }
    var encoded
    try { encoded = encodeURIComponent(chunk) } catch (e) { continue }
    if (encoded === chunk) { out += "\\" + pad3(chunk.charCodeAt(0)); continue }
    var bytes = encoded.split("%")
    for (var j = 1; j < bytes.length; j++) out += "\\" + pad3(parseInt(bytes[j], 16))
  }
  return '"' + out + '"'
}

// The hyprctl argv for one focus attempt. Hyprland 0.57 and later, which
// current Omarchy configures in Lua, takes `hl.dsp.focus({ window = ... })`;
// earlier releases take `focuswindow <selector>`. Each argv is one process
// argument list, so nothing passes through a shell.
function focusArgv(selector, style) {
  if (style === "classic") return ["hyprctl", "dispatch", "focuswindow", selector]
  return ["hyprctl", "dispatch", "hl.dsp.focus({ window = " + luaString(selector) + " })"]
}

// Every attempt a row click may make, in order: each selector in the Lua form,
// then the classic form, the same order Omarchy's own launch-or-focus scripts
// use. The panel runs them until hyprctl reports ok.
function focusAttempts(session) {
  var selectors = focusSelectors(session)
  var out = []
  for (var i = 0; i < selectors.length; i++) {
    out.push(focusArgv(selectors[i], "lua"))
    out.push(focusArgv(selectors[i], "classic"))
  }
  return out
}

// `hyprctl dispatch` prints "ok" when it acted. On Hyprland 0.57 a window that
// is not found prints an error instead, as does a dispatch form the running
// Hyprland does not understand, so the panel moves on to the next attempt.
function focusSucceeded(output) {
  return String(output || "").trim() === "ok"
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
    focusTarget: focusTarget,
    windowAddress: windowAddress,
    focusSelectors: focusSelectors,
    luaString: luaString,
    focusArgv: focusArgv,
    focusAttempts: focusAttempts,
    focusSucceeded: focusSucceeded,
    liveSessions: liveSessions,
    sortSessions: sortSessions,
    summarize: summarize,
    pillText: pillText,
    stateLabel: stateLabel,
    ageText: ageText
  }
}

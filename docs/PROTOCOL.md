# The Crew Chief spool protocol (v1)

Crew Chief is harness-agnostic by design. The widget never talks to any agent tool.
it watches a spool directory of tiny JSON files, one per session. **Anything that can
run a command or write a file can appear in the fleet.**

## The contract

- Spool directory: `~/.local/state/omarchy/crew-chief/` (override with `$CREW_CHIEF_SPOOL`)
- One file per session: `<session-id>.json`, where the id matches `[A-Za-z0-9._-]+`
- Content: one compact JSON object:

```json
{
  "id": "abc123",
  "state": "working",
  "cwd": "/home/dev/projects/payments-api",
  "agent": "goose",
  "message": "",
  "ts": 1766200000000
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable per session. File name must be `<id>.json` |
| `state` | yes | `working`, `needs_you`, or `done`. Unknown values render as `working` |
| `cwd` | no | Project directory; the last path segment becomes the row label |
| `agent` | no | Harness name (`claude-code`, `codex`, `goose`, `kilo`, `pi`, `hermes`, ...) shown dimmed on the row |
| `message` | no | One-line reason shown under a `needs_you` row (the blocking prompt) |
| `ts` | yes | Unix epoch **milliseconds** of the last event. Rows stale for 4h (configurable) drop off |

- Write atomically (temp file + `mv`) so the watcher never reads a torn write.
- Session over → **delete the file**.
- The widget polls every 3s (configurable) and tolerates missing newlines,
  garbage files, and unknown fields.

## The easy way: `crew-chief-report`

`bin/crew-chief-report` implements the contract in one command:

```bash
crew-chief-report working   --agent goose
crew-chief-report needs_you --agent kilo --message "waiting on approval"
crew-chief-report done      --agent codex
crew-chief-report end
```

Ids default to the parent PID (stable for the harness process lifetime), so most
integrations need zero plumbing: just call it from whatever event surface your harness
has: hooks, notify programs, wrappers, extensions.

## Semantics

- `needs_you`: the agent is blocked on a human: permission prompt, approval, question.
- `working`: running; nothing needed.
- `done`: the agent finished its turn/run; the ball is in your court.
- States are last-writer-wins per session; there is no ordering requirement beyond `ts`.

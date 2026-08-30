# Security

## Threat model

Crew Chief renders lifecycle reports created by local coding-agent harnesses.
Those records are local, but they are not trusted: a buggy reporter, another
same-user process, a hostile file, or an oversized fleet must not make the
long-running Omarchy shell execute data, follow links, block on a FIFO, race a
path replacement, or grow without limit.

The optional `message` field is persisted locally and shown in the panel.
Reporters must send a short status headline only. They must not place prompts,
transcript excerpts, credentials, customer data, or other secrets in it.

## State controls

All state operations go through `bin/crew-chief-spool`:

- the absolute spool path is pinned one directory at a time with
  `O_DIRECTORY|O_NOFOLLOW`; the final directory must be owned by the current
  user and mode `0700`;
- the same-owner regular lock file is opened with `O_NOFOLLOW|O_NONBLOCK` and
  protected by `flock`, so writers, readers, pruning, and dismissals serialize;
- writes use a same-directory `O_EXCL|O_NOFOLLOW` temporary file, retained file
  descriptor, `fsync`, identity checks before and after rename, and directory
  `fsync`; planted temporary links and parent swaps fail closed;
- reads open same-owner regular files once with `O_NOFOLLOW|O_NONBLOCK`, cap
  each record at 4096 bytes, cap the census at 1024 entries, and return only the
  newest 64 records;
- retention is capped at 256 records; invalid, oversized, FIFO, device, socket,
  symlink, and non-owner entries never enter the fleet;
- input to hooks and adapters is time- and byte-bounded before JSON parsing;
  session identifiers accept only `[A-Za-z0-9._-]+`.

The QML model repeats the file-count, session-count, and byte bounds. It marks a
partial census visibly instead of presenting an incomplete fleet as complete.
Every data-bound `Text` is plain text and length-capped. Project focusing passes
one validated, control-free argument to `hyprctl`; no shell evaluates it.

## External effects

- No network access, account, API key, cookies, or telemetry.
- Reads and writes only the private spool under
  `${XDG_STATE_HOME:-~/.local/state}/omarchy/crew-chief/`.
- Optionally reads one bounded `herdr status --json` snapshot through the
  bundled adapter.
- Optionally invokes `hyprctl dispatch focuswindow` when the user activates a
  row.
- The Claude Code hook installer changes only `~/.claude/settings.json`, makes
  a backup, is idempotent, and runs only when the user explicitly invokes it.

Report a concern through a GitHub issue or email jeremy@intentsolutions.io.

# Crew Chief spool protocol

One bounded JSON object represents one local agent session. Required fields are
`id`, `state`, and `ts`; optional fields are `cwd`, `agent`, and
`message`. `state` is `working`, `needs_you`, or `done`. Unknown states
normalize to `working`.

Writers must invoke `bin/crew-chief-report` or `bin/crew-chief-spool write`;
they must not create spool files directly. Identifiers accept only ASCII
letters, digits, dot, underscore, and hyphen. A message is a short status
headline, not a prompt or transcript field, and must never contain secrets.

The private spool lives at
`${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/crew-chief`. Records are capped
at 4096 bytes, the displayed fleet at 64, the directory census at 1024, and
retained records at 256. The reader emits `{"__spoolTotal":N}` before records
so the UI can disclose a partial fleet.

All state lifecycle operations are descriptor-bound and serialized. Consumers
must preserve those boundaries rather than replacing the helper with direct
`cat`, `find`, `sort`, or `rm` calls.


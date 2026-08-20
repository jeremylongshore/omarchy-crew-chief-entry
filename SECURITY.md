# Security

This plugin runs unsandboxed QML inside the Omarchy shell process, plus an optional
Claude Code hook script. The footprint is deliberately small:

- **No network access at all.** The widget reads local JSON files from
  `~/.local/state/omarchy/crew-chief/` and nothing else.
- The hook script (`hooks/crew-chief-event`) writes session id, project directory, state,
  timestamp, and the notification headline. No transcript content, no prompts, no secrets.
- The installer (`hooks/install-claude-hooks`) edits only `~/.claude/settings.json`, makes
  a backup first, and is idempotent. It never runs without you invoking it.
- Shell commands executed by the widget: `cat` over the spool, `rm -f` of a spool file on
  explicit dismiss (session ids are validated against `[A-Za-z0-9._-]+` first), and an
  optional `hyprctl dispatch focuswindow` on row click.

Report anything that looks off: open a GitHub issue or email jeremy@intentsolutions.io.

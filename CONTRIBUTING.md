# Contributing

Issues and PRs welcome.

- `Model.js` is pure functions; every change needs a test in `tests/model.test.js`.
- The hook script has its own suite (`tests/hook.test.js`) that runs it against a temp
  spool with real stdin payloads. Keep it green (`node --test tests/*.test.js`).
- QML follows the Omarchy Quattro first-party conventions: theme tokens only,
  `setting()` for config, no hardcoded colors.

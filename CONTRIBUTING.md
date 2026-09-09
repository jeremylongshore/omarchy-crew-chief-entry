# Contributing

> **Maintainers wanted.** We are looking for dependable Omarchy users who want
> to review issues, test releases, and keep a plugin healthy over time. Start
> with a small pull request or open an issue titled **Maintainer interest**.
> Consistent contributors can earn maintainer responsibility.

## Verification responsibility

Documentation-only changes run the portable content gates:

```bash
scripts/run-plugin-gates.sh .
```

Changes to code, tests, manifests, automation, or runtime behavior also run:

```bash
npm ci
npm test
```

CI performs the remaining race, mutation, audit, and shell checks. For visible
changes, include a screenshot and describe what you exercised. Contributors do
not need private Buzz access. A maintainer performs trusted real-shell
verification after code review.

Do not edit `.rig-proof.json`, `.render-proof.json`, `preview.png`, or files
under `scripts/gates/`. Those are maintainer-owned or canonical evidence.

## Project-specific guidance

Issues and PRs welcome.

- `Model.js` is pure functions; every change needs a test in `tests/model.test.js`.
- The hook script has its own suite (`tests/hook.test.js`) that runs it against a temp
  spool with real stdin payloads. Keep it green (`node --test tests/*.test.js`).
- QML follows the Omarchy Quattro first-party conventions: theme tokens only,
  `setting()` for config, no hardcoded colors.

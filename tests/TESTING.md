# Testing posture

Seven-layer map for this repo (Intent Solutions taxonomy):

| Layer | Status | Where |
| --- | --- | --- |
| L1 git hooks | — (repo too small to gate locally; CI is the gate) | |
| L2 static | shellcheck (CI-gated) on hook + installer; qmllint exit-0 (rig, shell import paths; warning profile matches first-party plugins); JS syntax, manifest schema, and symlink checks in CI | `.github/workflows/test.yml` `static` job |
| L3 unit | **14 tests**: spool parser (brace-depth scanner), sorting, summary, pill | `tests/model.test.js` |
| L4 integration | hook script + installer executed for real against temp spools/settings | `tests/hook.test.js` |
| L5 system | full render on a headless Quattro shell rig with a hook-seeded spool | `preview.png` (real screenshot) |
| L6 E2E | live Claude Code sessions feeding the spool on a dev box | manual |
| L7 acceptance | `omarchy-plugin-validate` (upstream schema gate) green | pre-submission |

CI runs L3/L4 on every push (`.github/workflows/test.yml`). The hook suite runs the
actual bash scripts with real stdin payloads — no mocks of the thing under test.

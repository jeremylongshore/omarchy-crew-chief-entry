# Marketplace contract

Crew Chief ships one bar widget whose listing copy and runtime behavior tell the
same product story.

- Root and bar-widget descriptions are identical and exactly 500 characters.
- Copy names supported reporter classes and states, idle/attention bar behavior,
  attention-first panel order, bounded headline data, dismiss action, and the
  best-effort project-window focus boundary.
- `assets/banner.svg` identifies Crew Chief and depicts a needs-attention fleet.
- `preview.png` is accepted only with current-tree Buzz provenance, exact
  1280x720 dimensions, a clean shell-log hash, and visual approval.
- Reporters write bounded local state; Crew Chief has no network, account, API
  key, telemetry, or transcript-polling path.

`tests/contract.test.js`, `contracts/spool-protocol.md`, and gate C43 enforce the
machine-checkable portions.

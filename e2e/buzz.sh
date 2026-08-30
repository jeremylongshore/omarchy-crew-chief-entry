#!/usr/bin/env bash
# Acceptance lane: static rig checks plus a populated live Crew Chief render.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/rig-verify.sh" "$ROOT"
"$ROOT/scripts/rig-render.sh" "$ROOT" "$ROOT/preview.png"
test -s "$ROOT/preview.png"
jq -e '.sourceDirty == false and .sourcePackageSha256 == .remotePackageSha256
  and .omarchyPluginValidate == 0 and .qmllintErrors == 0' \
  "$ROOT/.rig-proof.json" >/dev/null
jq -e '.sourceDirty == false and .sourcePackageSha256 == .remotePackageSha256
  and (.previewSha256 | length == 64) and .dimensions == "1280 x 720"
  and .nonblackCoverage >= 0.35 and (.runId | length > 0)
  and (.rawShellLogSha256 | length == 64) and (.stateSnapshotSha256 | length == 64)
  and .storyEvidence.sessionCount == 4
  and .storyEvidence.needsYouCount == 1
  and .storyEvidence.workingCount == 2
  and .storyEvidence.doneCount == 1
  and .storyEvidence.harnessCount == 4
  and .storyEvidence.blockedFirstExpected == true
  and .outputScale == 1.25
  and .visualInspection.status == "pending"
  and .primaryAction == "four-session fleet published through production boundaries and IPC opened the attention-first panel"' \
  "$ROOT/.render-proof.json" >/dev/null

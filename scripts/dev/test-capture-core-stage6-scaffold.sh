#!/bin/sh
# Agent-safe Stage 6 scaffolding smoke (no live camera).
# Dry-run placeholders are not decodable; we only assert the validator runs and reports.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

swift build --package-path native/capture-macos >/dev/null
BIN="$(swift build --package-path native/capture-macos --show-bin-path)/capture-core"
SESSION="${TMPDIR:-/tmp}/capture-core-stage6-scaffold-$$"
mkdir -p "$SESSION"
REQ="$SESSION/request.json"
cat >"$REQ" <<EOF
{
  "sessionId": "stage6-scaffold",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "unused",
  "video": { "width": 1280, "height": 720, "frameRate": 30 },
  "maxDurationSec": 1,
  "segmentDurationSec": 0.4,
  "dryRun": true,
  "previewEnabled": true
}
EOF
"$BIN" record --request "$REQ" >"$SESSION/events.jsonl" 2>"$SESSION/stderr.txt"
test -f "$SESSION/recording-finished.json"
test -f "$SESSION/master/segments/seg_000_video.mov"
# Validator always writes a report; dry-run placeholders typically RESULT=FAIL (not real media).
set +e
sh scripts/dev/validate-capture-session.sh "$SESSION" >/dev/null 2>&1
VAL=$?
set -e
test -f "$SESSION/VALIDATION_REPORT.txt"
grep -q 'RESULT=' "$SESSION/VALIDATION_REPORT.txt"
test -x scripts/dev/run-capture-core-soak.sh
test -f docs/benchmarks/CAPTURE_CORE_STAGE6_MATRIX.md
echo "stage6 scaffold smoke OK (session=$SESSION validate_exit=$VAL report written)"
#!/bin/sh
# Agent-safe CaptureCore software smoke: protocol + segment layout + exit 0.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
swift build --package-path native/capture-macos >/dev/null
BIN="$(swift build --package-path native/capture-macos --show-bin-path)/capture-core"
SESSION="${TMPDIR:-/tmp}/capture-core-dry-$$"
mkdir -p "$SESSION"
REQ="$SESSION/request.json"
cat > "$REQ" <<EOF
{
  "sessionId": "dry-software",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "unused",
  "video": { "width": 1280, "height": 720, "frameRate": 30 },
  "maxDurationSec": 1,
  "dryRun": true
}
EOF
OUT="$SESSION/events.jsonl"
"$BIN" record --request "$REQ" > "$OUT" 2>"$SESSION/stderr.txt"
# Must emit finished state
grep -q '"type":"recording_finished"' "$OUT"
grep -q '"type":"segment_finalized"' "$OUT"
grep -q '"state":"finished"' "$OUT"
test -f "$SESSION/master/segments/seg_000_video.mov"
# On-disk seal for orphan scan (Swift side)
test -f "$SESSION/recording-finished.json"
grep -q '"status"[[:space:]]*:[[:space:]]*"complete"' "$SESSION/recording-finished.json"
echo "capture-core dry-run OK: $SESSION"

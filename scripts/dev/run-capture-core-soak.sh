#!/bin/sh
# Unattended CaptureCore soak launcher (Stage 6).
# Run from Terminal.app (TCC). Do not run under agent/hive parent.
#
# Usage:
#   sh scripts/dev/run-capture-core-soak.sh brio-yeti [durationSec]
#   sh scripts/dev/run-capture-core-soak.sh macbook [durationSec]
#   sh scripts/dev/run-capture-core-soak.sh list-devices
#
# Defaults: duration 3600 (1 hour). Artifacts under:
#   /tmp/capture-core-soak/<profile>-<timestamp>/
# Writes SOAK_RESULT.txt and runs validate-capture-session.sh at the end.
set -u
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROFILE="${1:-brio-yeti}"
DURATION="${2:-3600}"
SEGMENT="${SEGMENT_DURATION_SEC:-10}"
OUT_ROOT="${SOAK_OUT_ROOT:-/tmp/capture-core-soak}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN_DIR="$OUT_ROOT/${PROFILE}-${TS}"
SESSION="$RUN_DIR/session"
LOG="$RUN_DIR"

# Device defaults from Stage 2 evidence (override via env)
BRIO_ID="${BRIO_CAMERA_ID:-0x1200000046d085e}"
YETI_ID="${YETI_MIC_ID:-AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1}"
MAC_CAM_ID="${MACBOOK_CAMERA_ID:-6C707041-05AC-0011-0006-000000000001}"
MAC_MIC_ID="${MACBOOK_MIC_ID:-BuiltInMicrophoneDevice}"

mkdir -p "$SESSION/master/segments" "$LOG"

if [ "$PROFILE" = "list-devices" ]; then
  sh native/capture-macos/scripts/package-capture-core-app.sh
  APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
  exec "$APP" list-devices
fi

case "$PROFILE" in
  brio-yeti)
    CAMERA_ID="$BRIO_ID"
    MIC_ID="$YETI_ID"
    WIDTH=3840
    HEIGHT=2160
    FPS=30
    ;;
  brio-yeti-1080)
    CAMERA_ID="$BRIO_ID"
    MIC_ID="$YETI_ID"
    WIDTH=1920
    HEIGHT=1080
    FPS=30
    ;;
  macbook)
    CAMERA_ID="$MAC_CAM_ID"
    MIC_ID="$MAC_MIC_ID"
    WIDTH=1920
    HEIGHT=1080
    FPS=30
    ;;
  *)
    echo "unknown profile: $PROFILE (use brio-yeti | brio-yeti-1080 | macbook | list-devices)" >&2
    exit 2
    ;;
esac

echo "Packaging CaptureCore.app…"
sh native/capture-macos/scripts/package-capture-core-app.sh >"$LOG/package.log" 2>&1
APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
if [ ! -x "$APP" ]; then
  echo "missing $APP" >&2
  exit 1
fi

REQ="$LOG/request.json"
cat >"$REQ" <<EOF
{
  "sessionId": "soak-${PROFILE}-${TS}",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "$CAMERA_ID",
  "microphoneUniqueId": "$MIC_ID",
  "video": { "width": $WIDTH, "height": $HEIGHT, "frameRate": $FPS },
  "audio": { "sampleRate": 48000, "channelCount": 1 },
  "segmentDurationSec": $SEGMENT,
  "maxDurationSec": $DURATION,
  "videoOnly": false,
  "preferPcmAudio": true,
  "previewEnabled": true,
  "previewMaxFps": 5,
  "previewMaxWidth": 640
}
EOF

{
  echo "CaptureCore soak"
  echo "profile=$PROFILE"
  echo "durationSec=$DURATION"
  echo "segmentSec=$SEGMENT"
  echo "sessionRoot=$SESSION"
  echo "camera=$CAMERA_ID"
  echo "microphone=$MIC_ID"
  echo "video=${WIDTH}x${HEIGHT}@$FPS"
  echo "startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "app=$APP"
  echo ""
  echo "Leaving process unattended until maxDurationSec elapses (or process exits)."
  echo "Do not sleep the Mac. Caffeinate optional: caffeinate -i -w \$\$"
} | tee "$LOG/SOAK_START.txt"

# Optional: prevent idle sleep for this process tree if caffeinate exists
CAFFEINATE=""
if command -v caffeinate >/dev/null 2>&1; then
  CAFFEINATE="caffeinate -i"
fi

START_EPOCH=$(date +%s)
set +e
if [ -n "$CAFFEINATE" ]; then
  $CAFFEINATE "$APP" record --request "$REQ" \
    >"$LOG/events.jsonl" 2>"$LOG/stderr.txt"
else
  "$APP" record --request "$REQ" \
    >"$LOG/events.jsonl" 2>"$LOG/stderr.txt"
fi
EXIT=$?
set -e
END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH))

{
  echo "endedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "elapsedSec=$ELAPSED"
  echo "captureCoreExit=$EXIT"
} | tee -a "$LOG/SOAK_START.txt"

# Validate segments / seal
set +e
sh "$ROOT/scripts/dev/validate-capture-session.sh" "$SESSION" >"$LOG/validate.stdout" 2>"$LOG/validate.stderr"
VAL_EXIT=$?
set -e
cp -f "$SESSION/VALIDATION_REPORT.txt" "$LOG/VALIDATION_REPORT.txt" 2>/dev/null || true

# Summarize protocol
python3 - <<PY >"$LOG/events_summary.txt" 2>/dev/null || true
import json
from collections import Counter
from pathlib import Path
types=Counter()
path=Path("$LOG/events.jsonl")
if path.is_file():
    for line in path.read_text().splitlines():
        line=line.strip()
        if not line: continue
        try:
            o=json.loads(line)
        except Exception:
            continue
        types[o.get("type")]+=1
print(dict(types))
PY

# SOAK_RESULT
RESULT_FILE="$LOG/SOAK_RESULT.txt"
STATUS="FAIL"
if [ "$EXIT" -eq 0 ] && [ "$VAL_EXIT" -eq 0 ]; then
  STATUS="PASS"
elif [ "$EXIT" -eq 0 ]; then
  STATUS="PASS_WITH_VALIDATION_WARNINGS"
  # still fail hard if validation failed
  STATUS="FAIL_VALIDATION"
fi
if [ "$EXIT" -ne 0 ]; then
  STATUS="FAIL_CAPTURE_EXIT_$EXIT"
fi
if [ "$EXIT" -eq 0 ] && [ "$VAL_EXIT" -eq 0 ]; then
  STATUS="PASS"
fi

{
  echo "SOAK_RESULT=$STATUS"
  echo "profile=$PROFILE"
  echo "requestedDurationSec=$DURATION"
  echo "elapsedSec=$ELAPSED"
  echo "captureCoreExit=$EXIT"
  echo "validationExit=$VAL_EXIT"
  echo "runDir=$RUN_DIR"
  echo "sessionRoot=$SESSION"
  echo "events=$LOG/events.jsonl"
  echo "stderr=$LOG/stderr.txt"
  echo "validation=$LOG/VALIDATION_REPORT.txt"
  echo "finished=$(test -f "$SESSION/recording-finished.json" && echo yes || echo no)"
  echo "seal=$(test -f "$SESSION/session-seal.json" && echo yes || echo no)"
  if [ -f "$SESSION/recording-finished.json" ]; then
    python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
import os
p=Path(os.environ.get("SESSION","") or "")
# path injected below
PY
  fi
} >"$RESULT_FILE"

# Attach key finished metrics
if [ -f "$SESSION/recording-finished.json" ] && command -v python3 >/dev/null 2>&1; then
  python3 - <<PY >>"$RESULT_FILE"
import json
from pathlib import Path
d=json.loads(Path("$SESSION/recording-finished.json").read_text())
for k in ("status","measuredVideoFps","wallDurationSec","negotiatedWidth","negotiatedHeight",
          "negotiatedFrameRate","avInitialOffsetUs","videoFrames","segments","droppedVideo"):
    if k in d:
        print(f"{k}={d[k]}")
PY
fi

# Seal capture block if present
if [ -f "$SESSION/session-seal.json" ] && command -v python3 >/dev/null 2>&1; then
  python3 - <<PY >>"$RESULT_FILE"
import json
from pathlib import Path
d=json.loads(Path("$SESSION/session-seal.json").read_text())
print(f"segmentCount={d.get('segmentCount')}")
cap=d.get("capture") or {}
for k,v in cap.items():
    print(f"seal.capture.{k}={v}")
PY
fi

echo ""
echo "======== SOAK COMPLETE ========"
cat "$RESULT_FILE"
echo "==============================="
echo "Full logs: $RUN_DIR"

if [ "$STATUS" = "PASS" ]; then
  exit 0
fi
exit 1

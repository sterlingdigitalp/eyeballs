#!/bin/sh
# Stage 6 matrix #4 — camera unplug mid open segment (interactive).
set -u
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN="/tmp/capture-core-failure/camera-unplug-$TS"
SESSION="$RUN/session"
mkdir -p "$SESSION"
sh native/capture-macos/scripts/package-capture-core-app.sh >"$RUN/package.log" 2>&1
APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
BRIO_ID="${BRIO_CAMERA_ID:-0x1200000046d085e}"
YETI_ID="${YETI_MIC_ID:-AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1}"

cat >"$RUN/request.json" <<EOF
{
  "sessionId": "fail-cam-unplug-$TS",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "$BRIO_ID",
  "microphoneUniqueId": "$YETI_ID",
  "video": { "width": 1920, "height": 1080, "frameRate": 30 },
  "audio": { "sampleRate": 48000, "channelCount": 1 },
  "segmentDurationSec": 10,
  "maxDurationSec": 90,
  "preferPcmAudio": true,
  "previewEnabled": false
}
EOF

echo "Recording started. Wait ~15s (past first segment finalize), then UNPLUG BRIO."
echo "Leave unplugged ~10s. Press Enter here after unplug (process may already be exiting)."
"$APP" record --request "$RUN/request.json" \
  >"$RUN/events.jsonl" 2>"$RUN/stderr.txt" \
  0< <(sleep 120) &
PID=$!
sleep 15
echo ""
echo ">>> NOW UNPLUG THE BRIO CAMERA <<<"
echo "Press Enter after you have unplugged (or after ~10s)…"
read -r _
sleep 5
if kill -0 "$PID" 2>/dev/null; then
  echo "Process still running; sending SIGTERM then waiting…"
  kill "$PID" 2>/dev/null
fi
wait "$PID" 2>/dev/null
EXIT=$?

FINISHED=no
STATUS=none
if [ -f "$SESSION/recording-finished.json" ]; then
  FINISHED=yes
  STATUS=$(python3 -c "import json;print(json.load(open('$SESSION/recording-finished.json')).get('status'))" 2>/dev/null || echo unknown)
fi
SEGS=$(find "$SESSION/master/segments" -type f 2>/dev/null | wc -l | tr -d ' ')
PRIOR=na
if [ -f "$SESSION/master/segments/seg_000_video.mov" ]; then
  if ffprobe -v error "$SESSION/master/segments/seg_000_video.mov" >/dev/null 2>&1; then
    PRIOR=playable
  else
    PRIOR=not_playable
  fi
fi

FALSE=no
if [ "$FINISHED" = yes ] && [ "$STATUS" = complete ]; then
  # complete after camera loss is suspicious unless process never saw the unplug
  FALSE=review
fi

RESULT=REVIEW
if [ "$PRIOR" = playable ] && [ "$SEGS" -gt 0 ] && [ "$STATUS" != complete ]; then
  RESULT=PASS
elif [ "$PRIOR" = playable ] && [ "$SEGS" -gt 0 ]; then
  RESULT=PASS_PARTIAL
fi

{
  echo "FAILURE_RESULT=$RESULT"
  echo "test=camera-unplug"
  echo "processExit=$EXIT"
  echo "finishedMarker=$FINISHED"
  echo "finishedStatus=$STATUS"
  echo "segmentFiles=$SEGS"
  echo "seg000Video=$PRIOR"
  echo "falseCompleteFlag=$FALSE"
  echo "runDir=$RUN"
  echo "policy=docs/benchmarks/CAPTURE_CORE_STAGE6_FAILURE_POLICIES.md"
} | tee "$RUN/FAILURE_RESULT.txt"
echo "Done. cat $RUN/FAILURE_RESULT.txt"

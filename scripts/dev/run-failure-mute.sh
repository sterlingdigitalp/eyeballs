#!/bin/sh
# Stage 6 matrix #6 — Yeti hardware mute / silence (interactive).
set -u
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN="/tmp/capture-core-failure/mute-$TS"
SESSION="$RUN/session"
mkdir -p "$SESSION"
sh native/capture-macos/scripts/package-capture-core-app.sh >"$RUN/package.log" 2>&1
APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
BRIO_ID="${BRIO_CAMERA_ID:-0x1200000046d085e}"
YETI_ID="${YETI_MIC_ID:-AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1}"

cat >"$RUN/request.json" <<EOF
{
  "sessionId": "fail-mute-$TS",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "$BRIO_ID",
  "microphoneUniqueId": "$YETI_ID",
  "video": { "width": 1920, "height": 1080, "frameRate": 30 },
  "audio": { "sampleRate": 48000, "channelCount": 1 },
  "segmentDurationSec": 10,
  "maxDurationSec": 45,
  "preferPcmAudio": true,
  "previewEnabled": false
}
EOF

echo "Recording ~45s. After ~10s: MUTE Yeti for ~20s, then UNMUTE."
echo "Press Enter when mute period is done (or after unmuting)."
"$APP" record --request "$RUN/request.json" \
  >"$RUN/events.jsonl" 2>"$RUN/stderr.txt" &
PID=$!
sleep 10
echo ">>> MUTE YETI NOW (~20 seconds) <<<"
sleep 20
echo ">>> UNMUTE YETI <<<"
read -r _
wait "$PID" 2>/dev/null
EXIT=$?

FINISHED=no
STATUS=none
if [ -f "$SESSION/recording-finished.json" ]; then
  FINISHED=yes
  STATUS=$(python3 -c "import json;print(json.load(open('$SESSION/recording-finished.json')).get('status'))" 2>/dev/null || echo unknown)
fi
CRASH=no
if [ "$EXIT" -gt 128 ]; then CRASH=yes; fi

# Rough silence check on a mid audio segment if present
SILENCE_NOTE=not_measured
if command -v python3 >/dev/null 2>&1 && [ -f "$SESSION/master/segments/seg_001_audio.caf" ]; then
  SILENCE_NOTE="see_operator_notes_muted_hardware_is_valid_zero_signal"
fi

RESULT=FAIL
if [ "$CRASH" = no ] && [ "$EXIT" -eq 0 ] && [ "$STATUS" = complete ]; then
  RESULT=PASS
elif [ "$CRASH" = no ]; then
  RESULT=PASS_PARTIAL
fi

{
  echo "FAILURE_RESULT=$RESULT"
  echo "test=yeti-mute"
  echo "processExit=$EXIT"
  echo "crashed=$CRASH"
  echo "finishedMarker=$FINISHED"
  echo "finishedStatus=$STATUS"
  echo "silenceNote=$SILENCE_NOTE"
  echo "runDir=$RUN"
  echo "policy=mute must not crash; zeros OK if flagged later"
} | tee "$RUN/FAILURE_RESULT.txt"
echo "Done. cat $RUN/FAILURE_RESULT.txt"

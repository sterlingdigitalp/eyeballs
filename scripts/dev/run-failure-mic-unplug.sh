#!/bin/sh
# Stage 6 matrix #5 — microphone unplug mid record (interactive).
set -u
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN="/tmp/capture-core-failure/mic-unplug-$TS"
SESSION="$RUN/session"
mkdir -p "$SESSION"
sh native/capture-macos/scripts/package-capture-core-app.sh >"$RUN/package.log" 2>&1
APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
BRIO_ID="${BRIO_CAMERA_ID:-0x1200000046d085e}"
YETI_ID="${YETI_MIC_ID:-AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1}"

cat >"$RUN/request.json" <<EOF
{
  "sessionId": "fail-mic-unplug-$TS",
  "sessionRoot": "$SESSION",
  "cameraUniqueId": "$BRIO_ID",
  "microphoneUniqueId": "$YETI_ID",
  "video": { "width": 1920, "height": 1080, "frameRate": 30 },
  "audio": { "sampleRate": 48000, "channelCount": 1 },
  "segmentDurationSec": 10,
  "maxDurationSec": 60,
  "preferPcmAudio": true,
  "previewEnabled": false
}
EOF

echo "Recording. After ~12s, UNPLUG YETI. Leave camera plugged in."
echo "Press Enter after unplug; we will wait for stop/maxDuration or kill at 45s."
"$APP" record --request "$RUN/request.json" \
  >"$RUN/events.jsonl" 2>"$RUN/stderr.txt" \
  0< <(sleep 90) &
PID=$!
sleep 12
echo ">>> NOW UNPLUG THE YETI MICROPHONE <<<"
read -r _
# Let it run a bit more with camera only if process survives
sleep 15
if kill -0 "$PID" 2>/dev/null; then
  echo '{"type":"stop"}' >/proc/$PID/fd/0 2>/dev/null || true
  # macOS: stdin is from sleep process; just wait or SIGTERM
  sleep 5
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
  fi
fi
wait "$PID" 2>/dev/null
EXIT=$?

FINISHED=no
STATUS=none
if [ -f "$SESSION/recording-finished.json" ]; then
  FINISHED=yes
  STATUS=$(python3 -c "import json;print(json.load(open('$SESSION/recording-finished.json')).get('status'))" 2>/dev/null || echo unknown)
fi
VIDEO_N=$(find "$SESSION/master/segments" -name '*_video.mov' 2>/dev/null | wc -l | tr -d ' ')
AUDIO_N=$(find "$SESSION/master/segments" -name '*_audio.caf' 2>/dev/null | wc -l | tr -d ' ')
VID_OK=na
if [ -f "$SESSION/master/segments/seg_000_video.mov" ]; then
  ffprobe -v error "$SESSION/master/segments/seg_000_video.mov" >/dev/null 2>&1 && VID_OK=playable || VID_OK=not_playable
fi

RESULT=REVIEW
if [ "$VID_OK" = playable ] && [ "$VIDEO_N" -gt 0 ]; then
  RESULT=PASS_PARTIAL
fi

{
  echo "FAILURE_RESULT=$RESULT"
  echo "test=mic-unplug"
  echo "processExit=$EXIT"
  echo "finishedMarker=$FINISHED"
  echo "finishedStatus=$STATUS"
  echo "videoSegments=$VIDEO_N"
  echo "audioSegments=$AUDIO_N"
  echo "seg000Video=$VID_OK"
  echo "runDir=$RUN"
  echo "note=Document observed video-continue vs crash in matrix; silence detector not required for PASS_PARTIAL"
} | tee "$RUN/FAILURE_RESULT.txt"
echo "Done. cat $RUN/FAILURE_RESULT.txt"

#!/bin/sh
# Stage 6 matrix #7 — SIGKILL mid-record (mostly automated).
set -u
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN="/tmp/capture-core-failure/sigkill-$TS"
SESSION="$RUN/session"
mkdir -p "$SESSION"
sh native/capture-macos/scripts/package-capture-core-app.sh >"$RUN/package.log" 2>&1
APP="$ROOT/native/capture-macos/.build/CaptureCore.app/Contents/MacOS/capture-core"
BRIO_ID="${BRIO_CAMERA_ID:-0x1200000046d085e}"
YETI_ID="${YETI_MIC_ID:-AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1}"

cat >"$RUN/request.json" <<EOF
{
  "sessionId": "fail-sigkill-$TS",
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

echo "Starting record; will SIGKILL after 25s…"
"$APP" record --request "$RUN/request.json" \
  >"$RUN/events.jsonl" 2>"$RUN/stderr.txt" \
  0< <(sleep 120) &
PID=$!
sleep 25
if kill -0 "$PID" 2>/dev/null; then
  kill -9 "$PID"
  echo "sent SIGKILL to $PID"
  KILL=yes
else
  echo "process already exited"
  KILL=no
fi
wait "$PID" 2>/dev/null
EXIT=$?

FINISHED=no
test -f "$SESSION/recording-finished.json" && FINISHED=yes
STATUS=unknown
if [ -f "$SESSION/recording-finished.json" ]; then
  STATUS=$(python3 -c "import json;print(json.load(open('$SESSION/recording-finished.json')).get('status'))" 2>/dev/null || echo unknown)
fi
SEGS=$(find "$SESSION/master/segments" -type f 2>/dev/null | wc -l | tr -d ' ')

# Prior segment decodable?
PRIOR=na
if [ -f "$SESSION/master/segments/seg_000_video.mov" ]; then
  if ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 \
    "$SESSION/master/segments/seg_000_video.mov" >/dev/null 2>&1; then
    PRIOR=playable
  else
    PRIOR=not_playable
  fi
fi

RESULT=FAIL
if [ "$KILL" = yes ] && [ "$FINISHED" = no ] && [ "$SEGS" -gt 0 ] && [ "$PRIOR" = playable ]; then
  RESULT=PASS
elif [ "$KILL" = yes ] && [ "$FINISHED" = no ] && [ "$SEGS" -gt 0 ]; then
  RESULT=PASS_PARTIAL
fi

{
  echo "FAILURE_RESULT=$RESULT"
  echo "test=sigkill"
  echo "killSent=$KILL"
  echo "processExit=$EXIT"
  echo "finishedMarker=$FINISHED"
  echo "finishedStatus=$STATUS"
  echo "segmentFiles=$SEGS"
  echo "seg000Video=$PRIOR"
  echo "runDir=$RUN"
  echo "falseComplete=$( [ "$FINISHED" = yes ] && [ "$STATUS" = complete ] && echo YES_BAD || echo no )"
} | tee "$RUN/FAILURE_RESULT.txt"

echo "Done. cat $RUN/FAILURE_RESULT.txt"
[ "$RESULT" = PASS ] || [ "$RESULT" = PASS_PARTIAL ]

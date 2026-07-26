#!/bin/sh
# Validate a CaptureCore session: every closed segment decodable + hash-valid vs seal.
# Usage:
#   sh scripts/dev/validate-capture-session.sh /path/to/sessionRoot
# Exit 0 = PASS, 1 = FAIL. Writes VALIDATION_REPORT.txt in the session root.
set -u
SESSION="${1:-}"
if [ -z "$SESSION" ] || [ ! -d "$SESSION" ]; then
  echo "usage: $0 <sessionRoot>" >&2
  exit 2
fi

REPORT="$SESSION/VALIDATION_REPORT.txt"
SEGMENTS="$SESSION/master/segments"
SEAL="$SESSION/session-seal.json"
FINISHED="$SESSION/recording-finished.json"
PASS=1

{
  echo "CaptureCore session validation"
  echo "sessionRoot=$SESSION"
  echo "validatedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
} >"$REPORT"

fail() {
  echo "FAIL: $*" | tee -a "$REPORT"
  PASS=0
}

ok() {
  echo "OK: $*" | tee -a "$REPORT"
}

if [ ! -d "$SEGMENTS" ]; then
  fail "missing master/segments"
  echo "RESULT=FAIL" >>"$REPORT"
  exit 1
fi

# Count segment files
SEG_COUNT=$(find "$SEGMENTS" -type f | wc -l | tr -d ' ')
echo "segmentFiles=$SEG_COUNT" | tee -a "$REPORT"

if [ "$SEG_COUNT" -eq 0 ]; then
  fail "no segment files"
  echo "RESULT=FAIL" >>"$REPORT"
  exit 1
fi

# Prefer seal hashes when present
if [ -f "$SEAL" ]; then
  ok "session-seal.json present"
else
  echo "WARN: no session-seal.json (hash check limited to recompute only)" | tee -a "$REPORT"
fi

if [ -f "$FINISHED" ]; then
  ok "recording-finished.json present"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY | tee -a "$REPORT"
import json
from pathlib import Path
p = Path("$FINISHED")
d = json.loads(p.read_text())
for k in (
    "status", "exitCode", "negotiatedWidth", "negotiatedHeight", "negotiatedFrameRate",
    "measuredVideoFps", "wallDurationSec", "avInitialOffsetUs", "videoFrames",
    "segmentDurationSec", "videoCodec", "preferPcmAudio",
):
    if k in d:
        print(f"finished.{k}={d[k]}")
PY
  fi
else
  echo "WARN: no recording-finished.json (incomplete or kill path?)" | tee -a "$REPORT"
fi

# Validate each file under segments/
FFPROBE=""
if command -v ffprobe >/dev/null 2>&1; then
  FFPROBE=ffprobe
fi

for f in "$SEGMENTS"/*; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  size=$(wc -c <"$f" | tr -d ' ')
  echo "" | tee -a "$REPORT"
  echo "--- $base ($size bytes) ---" | tee -a "$REPORT"

  if [ "$size" -eq 0 ]; then
    fail "$base is empty"
    continue
  fi

  # Hash
  if command -v shasum >/dev/null 2>&1; then
    HASH=$(shasum -a 256 "$f" | awk '{print $1}')
  else
    HASH=$(openssl dgst -sha256 "$f" | awk '{print $NF}')
  fi
  echo "sha256=$HASH" | tee -a "$REPORT"

  if [ -f "$SEAL" ] && command -v python3 >/dev/null 2>&1; then
    MATCH=$(python3 - <<PY
import json, sys
from pathlib import Path
seal = json.loads(Path("$SEAL").read_text())
path = "$f"
h = "$HASH"
segs = seal.get("segments") or []
# match by basename or full path suffix
found = None
for s in segs:
    p = s.get("path") or ""
    if p == path or p.endswith("/$base") or Path(p).name == "$base":
        found = s
        break
if not found:
    print("NO_SEAL_ENTRY")
elif found.get("sha256") == h:
    print("HASH_MATCH")
else:
    print("HASH_MISMATCH expected=%s" % found.get("sha256"))
if found and found.get("byteLength") is not None and int(found["byteLength"]) != int("$size"):
    print("SIZE_MISMATCH seal=%s disk=%s" % (found.get("byteLength"), "$size"))
PY
)
    case "$MATCH" in
      *HASH_MATCH*) ok "$base hash matches seal" ;;
      *NO_SEAL_ENTRY*) echo "WARN: $base not listed in seal (may be open/incomplete file)" | tee -a "$REPORT" ;;
      *) fail "$base $MATCH" ;;
    esac
  fi

  # Decode check
  if [ -n "$FFPROBE" ]; then
    PROBE=$($FFPROBE -v error -show_entries format=duration,format_name,size \
      -show_entries stream=codec_type,codec_name,width,height,sample_rate,channels \
      -of default=noprint_wrappers=1 "$f" 2>&1) || true
    if echo "$PROBE" | grep -qiE 'Invalid data|moov atom not found|error'; then
      # Incomplete open segments after kill are expected to fail; mark WARN if no finished marker
      if [ ! -f "$FINISHED" ]; then
        echo "WARN: $base not decodable (acceptable if incomplete after kill)" | tee -a "$REPORT"
        echo "$PROBE" | tee -a "$REPORT"
      else
        fail "$base not decodable"
        echo "$PROBE" | tee -a "$REPORT"
      fi
    else
      ok "$base decodable"
      echo "$PROBE" | tee -a "$REPORT"
    fi
  else
    echo "WARN: ffprobe not installed; skipped decode check for $base" | tee -a "$REPORT"
  fi
done

echo "" | tee -a "$REPORT"
if [ "$PASS" -eq 1 ]; then
  echo "RESULT=PASS" | tee -a "$REPORT"
  exit 0
fi
echo "RESULT=FAIL" | tee -a "$REPORT"
exit 1

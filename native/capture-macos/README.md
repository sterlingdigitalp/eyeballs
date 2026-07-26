# macOS capture and tracking probes

## Tools

| Binary | Role |
|---|---|
| `capture-probe` | Enumerate AVFoundation cameras/mics and formats (no capture permission) |
| `vision-benchmark` | Apple Vision landmarks over a video file |
| `capture-core` | **Production CaptureCore** — one process per recording, sample-buffer masters |

## CaptureCore

See `docs/CAPTURE_CORE_CHARTER.md` and `docs/adr/ADR-004-capture-core-provisional.md`.

```sh
# List AVFoundation uniqueIDs (needs camera/mic access for full use)
swift run --package-path native/capture-macos capture-core list-devices

# Record (one process; send stop on stdin)
cat > /tmp/capture-request.json <<'EOF'
{
  "sessionId": "test-session",
  "sessionRoot": "/tmp/capture-core-session",
  "cameraUniqueId": "<from list-devices>",
  "microphoneUniqueId": "<optional>",
  "video": { "width": 1920, "height": 1080, "frameRate": 30 },
  "audio": { "sampleRate": 48000, "channelCount": 1 },
  "segmentDurationSec": 60,
  "maxDurationSec": 15,
  "videoOnly": false
}
EOF
mkdir -p /tmp/capture-core-session
swift run --package-path native/capture-macos capture-core record --request /tmp/capture-request.json
# Or: echo '{"type":"stop"}' | capture-core record --request ...
```

- **stdout:** JSONL protocol events (`state`, `health`, `segment_finalized`, `recording_finished`, …)
- **stderr:** diagnostics only
- **masters:** `sessionRoot/master/segments/seg_NNN_video.mov` and `seg_NNN_audio.caf`

## Probes

```sh
swift run --package-path native/capture-macos capture-probe
swift run --package-path native/capture-macos vision-benchmark --input fixtures/synthetic/synthetic-av.mp4
```

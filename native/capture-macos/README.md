# macOS capture and tracking probes

## Tools

| Binary | Role |
|---|---|
| `capture-probe` | Enumerate AVFoundation cameras/mics and formats (no capture permission) |
| `vision-benchmark` | Apple Vision landmarks over a video file |
| `capture-core` | **Production CaptureCore** — one process per recording, sample-buffer masters |

## CaptureCore

See `docs/CAPTURE_CORE_CHARTER.md` and `docs/adr/ADR-004-capture-core-provisional.md`.

Agent-safe software smoke (no camera / TCC):

```sh
sh scripts/dev/test-capture-core-dry-run.sh
# from repo root; or:
swift run --package-path native/capture-macos capture-core record --request <dryRun request.json>
```

Tauri supervisor (Rust): `capture_core_record`, `capture_core_stop`,
`capture_core_hash_file`, `capture_core_hash_segments`, `capture_core_scan_orphans`,
`capture_core_list_devices`, `capture_core_binary_path`.

Stage the sidecar for Tauri:

```sh
npm run prepare:capture-core
# → apps/desktop/src-tauri/binaries/capture-core-<rustc-host-triple>
```

Set `CAPTURE_CORE_BIN` to override discovery. Live records emit `capture-core-event`
on the app event bus; `capture_core_stop` writes stdin `{"type":"stop"}`.

On-disk seals (orphan scan):
- Swift writes `recording-finished.json` on clean stop / dry-run
- Rust writes `session-seal.json` with streamed SHA-256 of segment files

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

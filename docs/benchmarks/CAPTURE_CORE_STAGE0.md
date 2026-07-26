# CaptureCore Stage 0 notes

Date: 2026-07-26  
Branch: `feature/capture-core`  
Worktree: isolated from Phase 2/3 coaching tree

## Delivered

| Item | Status |
|---|---|
| `capture-core list-devices` | Works — emits AVFoundation `uniqueId` inventory (JSON) |
| `capture-core record --request` | Implemented — sample-buffer architecture, segment files, JSONL protocol |
| Stdin `stop` / `ping` / `cancel` | Implemented |
| stdout JSONL / stderr logs | Implemented |
| Segment layout `master/segments/seg_NNN_video.mov` (+ audio) | Implemented |
| Info.plist + minimal `.app` package script | Implemented (`scripts/package-capture-core-app.sh`) |
| `dryRun` request flag | Implemented for protocol CI without TCC |

## Live camera proof (blocked in agent host)

Running under the Grok/Hive agent, `requestAccess(for: .video)` is aborted by TCC:

```text
namespace: TCC
details: attempted to access privacy-sensitive data without a usage description
```

Even when `Bundle.main` **does** contain `NSCameraUsageDescription` (verified via log), the crash report attributes **responsibleProc = hive**. On current macOS, privacy prompts/access for child processes can be enforced against the **responsible parent**, which lacks a camera usage string.

**Implication:** Stage 0 hardware proof (4K Brio, Brio+Yeti, kill recovery) must be run from:

1. **Terminal.app** (or iTerm) with Camera allowed, using packaged `CaptureCore.app`, or  
2. The future **Tauri host** as parent (correct permanent design — sidecar inherits product TCC story).

Commands for local Stage 0 proof:

```sh
cd native/capture-macos
./scripts/package-capture-core-app.sh
APP=.build/CaptureCore.app/Contents/MacOS/capture-core
$APP list-devices
# grant Camera to CaptureCore in System Settings if prompted
# then record with real request.json (maxDurationSec: 10, Brio uniqueId, Yeti uniqueId)
```

## Protocol smoke (agent-safe)

```sh
swift build --package-path native/capture-macos
BIN=$(swift build --package-path native/capture-macos --show-bin-path)/capture-core
mkdir -p /tmp/cc-dry/master
cat > /tmp/cc-dry-req.json <<'EOF'
{
  "sessionId": "dry-1",
  "sessionRoot": "/tmp/cc-dry",
  "cameraUniqueId": "unused-in-dry-run",
  "video": { "width": 1280, "height": 720, "frameRate": 30 },
  "maxDurationSec": 1,
  "dryRun": true
}
EOF
$BIN record --request /tmp/cc-dry-req.json
```

Expect: `state starting → recording → segment_finalized → recording_finished → finished`, exit 0.

## Software progress (no live camera)

| Item | Status |
|---|---|
| Profile `deviceBindings` + `captureCoreDeviceIds()` | Contracts + unit test |
| `buildCaptureCoreRecordRequest` + protocol schemas | Contracts |
| Rust streaming SHA-256 of closed segment files | `capture_core.rs` + cargo tests |
| Rust `session-seal.json` after clean exit | `write_session_seal` |
| Swift `recording-finished.json` on finish/cancel | Dry-run + live stop |
| Tauri commands: record / hash / orphan scan / list-devices | Registered in `lib.rs` |
| TS client `apps/desktop/src/lib/capture-core.ts` | Invoke wrappers |
| `scripts/dev/test-capture-core-dry-run.sh` | Protocol + on-disk seal smoke |

## Next (Stage 2–4)

1. Human/Terminal Stage 0 hardware matrix (Brio 4K/30, Yeti, kill, clean stop).  
2. Harden writers after first successful live take (PCM audio, segment rotation under load).  
3. Wire Dataset UI button → `captureCoreDryRun` / `captureCoreRecord` (needs sessions dir + stop webview camera).  
4. Package capture-core as Tauri externalBin sidecar for release builds.

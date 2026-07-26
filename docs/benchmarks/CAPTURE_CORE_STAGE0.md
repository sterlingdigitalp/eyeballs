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

## Live camera proof

### Agent host (blocked)

Running under the Grok/Hive agent, `requestAccess(for: .video)` is aborted by TCC (`responsibleProc = hive`). Live proof must use Terminal / packaged app / Tauri parent.

### Human Terminal proof — 2026-07-26 (PASS for dual short take)

Host: packaged `CaptureCore.app` via `scripts/package-capture-core-app.sh`  
Session: `/tmp/capture-core-stage0-dual` · `maxDurationSec: 15` · exit **0**

| Device | Role | AVFoundation `uniqueId` |
|---|---|---|
| Logitech BRIO | camera | `0x1200000046d085e` |
| Yeti Stereo Microphone | mic | `AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1` |

Request: 3840×2160@30 + audio 48 kHz mono (not dry-run).

| Check | Result |
|---|---|
| TCC (camera + mic) under packaged app | Pass (`videoStatus=0`, configure complete) |
| Dual Brio + Yeti | Pass |
| Protocol | `starting → recording → stopping → segment_finalized → recording_finished → finished` |
| Masters on disk | `seg_000_video.mov` (~62.2 MB), `seg_000_audio.caf` (~275 KB) |
| `recording-finished.json` | `status: complete`, `exitCode: 0`, 364 video frames, 1417 audio buffers |
| Sample PTS logged | `firstVideoPtsUs`, `firstAudioPtsUs` present |
| Append failures | video 0 / audio 0 |
| Startup drops | `droppedVideo: 3` (acceptable for short take) |
| ffprobe video | **3840×2160** H.264, duration ~15.17 s |
| ffprobe/afinfo audio | AAC mono **48 kHz**, duration ~15.17 s |
| SHA-256 video | `e85ca44cf2a017e699964561589e5c349be8628808c39795792759ce329316ec` |
| SHA-256 audio | `e9dd7bf1c6179190735e8ca786f9124ce73700a80d70faac90dc8a9c42bf04a5` |

### Human Terminal proof — kill recovery (PASS) — same day

Session: `/tmp/capture-core-stage0-kill` · 1080p request · stdin held open via `0< <(sleep 30)` · **`kill -9` after ~5s**

| Check | Result |
|---|---|
| Process still alive at kill | Pass (`sent SIGKILL`) |
| No clean finalize | Pass — events stop mid-`health` (51 video frames, 193 audio buffers) |
| `recording-finished.json` | **MISSING** (honest incomplete) |
| Partial masters preserved | `seg_000_video.mov` (~4.0 MB), `seg_000_audio.caf` (~91 KB) |
| No auto-restart | Pass |

Note: first kill attempt failed methodology (background job closed stdin → EOF treated as `stop`). Real kill requires stdin held open.

## Stage 2 native proof — **COMPLETE** (2026-07-26 close-out)

Charter Stage 2 exit met with Terminal + packaged `CaptureCore.app` evidence below.  
(ADR-004 remains Provisional until Stage 6 soak/matrix; Stage 2 only requires proof notes.)

### Dual take (clean stop) — PASS

Session: `/tmp/capture-core-stage2-dual` · maxDuration 15s · segmentDuration 10s · exit **0**

| Check | Result |
|---|---|
| Brio + Yeti simultaneous | Pass |
| Active format | **3840×2160**, range 5–30 fps (UVC duration lock skipped — see crash fix `a41356d`) |
| Delivered video rate | ffprobe **24 fps** (format advertises 30; honest limitation without frame-duration lock) |
| H.264 masters | Pass · 2 segments (`seg_000` ~10.5s, `seg_001` remainder) |
| PCM audio | **Int16 mono 48 kHz** CAF (`preferPcmAudio: true`) |
| Sample PTS | Present on both streams (protocol health / segment_finalized) |
| `recording-finished.json` | `status: complete` |
| Segment rotation | Pass (2 video + 2 audio files) |

SHA-256:

| File | Digest |
|---|---|
| seg_000_video.mov | `1b688f827905aa8dbcd37473a96a2a93857e57561746941c52d3b75a8f04f71b` |
| seg_000_audio.caf | `afe4fad9388a972c37e200f1578ef6c4170fbee9fa95a18fcf72029fa1f9e0f7` |
| seg_001_video.mov | `e98e385b3a4fb28eb8ecfb9181906c102c2ebf95f6245ca67276673cbc304ce3` |
| seg_001_audio.caf | `3ccd40c5cdb9c0e2429b08549d8453730d639273248d80506a9e5d6ae4fab277` |

### Kill recovery (10s segments) — PASS

Session: `/tmp/capture-core-stage2-kill` · 1080p · SIGKILL after ~12s · stdin held open

| Check | Result |
|---|---|
| SIGKILL delivered while recording | Pass |
| `recording-finished.json` | **MISSING** (honest incomplete) |
| `segment_finalized` before kill | Pass — `seg_000` reason `segment_duration` |
| **Playable finalized segment after kill** | **Pass** — `seg_000_video.mov` H.264 1920×1080 ~10.5s; `seg_000_audio.caf` pcm_s16le ~10.5s |
| Open segment at kill | `seg_001_video.mov` unplayable (`moov atom not found`) — expected |
| Open audio fragment | Short PCM CAF ~0.35s still probes |

**Recovery story validated:** only the open segment is at risk; prior finalized segments remain reviewable.

### Known limitations (not Stage 2 blockers)

1. Delivered fps often **24** on Brio 4K even when format lists 30 (no UVC frame-duration lock after SIGABRT on `setActiveVideoMinFrameDuration`).  
2. Product-parent TCC (Tauri host) proven later in Stage 4 live take.  
3. 1h soak + failure matrix → Stage 6.

### Commands used

```sh
cd native/capture-macos
./scripts/package-capture-core-app.sh
APP=.build/CaptureCore.app/Contents/MacOS/capture-core
$APP list-devices
# dual: 4K + Yeti, segmentDurationSec 10, maxDurationSec 15, preferPcmAudio true
# kill: 1080p, segmentDurationSec 10, SIGKILL at ~12s with stdin held open
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

## Software progress (continued)

| Item | Status |
|---|---|
| App-confined `sessions/` + `prepare_session` | Tauri commands |
| Path confinement on record/hash/orphan | Rejects roots outside app sessions |
| Startup orphan scan (log) | `lib.rs` setup |
| `reconcileDeviceBindings` by name | Contracts + tests |
| Dataset page dry-run UI | `CaptureCorePanel` + nav |

## Software progress (post Stage 0 hardware)

| Item | Status |
|---|---|
| Default segment duration **10s** (was 60) | Swift + contracts |
| Dry-run multi-segment protocol | `segmentDurationSec` without 5s floor |
| `movieFragmentInterval` 2s on video writer | Kill-path partial readability |
| Prefer target fps in `activeFormat` selection | Logged negotiated WxH@fps |
| PCM audio masters default (`preferPcmAudio`) | LPCM in CAF; AAC optional |
| Dataset **Live record** + duration control | `CaptureCorePanel` |
| Tauri `externalBin` + prepare script | `binaries/capture-core-<triple>` |
| Live protocol events + Stop | `capture-core-event`, `capture_core_stop` |
| Binary resolve (exe dir / sidecar / repo) | `resolve_capture_core_binary` |

## Stage 4 Tauri vertical slice — **COMPLETE** (2026-07-26)

| Exit item | Evidence |
|---|---|
| Rust supervisor + stop + events | `capture_core.rs` / `lib.rs` |
| Release webview camera | `CaptureCorePanel` `onReleaseMedia` before every take |
| Root-confined sessions | `prepare_session_dir` + path checks |
| Dataset one-button slice | Primary **Run vertical slice** (30s live if AV bound, else dry-run) |
| Validate + Rust SHA-256 seal | `session-seal.json` + `isCaptureCoreVerticalSliceComplete` |
| Automated proof | `cargo test stage4_vertical_slice_prepare_record_seal` · `scripts/dev/test-capture-core-stage4-vertical.sh` |

Live camera under Tauri uses the same supervisor as Terminal Stage 2; agent CI proves the sealed path via dry-run masters.

## Next

1. ~~Stages 1–4~~ **COMPLETE**.  
2. Stage 5: measured low-rate preview / analysis transport.  
3. Stage 6: 1h soak + failure matrix → ADR-004 Accepted.

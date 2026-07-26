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

**Follow-ups (not blockers for coding ahead):**

1. Requested 30 fps; dual take container reports ~**24 fps** — confirm active format / writer timescale.  
2. Audio is **AAC in CAF**, not raw PCM — charter prefers PCM for masters; change after vertical slice.  
3. Abrupt-kill files are **not playable** yet (`moov atom not found` on video; CAF incomplete). Bytes retained on disk; **recoverable decode** still needs short finalized segments or a kill-safe writer.  
4. 1h soak remains Stage 6 hardening.

### Commands used

```sh
cd native/capture-macos
./scripts/package-capture-core-app.sh
APP=.build/CaptureCore.app/Contents/MacOS/capture-core
$APP list-devices
# record with Brio + Yeti uniqueIds, maxDurationSec 15, 4K/30
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

## Next (Stage 2–4)

1. ~~Human dual short take~~ **Done**. ~~Kill recovery~~ **Done** (partial files, no finish marker).  
2. Re-verify live dual take after PCM + fps + fragment changes (short Terminal take).  
3. Package capture-core as Tauri externalBin sidecar for release builds.  
4. Later: 1h soak + failure matrix before ADR-004 → Accepted.

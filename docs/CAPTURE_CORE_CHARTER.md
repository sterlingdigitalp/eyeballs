# CaptureCore charter (revised)

**Audience:** implementation agent on an isolated `feature/capture-core` worktree  
**Authority:** [ADR-004](adr/ADR-004-capture-core-provisional.md), plan P3-A/B ([CAMERA_PRESENCE_PRESENTER_TWIN_BUILD_PLAN.md](../CAMERA_PRESENCE_PRESENTER_TWIN_BUILD_PLAN.md)), product feedback 2026-07-26  
**Status of coaching tree:** Phase 2/3 prototype work may be uncommitted; **do not implement CaptureCore in that dirty checkout.**

---

## Goal

Deliver a production-capable **Swift/AVFoundation CaptureCore** that:

- Is the **only** owner of camera + microphone in Dataset mode.
- Writes **durable masters** under Application Support (app-created, root-confined session dir).
- Emits **versioned JSONL protocol** events on stdout; diagnostics only on stderr.
- Supports **stop/ping/cancel** over stdin JSON lines within a **single process per recording**.
- Ends at **masters + timestamps + health**; no proxies/ASR/tracking inside CaptureCore.

Vertical slice before extensive hardening: **~30s app-driven record → validate → Rust SHA-256 → sealed incomplete/complete status.**

---

## Explicit non-goals (v1)

- Independent CLI `start-session` / `stop-session` as two process lifetimes.
- `AVCaptureMovieFileOutput` as the production writer.
- Auto-restart of a crashed recording.
- Full-rate MediaPipe coaching on the dataset path before transport benchmarks.
- Base64 frames as the permanent 15–30 fps analysis path without measurements.
- Loading multi-GB masters into JavaScript for hashing.

---

## Architecture decisions (locked unless Stage 0 falsifies)

| Topic | Decision |
|---|---|
| Language | Swift + AVFoundation (provisional) |
| Packaging | Tauri sidecar inside signed bundle |
| Process model | One process per recording |
| Control | stdin JSON lines: `stop`, `ping`, `cancel` |
| Events | stdout JSONL; stderr logs only |
| Video capture | `AVCaptureVideoDataOutput` |
| Audio capture | `AVCaptureAudioDataOutput` |
| Video encode | `AVAssetWriter` (hardware encode preferred) |
| Audio master | Separate PCM WAV/CAF via `AVAudioFile` (or equivalent) |
| Sync helper | Consider `AVCaptureDataOutputSynchronizer` where useful |
| Recovery | Prefer **immutable short segments** + continuity metadata |
| Crash policy | Incomplete + preserve segments; **no auto-restart** |
| Hashing | **Rust** streams SHA-256 over closed files (`sha2`) |
| Validation | Prefer AVFoundation inspection; `ffprobe` = CI/dev oracle |
| Device IDs | Dual binding: webview + `AVCaptureDevice.uniqueID` |

---

## Protocol v1 (sketch)

Every message (stdin command or stdout event):

```json
{
  "protocolVersion": "1.0.0",
  "sessionId": "uuid",
  "sequence": 1,
  "timestampUs": 0,
  "type": "health|state|error|segment_finalized|recording_finished|pong",
  "payload": {}
}
```

### Process entry

```text
capture-core record --request <request.json>
```

`request.json` includes: sessionId, sessionRoot path, AVFoundation camera/mic uniqueIDs, negotiated video (width/height/fps), audio sample rate/channels, segment policy, max duration optional.

### Stdin commands (JSON lines)

| type | meaning |
|---|---|
| `stop` | Graceful finalize current segment + stop session |
| `cancel` | Abort without claiming complete masters |
| `ping` | Reply `pong` with health snapshot |

### Stdout event types (minimum)

| type | purpose |
|---|---|
| `state` | `starting` → `recording` → `stopping` → `finished` / `failed` |
| `health` | drops, disk free, encoder queue, audio peak/silence flags |
| `segment_finalized` | path, index, duration, monotonic range |
| `recording_finished` | final paths, exit reason |
| `error` | stable error codes + message |
| `pong` | liveness |

Process **exits only after** writers finish or fail (deterministic exit codes: 0 success, non-zero coded failure).

`list-devices` remains a **separate short-lived** command (like CaptureProbe).

---

## Device binding schema (contracts work — Stage 1 prep)

Profiles today store webview `MediaDeviceInfo.deviceId`. CaptureCore needs AVFoundation IDs.

Target shape (implement on feature branch):

```ts
deviceBindings: {
  webviewCameraId?: string;
  avFoundationCameraId?: string;
  webviewMicrophoneId?: string;
  avFoundationMicrophoneId?: string;
}
```

Reconciliation UI/CLI: map by localized name + uniqueID from `capture-core list-devices` / CaptureProbe. Mapping is **Stage 0/1**, not discovered mid-UI integration.

---

## Recovery strategy

**Preferred:** immutable **short finalized segments** (e.g. N-minute or size-bounded) with:

- segment index
- monotonic start/end
- previous segment id
- partial session still reviewable after kill

A single open MOV that dies mid-write is **not** an acceptable sole recovery plan.

If fragmented MOV is chosen instead, Stage 0 must **prove** abrupt-kill decodability with evidence on disk.

---

## Preview / analysis transport (after vertical slice)

| Phase | Allowed |
|---|---|
| First vertical slice | CaptureCore owns master; **bounded low-rate JPEG preview** (e.g. 5–10 fps) OK for framing; dataset record may omit live MediaPipe |
| Before Dataset + full coaching | Benchmark: JPEG/ImageBitmap into webview vs shared memory / IOSurface; optional native analysis later |
| Forbidden as permanent design | Unmeasured base64-at-30fps Tauri events as the analysis pipeline |
| Always | No simultaneous webview ownership of the same camera in Dataset mode |

---

## Stages and exits

### 1. Repository and contract preparation — 1–2 days

- [x] Clean/isolate worktree: `feature/capture-core` (not the dirty Phase 2/3 tree).
- [x] Checkpoint coaching work elsewhere (commit or stash on its own branch).
- [x] Protocol v1 types (Rust + Swift shared JSON schema doc).
- [x] Device-binding schema PR.
- [x] Segment/recovery decision recorded in ADR-004 or spike notes.

**Exit:** branch exists; protocol + bindings documented; no coaching WIP mixed in. **MET.**

### 2. Native proof — 3–5 days

- [x] Brio 4K sample-buffer capture to disk (delivered ~24 fps; format advertises 30 — see Stage 0 notes).
- [x] Simultaneous Brio + Yeti.
- [x] Sample-level timestamps logged.
- [x] Hardware encode path confirmed (H.264 masters).
- [x] Sidecar packaging / TCC via packaged `CaptureCore.app` (Terminal parent).
- [x] Clean stop + process-kill recovery (10s segments: prior segment playable after SIGKILL).

**Exit:** evidence notes under `docs/benchmarks/` (or spike markdown); ADR-004 can move toward Accepted.  
**MET** — see `docs/benchmarks/CAPTURE_CORE_STAGE0.md` § Stage 2 complete (2026-07-26).

### 3. CaptureCore CLI — 1–2 weeks

- [x] Real state machine + writers (video/audio outputs as above).
- [x] JSONL protocol on stdin/stdout.
- [x] Segments/checkpoints.
- [x] Validation + deterministic exit codes.
- [x] Automated tests where possible (fixtures, dry-run multi-segment).

**Exit:** `capture-core record --request …` completes a scripted session without Tauri UI. **MET.**

### 4. Tauri vertical slice — ~1 week

- [x] Rust lifecycle supervisor (spawn, stdin stop, collect stdout, exit handling).
- [x] Explicit release of webview camera before start.
- [x] App-created root-confined session directory.
- [x] **30-second** app recording path → validate → **Rust SHA-256** on closed files (Dataset primary button; live when AV bound, dry-run software masters otherwise).
- [x] Orphan-session scan at startup (incomplete sessions + leftover processes).

**Exit:** one button in Dataset mode produces hashed masters on disk. **MET** (2026-07-26).  
Evidence: `scripts/dev/test-capture-core-stage4-vertical.sh`, cargo `stage4_vertical_slice_prepare_record_seal`, Dataset **Run vertical slice** button + seal gate. Live 30s uses the same path as Stage 2-proven CaptureCore when devices are bound.

### 5. Preview/analysis transport — 1–2 weeks

- [x] Measured low-rate preview first (≤5 fps JPEG file + `preview_frame` metrics).
- [x] Full-rate analysis path only after benchmark report (deferred; design recorded in Stage 5 notes).
- [x] Still no dual camera ownership (webview released; CaptureCore owns devices).

**Exit:** framing UX acceptable; optional coaching path designed with numbers. **MET** (2026-07-26).  
Evidence: `docs/benchmarks/CAPTURE_CORE_STAGE5_PREVIEW.md`, Dataset framing panel, dry-run `preview_frame` + `preview/latest.jpg`.

### 6. Hardening — 1–2 weeks

- [ ] Disk pressure, USB loss, Yeti mute/silence, force quit.
- [ ] Timestamp drift samples + correction **metadata** (derivatives later).
- [ ] 1h + segmented multi-hour soaks (static room OK).
- [ ] Recovery matrix + production ADR acceptance.

**Scaffolding (soak-ready):** unattended launcher, segment validator, honesty fields on finish/seal, matrix doc — see `docs/benchmarks/CAPTURE_CORE_STAGE6_MATRIX.md`.

**Exit:** soak + failure matrix documented; CaptureCore production ADR Accepted.

**Effort:** **5–8 focused weeks** typical; **4–6** if TCC/packaging and preview behave cleanly.

---

## Safe handoff checklist

1. Checkpoint Phase 2/3 coaching work (commit on `feature/coaching-prototype` or equivalent).
2. `git worktree add ../eyeballs-capture-core -b feature/capture-core <base>`.
3. Give the agent **this charter** + **ADR-004** + plan P3-A/B only.
4. Review **Stage 4 vertical slice** before authorizing Stage 5–6.
5. Do not merge CaptureCore into main until Stage 0 proof and vertical slice are reviewed.

---

## Relationship to existing code

| Asset | Role |
|---|---|
| `native/capture-macos` CaptureProbe / VisionBenchmark | Starting point for devices + Vision; **not** the recorder yet |
| ADR-002 | Phase 1 webview only — remains for coaching until Dataset mode switches |
| `packages/dataset` capture/finalize/av-sync TS | Domain scaffolding; **not** on-disk production finalizer |
| Tauri `sha2` dependency | Production file hashing |
| Webview MediaRecorder | Coaching/practice path until explicitly replaced |

---

## Success definition (minimum production)

CaptureCore is production-ready when:

1. Dataset mode never competes with webview for the same camera.
2. Studio sessions produce separate video + PCM audio masters with sample timestamps.
3. Abrupt kill leaves **recoverable** segments and an honest incomplete session.
4. Closed files are SHA-256 hashed in Rust and sealed in the session manifest.
5. Crashes never auto-resume as a continuous take.
6. 1h soak + disconnect/disk-full matrix has written evidence.

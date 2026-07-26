# ADR-004: Production CaptureCore (provisional)

Status: **Provisional** — Swift/AVFoundation sidecar selected pending Stage 0 native proof
Date: 2026-07-26
Supersedes for **dataset/production masters only**: [ADR-002](ADR-002-capture-spike.md) remains in force for Phase 1 webview measurement/coaching until CaptureCore is proven and wired.

## Context

Phase 1 uses webview `getUserMedia` + `MediaRecorder` (ADR-002). That path is correct for early tracker work but must not become the permanent dataset-master recorder without master quality, sample-level timestamps, recovery, and packaging proof.

Phase 3 P3-A requires a single native owner for camera and microphone, durable masters under Application Support, separate minimally processed audio when using Studio (Brio + Yeti), health telemetry, and atomic finalize with cryptographic hashes.

A full Rust↔AVFoundation bridge would introduce an FFI/full-frame boundary without existing implementation evidence in this repo. `native/capture-macos` already has AVFoundation probe/benchmark scaffolding.

## Decision (provisional)

1. **CaptureCore is a Swift binary** using **AVFoundation**, packaged and supervised as a **Tauri sidecar**.
2. **One sidecar process per recording** (not independent `start-session` / `stop-session` CLI processes that would lose in-memory state).
3. **Writers:** `AVCaptureVideoDataOutput` + `AVCaptureAudioDataOutput` + `AVAssetWriter` (video) + PCM file (`AVAudioFile` or equivalent) for audio masters — **not** `AVCaptureMovieFileOutput` as the production path.
4. **Recovery:** favor **immutable short finalized segments** with monotonic continuity metadata over a single open MOV that dies unreadable on process kill. Fragmented-MOV is only acceptable if Stage 0 proves abrupt-kill decodability.
5. **No automatic restart** after sidecar crash: mark incomplete, preserve recoverable segments, require explicit new recording.
6. **SHA-256 of closed files runs in Rust** (`sha2` already in the Tauri crate), streaming over disk — not multi-GB loads into the webview.
7. **Device identity:** profiles must bind **webview** device IDs and **AVFoundation `uniqueID`s** separately; they are not assumed equal.
8. **Preview/analysis transport is a separate measured spike** after the master vertical slice. Dataset capture may ship without full-rate MediaPipe on the master path first.
9. **CaptureCore ends at** masters, timestamps, health, and clean process exit. Proxy, ASR, offline tracking, quality, and curation remain **downstream workers**.

## Stage 0 proof required before “Accepted”

- Real 4K/30 Brio recording.
- Simultaneous Brio + Yeti recording.
- Sample-level timestamps on both streams.
- Hardware encoding path exercised.
- Sidecar packaging inside the signed Tauri bundle.
- Camera/microphone permission (TCC) behavior when launched as a child process.
- Clean stop and process-kill recovery behavior (segment strategy validated).

Only after that evidence should this ADR flip from Provisional to Accepted (or be revised).

## Consequences

- Dataset-mode UI must **release webview camera ownership** before CaptureCore starts (or never take it for that mode).
- Contracts need `deviceBindings` (or equivalent) for multi-provider IDs.
- TypeScript finalize/hash helpers remain domain scaffolding; production on-disk finalization is Rust + native writers.
- A CaptureCore agent must work on an **isolated branch/worktree**, not the dirty Phase 2/3 coaching checkout.

## Non-goals for CaptureCore v1

- Virtual camera output.
- OBS integration.
- Automatic resume of a failed take as one continuous session.
- Permanent base64/JPEG-at-30fps analysis pipeline without benchmarks.

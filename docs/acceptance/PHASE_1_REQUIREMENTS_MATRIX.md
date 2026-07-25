# Phase 1 requirements matrix

This matrix maps the Phase 1 build plan to current authoritative evidence. `Implemented` means the
code path exists; `Verified` means a named automated or observed runtime check covers it; `Open`
means acceptance evidence is still missing.

## P1-A — Repository foundation

| Requirement | Status | Evidence |
|---|---|---|
| Monorepo and branch policy | Verified | Git `main`; `docs/BRANCH_AND_RELEASE_POLICY.md` |
| Tauri 2 + React + TypeScript | Verified | Packaged `.app` launches from release bundle |
| Strict TypeScript and Rust linting | Verified | `npm run verify` |
| Shared contracts | Verified | Zod/TypeScript contracts under `packages/contracts` |
| SQLite migrations and repository | Verified | migration 001 and Rust round-trip/quick-check test |
| Structured correlated local logging | Implemented | daily JSONL tracing; session IDs in renderer events |
| Experimental feature flags | Verified | different-tracker comparison is disabled by default, requires an explicit persisted flag, and has parser/default tests |
| Non-private deterministic fixtures | Verified | synthetic calibration/features in tests plus an 8-second, 1280×720/30, 48 kHz mono A/V timing fixture with a reproducible hash and no person or voice |
| CI | Verified mechanically | `.github/workflows/ci.yml` runs dependency/config validation, lint, typecheck, tests, web/Rust/Swift builds, and a signed local app packaging smoke test |
| ADR directory | Verified | stack, capture, and tracker ADRs |
| Threat model before recording | Verified | `docs/privacy/THREAT_MODEL.md` predates recording acceptance |
| No device access at launch | Observed | current signed bundle launch smoke on 2026-07-25 showed explicit camera/microphone prompt states and an off preview; no permission prompt or device activation occurred; validated CSP permits no external HTTPS resources |

## P1-B — Device and permission layer

| Requirement | Status | Evidence |
|---|---|---|
| Enumerate cameras/microphones with stable IDs | Verified | AVFoundation inventory and browser device service |
| Display model information where available | Verified | device labels/profile cards; native inventory |
| Clear camera permission | Observed | separate packaged-app control and usage description |
| Separate microphone permission | Observed | separate packaged-app control and usage description |
| Denied/revoked/busy/missing recovery | Verified | deterministic error mapping tests |
| Attach/detach while open | Verified mechanically | `devicechange`, explicit track-ended recovery, profile-switch stream release, and stop-all-tracks test |
| Profile create/edit | Verified mechanically | Setup supports create/edit, disconnected-device visibility, explicit camera-only profiles, and 720p30/1080p30/1080p60/4K30 requests; every create/select/edit transition releases old streams before new hardware can be enabled |
| Seed MacBook/Studio suggestions after matching | Verified | profile-matching tests |
| Record negotiated video/audio settings | Implemented | `MediaStreamTrack.getSettings()` persistence plus a local live dBFS meter for mute/signal/gain checks |
| Never assume requested mode | Verified | actual settings are stored separately from requested |
| MacBook devices | Hardware verified | native inventory |
| Brio device and target modes | Hardware verified | 4K/30, 1080p/60, accepted 77-second 4K check |
| Yeti device and sample flow | Hardware verified | 48 kHz/16-bit inventory and discard-only sample check |
| Simultaneous Brio + Yeti Studio profile | Open | devices were tested sequentially, not together |
| In-app permissions and negotiated settings | Verified for MacBook | packaged app reports both permissions granted, displays a live preview, shows 1920×1080/30, and persists that mode plus 48 kHz mono audio in SQLite |

## P1-C — Capture spike

| Requirement | Status | Evidence |
|---|---|---|
| Webview prototype | Verified | integrated preview/analysis/MediaRecorder path |
| Swift AVFoundation helper | Verified | `capture-probe` builds and runs |
| Rust bridge feasibility | Decided | rejected for Phase 1 in capture ADR; no benefit to live webview path |
| Time to first frame/preview latency | Verified for MacBook | packaged profile diagnostics: 8 ms warm; 10.76 s including renewed user approval |
| Stability and target formats | Verified as accepted | Brio short modes and owner-accepted 77-second 4K run |
| Timestamp access | Verified | monotonic frame features and AVFoundation media timestamps |
| Microphone synchronization | Open | requires recorded in-app A/V test |
| Frame drops | Implemented | video playback quality stored in manifest; live evidence pending |
| Packaging/signing difficulty | Verified for local validation | `npm run package:app` produces an ad-hoc signed bundle that passes strict `codesign` and plist verification; Developer ID signing/notarization is later release work |
| Production-path ADR | Verified | `ADR-002-capture-spike.md` and capture benchmark |

## P1-D — Tracking benchmark

| Requirement | Status | Evidence |
|---|---|---|
| Apple Vision prototype | Verified | `vision-benchmark` builds |
| MediaPipe prototype | Verified | local WASM/model integrated behind `TrackingProvider` |
| Same feature contract/versioning | Verified | provider/model IDs in calibration and predictions |
| Same labeled corpus | Open | needs user-approved live/recorded samples |
| Detection, stability, latency, blink/reflection metrics | Implemented harness | shared human corpus still required |
| Primary-provider selection report | Provisional | MediaPipe selected conditionally; final human benchmark open |

## P1-E — Calibration wizard

| Requirement | Status | Evidence |
|---|---|---|
| Purpose explanation | Observed | current signed bundle exposes Calibration in primary navigation and correctly gates it on camera setup |
| Framing/light/face preflight | Verified mechanically | measured luma test plus live face-scale/confidence gates |
| Profile-specific lens anchor | Implemented | click-adjustable and fingerprinted |
| Lens, negative, head/eye samples | Verified mechanically | 13-step guided protocol covers relaxed/speaking lens, near lens, screen/notes/left/right/above/self-preview, and three head/eye disambiguation poses |
| Hidden holdout validation | Verified | separate randomized 11-target validation pass; legacy deterministic split remains available only for audit/reprocessing |
| Quality report/save-or-repeat | Verified mechanically | 85% overall, 80% physical-lens, 70% per-target, sample-count, and stability gates; weak targets can be recaptured without discarding good targets |
| Raw normalized samples | Verified | stored in calibration |
| Per-target quality | Implemented | target score/usable ratio/warnings |
| Insufficient variation/tracking instability | Verified | calibration-quality tests |
| Quick future-launch verification | Implemented | short lens recheck against saved model |
| Setup notes | Implemented | optional profile/calibration notes |
| Invalidation/revalidation | Verified | profile/format/lens/tracker fingerprint tests |
| Real MacBook and Brio calibrations | In progress | Brio run four passed its then-current v1.1 gate at 94.0%; the stricter v1.2.1 audit scores 91.7% overall but 70% at the physical lens, so it is correctly ineligible and the new independent-validation protocol still needs a human rerun; MacBook needs its first calibration |

## P1-F — Personalized classifier

| Requirement | Status | Evidence |
|---|---|---|
| Versioned feature vector | Verified | schema and parsing tests |
| Training/holdout split | Verified | calibration tests |
| Per-frame confidence and class probabilities | Verified | classifier normalization tests and hidden live diagnostics |
| Temporal smoothing/hysteresis | Verified | sustained-transition tests |
| Blink suppression | Verified | blink remains prior stable state |
| Explicit unknown | Verified | low-confidence/face-loss tests plus a media-clock watchdog that stops duplicate-frame analysis and emits unknown when camera frames stall |
| Gaze-break/recovery events | Verified | event-builder tests |
| Algorithm version on results | Verified | prediction contract |
| Offline reprocessing/version comparison | Implemented | every new session checkpoints its exact calibration snapshot; `npm run reprocess` uses the embedded snapshot by default, rejects tracker mismatches, and Review imports validated comparison output |
| Personalized held-out accuracy ≥85% on both profiles | Open | requires user labels |
| False cues <1/minute | Open | requires known-contact labels |

## P1-G — Live measurement UI

| Requirement | Status | Evidence |
|---|---|---|
| Preview, lens anchor, state halo, confidence warning | Implemented | current signed bundle Setup screen rendered the off-preview lens target and profile controls without device activation |
| Start/stop test without live score | Implemented | Test screen |
| Hidden diagnostics | Implemented | confidence, per-class probabilities, eye/head features, 60-frame latency graph, live dropped frames, calibration, and provider/model |
| Dropped-frame count | Implemented | manifest from playback quality |
| Live Brio/MacBook behavior | Open | requires user-controlled calibration |

## P1-H — Test recording and event log

| Requirement | Status | Evidence |
|---|---|---|
| Monotonic timestamps | Verified | contracts and synthetic tests |
| Session manifest/tracking features/events | Implemented | serialized five-second checkpoints plus immediate initial, visibility-change, page-hide, finalizing, and terminal writes; the interval limits repeated full-session serialization and the tested queue prevents older overlapping writes from replacing newer evidence |
| Abrupt-stop recovery | Verified mechanically | five-second/visibility checkpoints, native/browser checkpoint merge, recording/finalizing recovery tests, recorder start/stop/error guards, and persistence-failure invalidation; forced-kill UI evidence remains open |
| Empty/failed recording cannot be complete | Verified | finalization tests |
| Incomplete status visible | Implemented | Review session list |
| Playback aligned with predictions | Verified mechanically | recorder-start monotonic origin, actual decoded duration when available, time-based prediction lookup/segment tests, clickable timeline, synchronized playhead, and state/confidence overlay |
| Recorded in-app A/V test | Open | video-only operation and missing-microphone warning are implemented; synchronized A/V evidence requires explicit user Record action |

## P1-I — Ground-truth review

| Requirement | Status | Evidence |
|---|---|---|
| Playback and contact overlay/timeline | Implemented | Review |
| Blind labeling | Implemented | prediction timeline concealment |
| Interval labels | Implemented | append-only correction form |
| Export labels | Implemented | JSON export |
| Confusion matrix/event timing/false-cue rate | Verified mechanically | evaluation tests and UI metrics include agreement, decision coverage, break/recovery latency, missed transitions, and false cues per labeled minute |
| Compare versions | Implemented | reprocess CLI and comparison import |
| False-cue annotations | Implemented | correction notes |
| Preserve original predictions | Verified | corrections stored separately |
| Human-labeled review run | Open | requires user participation |

## Exit criteria

| Criterion | Status |
|---|---|
| Both profiles selectable and previewable | Open: simultaneous Studio pairing and in-app preview |
| Independent calibration for each profile | Open: user calibration |
| Held-out accuracy gate | Open: user labels |
| Low false-cue rate | Open: user labels |
| Blinks do not become breaks | Verified mechanically; human confirmation open |
| Low confidence becomes unknown | Verified mechanically; live confirmation open |
| User can inspect/correct predictions | Implemented; current signed bundle Review screen renders cleanly, human run open |
| Reproducible tracker/classifier versions | Verified; pinned IDs/versions and asset/executable hashes in `BUILD_MANIFEST.md` |
| Written backend benchmark | Provisional pending human corpus |
| Interrupted session recoverable or invalid | Verified mechanically: readable manifests survive malformed evidence as visible invalid sessions, interrupted status updates are isolated per session, and forced-kill UI confirmation remains open |

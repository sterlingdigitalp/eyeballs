---
title: "Camera Presence Coach & Presenter Twin — Complete Build Plan"
version: "1.1"
date: "2026-07-25"
last_progress_update: "2026-07-26"
status: "Phase 1 engineering largely complete (hardware acceptance open); Phase 2 integrated coaching prototype under MVP hardening; Phase 3 domain scaffolding/UI prototype on this branch. CaptureCore is implemented through Stage 5 on feature/capture-core; Stage 6 hardware hardening and soaks are in progress"
platform_priority: "macOS first, local-first"
working_product_name: "Camera Presence Coach"
---

# Camera Presence Coach & Presenter Twin
## Complete Build Plan for Phases 1–6

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Product definition](#2-product-definition)
3. [End-to-end user experience](#3-end-to-end-user-experience)
4. [Hardware and capture profiles](#4-hardware-and-capture-profiles)
5. [Functional requirements](#5-functional-requirements)
6. [Non-functional requirements and product targets](#6-non-functional-requirements-and-product-targets)
7. [Recommended system architecture](#7-recommended-system-architecture)
8. [Data architecture](#8-data-architecture)
9. [Camera-contact measurement design](#9-camera-contact-measurement-design)
10. [Coaching-system design](#10-coaching-system-design)
11. [Phase-by-phase implementation plan](#11-phase-by-phase-implementation-plan)
    - [Phase 1 — Measurement kernel](#phase-1--measurement-kernel)
    - [Phase 2 — Coaching MVP](#phase-2--coaching-mvp)
    - [Phase 3 — Dataset engine](#phase-3--dataset-engine)
    - [Phase 4 — Presenter-twin proof](#phase-4--presenter-twin-proof)
    - [Phase 5 — Local generation adapter](#phase-5--local-generation-adapter)
    - [Phase 6 — Personal motion, expression, voice, and real-time expansion](#phase-6--personal-motion-expression-voice-and-real-time-expansion)
12. [Cross-cutting implementation requirements](#17-cross-cutting-implementation-requirements)
13. [Testing and quality strategy](#18-testing-and-quality-strategy)
14. [Suggested repository structure](#19-suggested-repository-structure)
15. [Parallel workstreams and ownership](#20-parallel-workstreams-and-ownership)
16. [Milestone roadmap and dependency graph](#21-milestone-roadmap-and-dependency-graph)
17. [Risk register](#22-risk-register)
18. [Definition of done](#23-definition-of-done-by-product-capability)
19. [Initial implementation backlog](#24-initial-implementation-backlog)
20. [Decisions at phase gates](#25-decisions-to-make-at-phase-gates)
21. [Final recommended build order](#26-final-recommended-build-order)
22. [Reference baseline](#27-reference-baseline)

---

## 1. Executive summary

This application is one interconnected product with two outcomes:

1. **It coaches the real presenter to maintain natural camera contact while speaking.**
2. **It converts approved practice footage into a structured, user-owned dataset for generating future presenter clips.**

The product loop is:

```text
TRAIN → REVIEW → CURATE → GENERATE
   ↑                           │
   └──── learn from results ───┘
```

The coaching system improves the source performance. Better source performance improves the presenter-twin dataset. Generated clips reveal remaining weaknesses in gaze, expression, cadence, movement, or visual consistency, which can inform the next real training session.

The initial product should remain deliberately narrow:

- macOS desktop application first;
- one primary user;
- seated, head-and-shoulders presentation;
- calibrated webcam camera-contact estimation rather than laboratory-grade eye tracking;
- local recording and processing by default;
- explicit human approval before any clip enters a training dataset;
- presenter-twin output before any attempt at a general-purpose full-body digital human;
- recorded clips before real-time avatar streaming;
- real voice plus generated video before optional voice cloning;
- provider-neutral generation rather than dependence on one model or vendor.

The recommended technical shape is a **Tauri 2 desktop shell with a React/TypeScript interface**, a **native macOS capture layer built around AVFoundation**, a local **SQLite metadata store**, immutable media files on disk, local transcription and media workers, and a replaceable generation-provider interface. Tauri supports external binaries as sidecars, which makes it suitable for packaging a native capture helper and Python/MLX workers without forcing all computation into the webview.[^tauri-sidecar]

### 1.1 The six phases

| Phase | Outcome | Release gate |
|---|---|---|
| 1. Measurement kernel | Reliable, personalized camera-contact measurement | The app agrees with human labels often enough to coach without becoming distracting |
| 2. Coaching MVP | A useful training and review product | Repeated sessions demonstrate measurable improvement and low-friction use |
| 3. Dataset engine | Approved sessions become model-ready assets | Every dataset asset is traceable, versioned, consented, and exportable |
| 4. Presenter-twin proof | Controlled A/B evidence that coached footage improves generated output | A coached source package materially outperforms an uncoached package |
| 5. Local generation adapter | Script/audio-to-candidate workflow inside the app | Local or external providers can be swapped without changing the product data model |
| 6. Personal motion and voice | More complete personalization and optional live output | Voice, motion, appearance, and real-time features each pass separate quality and safety gates |

### 1.2 Product principles that must not be compromised

1. **Camera contact, not personality diagnosis.** The app may report where the eyes and head were oriented. It must not infer confidence, honesty, insecurity, attention disorders, or mental state.
2. **Natural contact, not robotic staring.** Blinks and short purposeful glances are normal. Coaching should reward return-to-lens behavior and deliberate emphasis rather than demand 100% uninterrupted contact.
3. **The physical lens is the target.** Prompts must remain immediately adjacent to the lens whenever possible; otherwise the app teaches screen contact rather than camera contact.
4. **Original media is immutable.** Corrections, proxies, clips, and model inputs are derived assets. The original approved recording is never destructively edited.
5. **Nothing trains automatically.** Recording permission, dataset inclusion, face-model use, voice-model use, cloud export, and publishing are separate decisions.
6. **Human judgment outranks automatic quality scores.** The system proposes clips; the user approves, rejects, or deletes them.
7. **Local-first and provider-neutral.** The app must remain useful without a subscription or cloud service. Cloud generation is an optional adapter.
8. **Data quality beats indiscriminate volume.** Ten diverse, clean, approved hours are more valuable than fifty repetitive, mixed-quality hours.
9. **Generated media remains identifiable as generated.** Export manifests and, when practical, Content Credentials should preserve provenance.[^c2pa]
10. **Build the coaching product before model ambition expands.** The first proof is that the app can measure and improve real camera presence.

---

## 2. Product definition

### 2.1 Part 1: Camera-presence coaching

During a training session, the application will:

- select a camera and microphone profile;
- check framing, lighting, face visibility, audio level, and background noise;
- load or request a camera-specific calibration;
- present a speaking exercise near the webcam lens;
- estimate camera contact continuously;
- provide restrained, configurable feedback after meaningful gaze drift;
- record the session only after explicit authorization;
- preserve synchronized video, audio, tracking, prompt, and timing data;
- generate a review timeline;
- let the user verify or correct the system’s interpretation;
- track progress across comparable sessions.

The coaching progression is:

1. **Lens familiarization:** relaxed looking, blinking, and breathing.
2. **Lens-adjacent reading:** one-line text immediately beneath the lens.
3. **Prompted response:** see a question, then answer without reading.
4. **Presentation rehearsal:** deliver prepared material while consulting notes sparingly.
5. **Simulated livestream:** respond to interruptions or comments and return to the lens.
6. **Live assist:** use a private HUD while presenting through another application.

### 2.2 Part 2: Presenter-twin dataset and generation

For sessions that receive explicit dataset permission, the application will:

- retain the original master recording;
- create analysis proxies;
- transcribe speech with timestamps;
- extract facial landmarks, head pose, expressions, and camera-contact events;
- identify candidate clips;
- score technical quality without automatically approving anything;
- let the user label clips as excellent, usable, coaching-only, rejected, or delete;
- track dataset coverage and duplication;
- version approved collections;
- export model-ready packages;
- generate short, head-and-shoulders presenter candidates from text or audio;
- compare generated output against the real source and prior candidates;
- preserve the lineage from source clips to model/adaptor to generated output.

### 2.3 The compounding loop

```text
Real speaking session
        ↓
Personalized gaze measurement
        ↓
Coaching and human review
        ↓
Approved high-quality clips
        ↓
Structured presenter dataset
        ↓
Generated presenter candidates
        ↓
Human review of likeness, gaze, motion, and voice
        ↓
New targeted coaching drills and capture needs
```

Examples of feedback from generation back into coaching:

- A generated avatar looks stiff because source footage lacks subtle head movement.
- Lip sync is weak on particular sounds, so the next capture session improves phonetic coverage.
- The dataset contains only neutral delivery, so the app requests persuasive and enthusiastic material.
- Eye contact is generally strong but sentence endings drift downward, so a drill targets sentence completion.
- A particular outfit or lighting setup creates unstable identity, so it is removed from the preferred look set.

### 2.4 Primary use cases

| Use case | Capture profile | Recording expectation | Output |
|---|---|---|---|
| Five-minute daily practice | MacBook Practice | Optional | Coaching metrics and progress |
| Formal rehearsal | Either profile | Usually on | Review timeline and selected clips |
| Studio dataset session | Studio Capture | Required | High-quality approved source package |
| Simulated livestream | Either profile | Optional | Recovery and divided-attention metrics |
| Live presentation assist | Current presentation camera | Off by default | Private real-time HUD |
| Presenter clip generation | No live camera required | Uses prior assets | Multiple candidate videos |
| Voice dataset capture | Studio Capture | Required and separately consented | Versioned voice corpus |

### 2.5 Explicit non-goals for the first releases

- diagnosing anxiety, confidence, deception, or mental health;
- claiming exact gaze coordinates comparable to dedicated eye-tracking hardware;
- correcting the user’s eyes in the outgoing real video feed;
- building a full-body, arbitrary-angle digital human from frontal webcam footage;
- autonomous publishing;
- automatically uploading all sessions;
- automatically training on rejected or unreviewed material;
- training a foundation video model from scratch;
- real-time generated avatar output before offline quality is strong;
- multi-tenant enterprise administration;
- mobile support before the macOS product is validated.

---

## 3. End-to-end user experience

### 3.1 The four primary screens

#### Train

- camera preview;
- tiny lens-adjacent prompt region;
- exercise name and goal;
- subtle contact halo;
- optional spoken or haptic/audio cue;
- elapsed time;
- recording state;
- one-click pause and stop;
- no dense analytics while speaking.

#### Review

- synchronized video playback;
- transcript;
- camera-contact timeline;
- gaze breaks and recovery markers;
- speaking sections and silence;
- system confidence;
- manual correction controls;
- clip in/out selection;
- session notes;
- compare with prior session.

#### Dataset

- approved clip library;
- coverage map;
- duplicate and near-duplicate warnings;
- quality flags;
- consent state;
- dataset versions;
- source lineage;
- storage use;
- export packages;
- delete and revoke controls.

#### Generate

- text script or uploaded/recorded audio;
- voice choice: real recording, approved cloned voice, or no voice;
- appearance/look selection;
- generation provider selection;
- candidate grid;
- side-by-side synchronized comparison;
- quality rubric;
- approve, reject, regenerate, or export;
- provenance summary.

### 3.2 Training-session lifecycle

```text
Select profile
   ↓
Permission and device preflight
   ↓
Framing / lighting / audio check
   ↓
Load or perform calibration
   ↓
Choose drill and feedback intensity
   ↓
Optional recording consent
   ↓
Countdown
   ↓
Speak with restrained live coaching
   ↓
Stop and finalize media safely
   ↓
Background analysis
   ↓
Review, correct, label, and reflect
   ↓
Optional dataset promotion
```

### 3.3 Generation lifecycle

```text
Choose script or audio
   ↓
Choose dataset version and appearance
   ↓
Confirm face/voice permissions
   ↓
Validate source coverage and input quality
   ↓
Create generation job
   ↓
Render multiple candidates
   ↓
Compare and score
   ↓
Approve or reject
   ↓
Attach provenance and export
```

### 3.4 Session-state machine

```text
IDLE
  → PREFLIGHT
  → CALIBRATING (when required)
  → READY
  → COUNTDOWN
  → RECORDING or PRACTICING
  → PAUSED
  → FINALIZING
  → ANALYZING
  → REVIEW_READY
  → REVIEWED
  → ARCHIVED
```

Failure states:

```text
DEVICE_LOST
PERMISSION_DENIED
CAPTURE_DEGRADED
DISK_LOW
FINALIZATION_FAILED
ANALYSIS_FAILED
RECOVERY_REQUIRED
```

Every failure state needs a deterministic recovery action. A capture failure must never silently produce a supposedly valid dataset asset.

---

## 4. Hardware and capture profiles

The application must support the two existing setups as first-class profiles rather than treating one as merely a fallback.

### 4.1 Profile A — MacBook Practice

**Purpose:** low-friction daily training, travel, initial development, and spontaneous rehearsal.

```yaml
profile_name: MacBook Practice
camera: Built-in MacBook Pro camera
microphone: Built-in MacBook Pro microphone array
recording_target: 1080p
analysis_target: 15–30 analyzed frames per second
camera_contact_calibration: required and profile-specific
center_stage: disabled
voice_processing: off for dataset capture; user-selectable for calls
```

Advantages:

- no cables or external-device failures;
- easiest path to frequent practice;
- built-in camera and microphone remain synchronized within the same device pipeline;
- excellent baseline for Phase 1 development;
- lower storage and thermal load.

Limitations:

- the physical camera position is tied to the display position;
- the laptop must be raised so the lens sits at seated eye height;
- the built-in camera’s outgoing recording resolution is lower than the Brio’s 4K mode;
- automatic reframing must be disabled because changing the crop undermines calibration and framing analysis.

Apple’s current MacBook Pro specification describes a 12MP Center Stage camera with 1080p recording and a three-microphone array; the exact computer should still be enumerated at runtime rather than hard-coded.[^apple-mbp]

### 4.2 Profile B — Studio Capture

**Purpose:** formal assessment, high-quality presenter-dataset sessions, polished livestreams, and generation source footage.

```yaml
profile_name: Studio Capture
camera: Logitech Brio 4K, model V-U0040
microphone: Blue/Logitech Yeti, model A00132
master_video: 4K at 30 fps when stable
analysis_proxy: 720p or 1080p at 15–30 analyzed fps
alternate_live_mode: 1080p at 60 fps
field_of_view: 65° preferred; 78° when gestures need more room
microphone_pattern: cardioid
microphone_format: 48 kHz, 16-bit as exposed by the device
camera_contact_calibration: required and profile-specific
```

Logitech identifies V-U0040 as the Brio/Brio 4K and lists 4K/30, 1080p/60, and 65°/78°/90° field-of-view modes.[^brio-specs] The Yeti manual identifies the front as the Blue-logo side, recommends cardioid for voice work, and specifies 48 kHz/16-bit capture.[^yeti-manual]

Recommended physical setup:

- lens centered at seated eye height;
- camera approximately 24–36 inches from the face, adjusted for framing;
- 65° field of view for face-forward presentation;
- 78° only when upper-body gesture coverage is intentionally needed;
- microphone 6–10 inches from the mouth;
- Blue-logo side facing the speaker;
- microphone 20–45° off-axis to reduce plosives and keep the face unobstructed;
- cardioid mode;
- low enough gain to preserve headroom;
- boom arm or isolated stand where practical;
- soft frontal or 30–45° key light;
- stable background and repeatable chair position;
- camera and microphone connected directly when USB-hub reliability is uncertain.

### 4.3 Recording modes within the Studio profile

#### Coaching mode

- 1080p/60 when the camera and thermal budget are stable;
- lower-latency preview;
- detailed blink and recovery analysis;
- recording optional.

#### Dataset mode

- 4K/30 master;
- fixed field of view;
- fixed position;
- manual or locked exposure, white balance, and focus after setup when supported;
- raw or minimally processed Yeti track;
- no destructive vocal effects;
- no auto-framing;
- high-quality HEVC master unless a specific downstream model requires another codec.

### 4.4 Separate calibration is mandatory

A calibration belongs to a specific combination of:

- camera hardware identifier;
- lens position;
- resolution and crop;
- field of view and software zoom;
- camera-to-face distance range;
- user seating position;
- display/prompt geometry;
- optional glasses state if tests show a meaningful difference;
- tracker backend and model version.

The app must invalidate or warn about calibration after:

- camera change;
- field-of-view or digital-zoom change;
- camera remounting;
- major display movement;
- face-size change beyond the calibrated range;
- tracking model update;
- repeated low-confidence measurements;
- explicit user request.

### 4.5 Hardware profile record

```json
{
  "id": "capture_profile_uuid",
  "name": "Studio Capture",
  "camera_device_id": "runtime-stable-device-id",
  "camera_model": "Logitech Brio V-U0040",
  "microphone_device_id": "runtime-stable-device-id",
  "microphone_model": "Yeti A00132",
  "master_video": {
    "width": 3840,
    "height": 2160,
    "fps": 30,
    "codec": "hevc",
    "fov_degrees": 65
  },
  "analysis_video": {
    "width": 1280,
    "height": 720,
    "target_fps": 20
  },
  "audio": {
    "sample_rate_hz": 48000,
    "bit_depth": 16,
    "channels": 1,
    "processed": false
  },
  "calibration_id": "calibration_uuid",
  "created_at": "ISO-8601",
  "last_verified_at": "ISO-8601"
}
```

### 4.6 Device preflight

Before every recorded session, the app should verify:

- selected devices are still present;
- requested resolution and frame rate are actually active;
- face is visible and large enough for analysis;
- camera frame rate is stable;
- microphone is not muted;
- average speech level is healthy;
- peaks are not clipping;
- background noise is below the user’s accepted threshold;
- free disk capacity covers the planned session plus safety margin;
- no other application has taken exclusive control;
- automatic reframing is off;
- the loaded calibration matches the active profile;
- recording consent and dataset intent are clear.

---

## 5. Functional requirements

### 5.1 Capture and device management

- **FR-CAP-001:** enumerate built-in and external cameras and microphones.
- **FR-CAP-002:** save named hardware profiles.
- **FR-CAP-003:** preview the active camera before recording.
- **FR-CAP-004:** expose only settings the device actually supports.
- **FR-CAP-005:** record high-quality master media and a lower-resolution analysis path.
- **FR-CAP-006:** timestamp video frames and audio samples from capture time.
- **FR-CAP-007:** detect device removal, camera stalls, dropped frames, and audio discontinuities.
- **FR-CAP-008:** finalize safely after normal stop, app crash, or device loss.
- **FR-CAP-009:** preserve an unprocessed audio master for dataset-approved sessions.
- **FR-CAP-010:** provide storage estimates before long recordings.

### 5.2 Calibration and camera-contact measurement

- **FR-GAZE-001:** perform a personalized calibration for each camera profile.
- **FR-GAZE-002:** classify at minimum `contact`, `near_lens`, `off_lens`, and `unknown`.
- **FR-GAZE-003:** preserve tracker confidence and never convert low confidence into a negative judgment.
- **FR-GAZE-004:** ignore ordinary blinks and tolerate short micro-glances.
- **FR-GAZE-005:** use temporal smoothing and hysteresis to avoid flicker.
- **FR-GAZE-006:** record raw features or normalized landmarks needed for offline reanalysis.
- **FR-GAZE-007:** let the user correct classifications during review.
- **FR-GAZE-008:** version every scoring algorithm and calibration.
- **FR-GAZE-009:** derive gaze-break and recovery events from configurable policy.
- **FR-GAZE-010:** never report emotion or personality as a measured fact.

### 5.3 Coaching

- **FR-COACH-001:** support the six progressive training modes.
- **FR-COACH-002:** display text immediately adjacent to the physical lens.
- **FR-COACH-003:** provide configurable feedback intensity.
- **FR-COACH-004:** avoid correcting during blinks, uncertain tracking, or a feedback cooldown.
- **FR-COACH-005:** support session goals and drill completion.
- **FR-COACH-006:** show review metrics and event-linked playback.
- **FR-COACH-007:** compare like-for-like sessions over time.
- **FR-COACH-008:** generate targeted next-drill recommendations from observed behavior.
- **FR-COACH-009:** provide a private always-on-top live-assist HUD.
- **FR-COACH-010:** keep the outgoing clean camera feed free of coaching graphics.

### 5.4 Dataset curation

- **FR-DATA-001:** require explicit dataset promotion.
- **FR-DATA-002:** transcribe and segment approved sessions.
- **FR-DATA-003:** propose clean candidate clips.
- **FR-DATA-004:** support `excellent`, `usable`, `coaching_only`, `rejected`, and `delete` labels.
- **FR-DATA-005:** track technical quality and content coverage separately.
- **FR-DATA-006:** identify duplicate and near-duplicate material.
- **FR-DATA-007:** version datasets as immutable manifests.
- **FR-DATA-008:** trace every dataset asset to its source recording and consent.
- **FR-DATA-009:** export a portable package with media, transcript, metadata, hashes, and manifest.
- **FR-DATA-010:** revoke assets and produce a new dataset version without them.

### 5.5 Generation

- **FR-GEN-001:** accept text or recorded/uploaded audio.
- **FR-GEN-002:** support real voice before cloned voice.
- **FR-GEN-003:** select dataset version, look, provider, and settings explicitly.
- **FR-GEN-004:** produce multiple candidates per job.
- **FR-GEN-005:** preserve input, model, settings, seed where available, and output lineage.
- **FR-GEN-006:** support local and cloud adapters behind one interface.
- **FR-GEN-007:** let the user compare candidates synchronously.
- **FR-GEN-008:** never publish automatically.
- **FR-GEN-009:** attach a generated-media manifest and optional C2PA credential.
- **FR-GEN-010:** enforce separate voice permissions.

---

## 6. Non-functional requirements and product targets

These are engineering targets, not claims about the completed system.

| Area | Target |
|---|---|
| Offline operation | Training, review, curation, and local processing work without internet after dependencies/models are installed |
| Live feedback latency | Preferably under 150 ms from captured frame to visible cue; never so delayed that feedback refers to a past behavior |
| Analysis rate | 15–30 analyzed frames per second is sufficient; master recording frame rate may be higher |
| Recording integrity | No silent media corruption; every recording has validation and a finalization status |
| A/V synchronization | Corrected output should remain perceptually synchronized; measure and report drift rather than assuming none |
| Crash recovery | Interrupted recordings recover to the last valid media boundary where technically possible |
| Data durability | SQLite transactions plus atomic manifest writes; immutable originals with hashes |
| Privacy | No upload without a specific, visible action and destination |
| Explainability | Every metric links to observable timeline evidence |
| Accessibility | Full keyboard operation, scalable text, screen-reader labels, high-contrast option, no color-only state |
| Storage transparency | Preflight estimate, live use display, archive policy, and user-controlled deletion |
| Thermal behavior | Degrade analysis resolution before compromising master recording integrity |
| Provider resilience | Generation provider failure cannot corrupt the dataset or block coaching |
| Reproducibility | Algorithm, model, calibration, dataset, and generation versions are recorded |

### 6.1 Measurement release targets

The Phase 1 benchmark should define final thresholds, but a sensible initial gate is:

- at least **85% agreement** with user-verified `contact` versus `not_contact` labels on held-out clips from both hardware profiles;
- fewer than **one false corrective cue per minute** during a known-contact drill;
- blinks should not create reportable gaze breaks;
- meaningful down-to-notes and side-screen glances should be detected consistently;
- `unknown` must be used instead of guessing under occlusion, glare, or tracking loss;
- performance must remain stable across at least three sessions after calibration.

If these targets are not met, Phase 2 should not add more coaching features. Phase 1 should iterate on calibration, camera placement, feature engineering, or tracker choice.

---

## 7. Recommended system architecture

### 7.1 High-level architecture

```text
┌────────────────────────────────────────────────────────────┐
│ Tauri 2 Desktop Application                               │
│                                                            │
│  React/TypeScript UI                                       │
│  ├─ Train                                                  │
│  ├─ Review                                                 │
│  ├─ Dataset                                                │
│  └─ Generate                                               │
│                                                            │
│  Rust Application Core                                     │
│  ├─ Session state machine                                  │
│  ├─ SQLite repositories                                    │
│  ├─ Consent and audit service                              │
│  ├─ Job orchestration                                      │
│  └─ IPC / sidecar supervision                              │
└──────────────┬───────────────────────────┬─────────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ Native macOS CaptureCore │   │ Local Analysis Workers       │
│ AVFoundation             │   │                              │
│ Apple Vision / selected  │   │ FFmpeg media pipeline        │
│ live tracker             │   │ MLX-Whisper transcription    │
│                          │   │ Offline face analysis        │
│ Camera + mic ownership   │   │ Quality and segmentation     │
│ Master encoding          │   │ Dataset coverage             │
│ Preview / timestamps     │   │ Generation workers           │
└──────────────┬───────────┘   └──────────────┬───────────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
                  ┌────────────────────────┐
                  │ Local Data Layer       │
                  │ SQLite metadata        │
                  │ Immutable media files  │
                  │ Versioned manifests    │
                  │ Models and adapters    │
                  └────────────────────────┘
```

### 7.2 Why the camera should have one owner

The production design should avoid having the UI, recorder, OBS, and analysis worker independently open the same camera. One native capture owner should:

- acquire the camera and microphone;
- produce the clean master stream;
- provide a lower-resolution preview/analysis stream;
- attach monotonic timestamps;
- expose health and dropped-frame telemetry;
- provide the clean output path needed later for a virtual camera.

This prevents competing settings, inconsistent crops, and device contention.

### 7.3 Native capture layer

AVFoundation’s capture session is Apple’s standard foundation for coordinating media capture inputs and outputs on macOS.[^avfoundation]

The implementation should begin with a short architectural spike comparing:

1. a Swift capture helper launched as a Tauri sidecar;
2. a Rust macOS bridge to AVFoundation;
3. a minimal webview `getUserMedia` prototype used only for early tracker experimentation.

**Production choice criteria:**

- reliable camera and microphone enumeration;
- stable 4K Brio capture;
- stable long-duration audio/video timestamps;
- low-latency preview;
- controllable exposure/focus/FOV where supported;
- clean packaging, signing, and notarization;
- crash recovery;
- ability to add a virtual-camera output later.

The webview-only route should not become the permanent dataset recorder unless it proves that it can meet master-quality, synchronization, and recovery requirements.

### 7.4 Tracking-provider abstraction

Both Apple Vision and MediaPipe are plausible tracking backends. Apple Vision exposes face, eye, and pupil landmarks and documents real-time face tracking on Apple platforms.[^apple-vision] MediaPipe Face Landmarker provides face landmarks, optional blendshapes, and facial transformation matrices for image and video streams.[^mediapipe]

Create an interface before choosing the final backend:

```ts
interface FaceTrackingProvider {
  id: string;
  modelVersion: string;
  initialize(config: TrackerConfig): Promise<void>;
  analyze(frame: AnalysisFrame): Promise<FaceTrackingResult>;
  shutdown(): Promise<void>;
}
```

```ts
interface FaceTrackingResult {
  timestampUs: number;
  faceDetected: boolean;
  confidence: number;
  normalizedLandmarks?: Float32Array;
  leftPupil?: Point2D;
  rightPupil?: Point2D;
  headPose?: { yaw: number; pitch: number; roll: number };
  faceScale?: number;
  blendshapes?: Record<string, number>;
  providerId: string;
  modelVersion: string;
}
```

Phase 1 must benchmark both options on the actual MacBook camera and Brio. Choose the primary live backend based on verified contact-classification quality and latency, not feature-list preference. A richer backend may still run offline even if the lower-latency native backend is used live.

### 7.5 Local workers

Recommended worker boundaries:

- **media-worker:** FFmpeg probing, proxies, clip extraction, waveform, thumbnails, A/V correction;
- **transcription-worker:** local Whisper or MLX-Whisper transcription; OpenAI’s Whisper repository provides the base ASR model, and MLX has an Apple-Silicon Whisper implementation.[^whisper][^mlx-whisper]
- **offline-face-worker:** higher-quality landmark and expression pass over saved media;
- **quality-worker:** technical quality, speech errors, duplicates, coverage;
- **generation-worker:** local portrait animation, lip sync, image/video pipelines, and future fine-tuning;
- **provenance-worker:** export manifests, hashes, and optional Content Credentials.

Each worker must use a versioned JSON contract and emit structured progress, logs, and final status. No worker should directly mutate core database tables; it returns results to the application core, which commits them transactionally.

### 7.6 Generation-provider abstraction

```ts
interface GenerationProvider {
  id: string;
  kind: "local" | "cloud";
  capabilities(): Promise<GenerationCapabilities>;
  validate(request: GenerationRequest): Promise<ValidationResult>;
  submit(request: GenerationRequest): Promise<ProviderJobRef>;
  status(job: ProviderJobRef): Promise<GenerationStatus>;
  cancel(job: ProviderJobRef): Promise<void>;
  collect(job: ProviderJobRef): Promise<GeneratedArtifact[]>;
}
```

The product owns the request, source lineage, consent, review, and outputs. Providers only render candidates.

### 7.7 Key architecture decisions

| ADR | Decision |
|---|---|
| ADR-001 | macOS-first desktop app using Tauri 2 and React/TypeScript |
| ADR-002 | local-first storage and processing |
| ADR-003 | one native capture owner for camera and microphone |
| ADR-004 | tracking provider selected through measured benchmark |
| ADR-005 | SQLite for metadata; filesystem for media and models |
| ADR-006 | immutable original media and append-only lineage |
| ADR-007 | separate live and offline analysis passes |
| ADR-008 | provider-neutral generation interface |
| ADR-009 | separate permissions for record, curate, face, voice, cloud, and publish |
| ADR-010 | presenter twin before full-body or real-time avatar |


---

## 8. Data architecture

### 8.1 Local directory layout

Use the macOS Application Support directory rather than scattering files through the user’s home folder.

```text
<Application Support>/<AppName>/
├── db/
│   ├── app.sqlite
│   └── backups/
├── sessions/
│   └── <session_uuid>/
│       ├── manifest.json
│       ├── master/
│       │   ├── video.mov
│       │   ├── audio.wav
│       │   └── optional_safety_audio.wav
│       ├── proxy/
│       │   ├── review.mp4
│       │   ├── waveform.json
│       │   └── thumbnails/
│       ├── analysis/
│       │   ├── tracking.parquet
│       │   ├── gaze_events.json
│       │   ├── transcript.json
│       │   ├── quality.json
│       │   └── segments.json
│       └── recovery/
├── datasets/
│   └── <dataset_uuid>/
│       └── versions/<version>/manifest.json
├── generation/
│   └── <job_uuid>/
│       ├── request.json
│       ├── candidates/
│       ├── evaluations.json
│       └── provenance.json
├── models/
│   ├── tracking/
│   ├── transcription/
│   ├── generation/
│   └── personal_adapters/
├── exports/
├── logs/
└── cache/
```

### 8.2 Core database entities

#### `devices`

- `id`
- `kind` (`camera`, `microphone`)
- `system_device_id`
- `vendor`
- `model`
- `display_name`
- `capabilities_json`
- `first_seen_at`
- `last_seen_at`

#### `capture_profiles`

- `id`
- `name`
- `camera_device_id`
- `microphone_device_id`
- `video_settings_json`
- `audio_settings_json`
- `physical_setup_notes`
- `active_calibration_id`
- `created_at`
- `updated_at`

#### `calibrations`

- `id`
- `capture_profile_id`
- `tracker_provider`
- `tracker_model_version`
- `feature_schema_version`
- `calibration_samples_path`
- `classifier_parameters_json`
- `quality_score`
- `valid_from`
- `invalidated_at`
- `invalidation_reason`

#### `sessions`

- `id`
- `capture_profile_id`
- `calibration_id`
- `drill_id`
- `state`
- `started_at`
- `ended_at`
- `recording_enabled`
- `dataset_intent`
- `recording_consent_id`
- `notes`
- `app_version`

#### `recordings`

- `id`
- `session_id`
- `asset_role`
- `relative_path`
- `mime_type`
- `codec`
- `duration_ms`
- `sha256`
- `size_bytes`
- `validation_state`
- `created_at`

#### `frame_metrics`

Store high-volume frame data in Parquet or compressed binary files rather than one SQLite row per frame. SQLite contains only the file reference, schema version, time range, and summary.

#### `gaze_events`

- `id`
- `session_id`
- `event_type`
- `start_ms`
- `end_ms`
- `duration_ms`
- `mean_confidence`
- `direction`
- `policy_version`
- `user_corrected`

#### `utterances`

- `id`
- `session_id`
- `start_ms`
- `end_ms`
- `text`
- `word_timestamps_json`
- `confidence`
- `transcription_model`

#### `segments`

- `id`
- `session_id`
- `start_ms`
- `end_ms`
- `source_type`
- `quality_json`
- `coverage_tags_json`
- `automatic_recommendation`
- `user_label`
- `rejection_reason`
- `created_at`

#### `consents`

- `id`
- `scope`
- `scope_target_id`
- `status`
- `granted_at`
- `revoked_at`
- `policy_version`
- `human_readable_summary`
- `signature_or_confirmation_hash`

Suggested scopes:

```text
record_session
dataset_include_face
dataset_include_voice
train_face_adapter
train_voice_adapter
cloud_export_face
cloud_export_voice
generate_synthetic_media
publish_synthetic_media
```

#### `dataset_versions`

- `id`
- `dataset_id`
- `version_number`
- `parent_version_id`
- `manifest_path`
- `manifest_sha256`
- `asset_count`
- `duration_ms`
- `created_at`
- `status`

#### `generation_jobs`

- `id`
- `provider_id`
- `provider_version`
- `dataset_version_id`
- `request_path`
- `state`
- `progress`
- `created_at`
- `started_at`
- `completed_at`
- `error_code`

#### `generation_candidates`

- `id`
- `job_id`
- `artifact_path`
- `sha256`
- `provider_metadata_json`
- `automatic_metrics_json`
- `user_evaluation_json`
- `status`

#### `audit_log`

Append-only records for:

- consent grants and revocations;
- cloud exports;
- dataset version creation;
- model/adaptor creation and deletion;
- generated-media exports;
- destructive deletion requests;
- settings that materially affect identity processing.

### 8.3 Session manifest

```json
{
  "schema_version": "1.0",
  "session_id": "uuid",
  "created_at": "ISO-8601",
  "app_version": "semver",
  "capture_profile_id": "uuid",
  "calibration_id": "uuid",
  "tracker": {
    "provider": "apple-vision-or-mediapipe",
    "model_version": "version",
    "feature_schema": "gaze-features-v1"
  },
  "recording": {
    "video": {
      "path": "master/video.mov",
      "sha256": "...",
      "duration_ms": 0,
      "codec": "hevc",
      "width": 3840,
      "height": 2160,
      "nominal_fps": 30
    },
    "audio": {
      "path": "master/audio.wav",
      "sha256": "...",
      "sample_rate_hz": 48000,
      "bit_depth": 16,
      "channels": 1
    }
  },
  "consent": {
    "recording_consent_id": "uuid",
    "dataset_intent": "undecided"
  },
  "analysis": {
    "status": "pending",
    "artifacts": []
  },
  "integrity": {
    "finalized": true,
    "warnings": []
  }
}
```

### 8.4 Gaze-event record

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "type": "gaze_break",
  "start_ms": 12500,
  "end_ms": 14120,
  "duration_ms": 1620,
  "direction": "down",
  "mean_tracking_confidence": 0.94,
  "preceded_by_contact_ms": 8300,
  "recovery_ms": 420,
  "policy_version": "coaching-policy-v1",
  "user_label": null
}
```

### 8.5 Dataset-version manifest

A dataset version is a manifest, not a mutable folder of whatever clips currently happen to exist.

```json
{
  "schema_version": "1.0",
  "dataset_id": "uuid",
  "version": 3,
  "created_at": "ISO-8601",
  "purpose": "presenter_twin_head_shoulders",
  "parent_version": 2,
  "assets": [
    {
      "segment_id": "uuid",
      "source_session_id": "uuid",
      "source_recording_sha256": "...",
      "start_ms": 10000,
      "end_ms": 26000,
      "clip_sha256": "...",
      "labels": ["excellent", "direct_contact", "conversational"],
      "consent_ids": ["uuid"],
      "technical_quality": {},
      "coverage": {}
    }
  ],
  "revoked_assets": [],
  "manifest_sha256": "..."
}
```

### 8.6 Immutability and deletion

- Original master files become read-only at the application level after successful finalization.
- Edits produce a new derivative with a new hash.
- Dataset versions never change after creation; removal creates a new version.
- Deleted assets enter a visible pending-deletion state before removal.
- Because reliable overwrite is not guaranteed on modern SSDs, optional encrypted storage should enable **cryptographic erasure** by destroying the relevant encryption key.
- The app must explain that external backups, cloud-sync folders, or Time Machine may contain independent copies.
- A deletion report should list what was deleted locally and what may still exist outside the application’s control.

---

## 9. Camera-contact measurement design

### 9.1 What is being measured

The system estimates whether the user’s visual orientation is consistent with addressing the physical camera lens. It does not need exact screen-coordinate gaze.

Initial output classes:

```text
CONTACT       — consistent with looking into the lens
NEAR_LENS     — close enough to read naturally on camera
SCREEN_CENTER — looking at the central display or self-view
DOWN_NOTES    — meaningful downward look
LEFT          — meaningful leftward look
RIGHT         — meaningful rightward look
UP            — meaningful upward look
UNKNOWN       — insufficient confidence or occlusion
```

The coaching UI may simplify these to `contact`, `away`, and `unknown`, while review preserves the richer labels.

### 9.2 Feature set

Candidate per-frame features:

- normalized left-pupil position within the left-eye contour;
- normalized right-pupil position within the right-eye contour;
- pupil symmetry;
- eyelid openness and blink state;
- head yaw, pitch, and roll;
- nose-to-eye geometry;
- face scale and position;
- camera-to-face distance proxy;
- facial transformation matrix when available;
- landmark confidence;
- glasses/reflection indicator if detectable;
- temporal velocity of pupil and head movement;
- active prompt position relative to the lens.

Do not store raw full-resolution frames solely to calculate live feedback when normalized features are sufficient. The session video already exists when recording is authorized.

### 9.3 Calibration protocol

A full calibration should take approximately two to four minutes and include enough variation to distinguish eyes from head movement.

#### Step A — setup validation

- face centered;
- both eyes visible;
- camera at intended height;
- normal seating position;
- no extreme glare;
- stable light;
- selected field of view confirmed.

#### Step B — lens baseline

- look naturally at the lens for five seconds;
- relax and blink normally;
- repeat three times with short rests;
- speak one sentence while maintaining lens contact.

#### Step C — negative examples

Collect deliberate looks at:

- screen center;
- immediately beneath the lens;
- lower notes area;
- left screen edge;
- right screen edge;
- above the lens;
- the user’s self-preview location.

#### Step D — head/eye disambiguation

- turn head slightly left while keeping eyes on lens;
- turn head slightly right while keeping eyes on lens;
- tilt head slightly down while keeping eyes on lens;
- keep head stable and move eyes to each negative target.

#### Step E — validation pass

The app presents random targets and predicts them without showing the answer. It reports confusion and repeats weak samples.

### 9.4 Initial classifier

Start with the simplest personalized model that works:

1. normalize features to eye and face geometry;
2. construct calibrated feature clusters for lens and negative targets;
3. calculate distance to each cluster;
4. combine pupil distance, head-pose tolerance, and confidence;
5. use a lightweight interpretable classifier such as logistic regression if cluster thresholds are insufficient;
6. reserve a more complex model only if held-out performance justifies it.

A possible conceptual score:

```text
contact_probability =
    w1 × pupil_alignment
  + w2 × binocular_symmetry
  + w3 × head_pose_compatibility
  + w4 × lens_cluster_similarity
  + w5 × temporal_stability
  + w6 × tracker_confidence
```

The exact weights must be learned or calibrated from user-specific data. They should not be guessed and frozen globally.

### 9.5 Temporal policy

Raw per-frame classification is too noisy for coaching. Apply:

- median or exponential smoothing;
- entry and exit thresholds with hysteresis;
- blink suppression;
- a minimum-duration requirement before creating a break;
- an `unknown` state during tracking loss;
- a recovery interval after contact resumes;
- a feedback cooldown to avoid repeated cues.

Initial policy to test, not hard-code permanently:

```yaml
micro_glance_tolerance_ms: 400
reportable_break_min_ms: 800
long_break_min_ms: 2000
contact_recovery_confirm_ms: 250
feedback_cooldown_ms: 3000
unknown_timeout_ms: 500
```

The policy should differ by drill. A reading exercise allows more near-lens glances than a direct-address drill.

### 9.6 Session metrics

Core metrics:

- camera-contact ratio during speaking time;
- near-lens ratio;
- unknown/tracking-loss ratio;
- gaze breaks per speaking minute;
- mean and median break duration;
- longest break;
- median recovery time;
- longest sustained contact interval;
- contact at sentence openings;
- contact at sentence endings;
- contact during marked emphasis phrases;
- dominant drift direction;
- repeated self-view checks;
- head-pose stability;
- framing stability.

Metrics should exclude:

- countdown;
- pauses caused by the app;
- known calibration targets;
- user-marked interruptions;
- tracking-loss periods;
- optional sections where notes were explicitly allowed.

### 9.7 Human-labeling tool

The review screen doubles as the ground-truth tool for Phase 1.

Controls:

- play/pause;
- frame or 100 ms step;
- mark interval as `contact`, `near_lens`, `not_contact`, or `unknown`;
- choose direction for non-contact;
- accept system label;
- undo;
- display tracker confidence separately;
- hide system label during blind validation.

Export a labeled evaluation file:

```json
{
  "session_id": "uuid",
  "label_schema": "gaze-ground-truth-v1",
  "intervals": [
    {"start_ms": 0, "end_ms": 2200, "label": "contact"},
    {"start_ms": 2200, "end_ms": 3400, "label": "down_notes"}
  ]
}
```

### 9.8 Evaluation protocol

For each hardware profile:

1. collect calibration data;
2. record scripted validation sequences;
3. record natural unscripted speaking;
4. label without seeing model output;
5. divide sessions into calibration, tuning, and held-out test sets;
6. calculate precision, recall, F1, confusion matrix, event timing error, and false-cue rate;
7. repeat on a different day without moving the setup;
8. move the setup intentionally and verify that the app warns or requests recalibration.

The important measures are not only frame accuracy. Also measure:

- whether false cues distract the speaker;
- whether breaks are detected soon enough to be useful;
- whether the app misses the user’s common failure pattern;
- whether the system remains stable after ordinary posture movement;
- whether external-camera and built-in-camera calibrations remain independent.

---

## 10. Coaching-system design

### 10.1 Feedback philosophy

A cue should be:

- late enough to avoid punishing natural micro-glances;
- early enough to prevent a sustained disengaged look;
- visually quiet;
- located near the lens;
- absent when tracking is uncertain;
- followed by a cooldown;
- easy to disable without ending the session.

Suggested feedback levels:

| Level | Behavior |
|---|---|
| Off | Record metrics only |
| Minimal | Halo changes only after sustained drift |
| Standard | Halo plus one gentle pulse |
| Active drill | Faster cues and explicit recovery acknowledgement |
| Review-only | No live signal; all feedback after the session |

### 10.2 Lens-adjacent HUD

The physical lens location is not directly known to software with perfect precision. During profile setup, the user should drag an on-screen anchor to the point closest to the lens. The HUD then occupies a constrained region beneath or around that anchor.

HUD elements:

- tiny contact halo;
- single line of prompt text;
- recovery checkmark or soft pulse;
- optional progress dot;
- recording indicator;
- no dense numbers;
- no large moving faces unless a drill specifically uses an audience target.

### 10.3 Drill definition format

```yaml
id: prompted-response-01
version: 1
name: Thirty-second direct answer
mode: prompted_response
duration_target_sec: 30
prompt:
  type: question
  text: "Explain one idea you care about in plain language."
  reveal_sec: 5
  hide_when_speaking: true
contact_policy:
  micro_glance_tolerance_ms: 500
  reportable_break_min_ms: 900
  feedback_level: standard
scoring:
  exclude_first_sec: 2
  sentence_boundary_contact: true
completion:
  minimum_speaking_sec: 20
reflection:
  - "Where did you feel tempted to look?"
  - "Did returning to the lens interrupt your thought?"
```

### 10.4 Training curriculum

#### Level 1 — Lens comfort

- silent five-second holds;
- breathing while maintaining relaxed contact;
- speaking a name or greeting;
- blinking naturally;
- short breaks followed by deliberate recovery.

Success is not a perfect score. Success is looking natural and reducing discomfort.

#### Level 2 — Lens-adjacent reading

- one phrase at a time;
- phrase disappears when speaking begins;
- text width constrained near the lens;
- gradual increase from one line to two lines;
- compare center-screen teleprompter versus lens-adjacent placement.

#### Level 3 — Prompted response

- display question for several seconds;
- hide prompt;
- answer from memory;
- progressively longer answers;
- explicit beginning and ending contact goals.

#### Level 4 — Presentation rehearsal

- import outline or script;
- mark moments when notes are allowed;
- mark emphasis phrases;
- track return-to-lens after each note consultation;
- review sentence openings and endings.

#### Level 5 — Simulated livestream

- timed comment cards;
- questions that appear away from the lens;
- acknowledge comment, then return to lens;
- simulated interruption;
- timed recovery;
- optional second-screen placement calibration.

#### Level 6 — Live assist

- always-on-top compact HUD;
- no recording by default;
- visible privacy state;
- profile-specific calibration for the exact presentation camera;
- minimal cue policy;
- clean outgoing video path.

### 10.5 Review experience

The review timeline should have synchronized lanes:

```text
Video
Transcript / words
Speaking vs silence
Contact state
Gaze-break events
Head pose
Prompts / note-allowed intervals
User annotations
Candidate clip ranges
```

Clicking any event jumps to the matching moment. The user can compare:

- first half versus second half;
- baseline versus current session;
- live-cued versus review-only sessions;
- built-in versus Studio profile;
- scripted versus unscripted speaking.

### 10.6 Progress model

Do not collapse progress into one opaque score. Show a small group of understandable trends:

- contact during speaking;
- breaks per minute;
- median break duration;
- recovery time;
- sentence-ending contact;
- tracking confidence;
- subjective comfort rating.

Normalize comparisons by drill type and profile. A livestream simulation should not be compared directly to a silent lens-hold drill.

### 10.7 Next-drill recommendations

Rules can be deterministic initially:

```text
IF dominant drift = down AND note consultations are frequent
THEN recommend "return from notes" drill.

IF contact ratio is high BUT longest breaks exceed threshold
THEN recommend "rapid recovery" drill.

IF sentence openings are strong AND endings are weak
THEN recommend "finish through the lens" drill.

IF false cues or tracking unknown > threshold
THEN recommend recalibration, not harder training.
```

The recommendation engine must distinguish a user behavior problem from a measurement-quality problem.


---

# 11. Phase-by-phase implementation plan

## Phase 1 — Measurement kernel

### 11.0 Implementation status — 2026-07-25

**Current state:** Phase 1 engineering is feature-complete for the planned measurement kernel.
Automated verification and local macOS packaging pass. Phase 1 is **not yet accepted** because the
remaining exit criteria require fresh user calibration, human labels, and simultaneous/live
hardware exercises.

| Area | Status | Evidence or note |
|---|---|---|
| Desktop foundation | Complete and verified | Tauri 2, React, TypeScript, Rust, SQLite, migrations, structured local logging, strict local CSP, CI, and release-bundle packaging |
| Device/profile layer | Complete; final hardware exercises open | Separate camera/microphone permission controls, stable device inventory, profile editing, disconnected-device visibility, negotiated settings, 720p/1080p/4K choices, live dBFS meter, attach/detach and track-ended handling |
| Capture path | Selected and implemented | Webview capture is the Phase 1 live path; native AVFoundation/Vision helpers remain benchmark and validation tools |
| Tracking | Implemented; final promotion evidence open | MediaPipe Face Landmarker is the provisional live provider; Apple Vision and MediaPipe share a versioned feature contract and benchmark harness, but the final same-human-corpus comparison remains open |
| Calibration | Complete; fresh profile runs open | Self-guided 13-step training plus randomized 11-target validation, five-second settle and collection holds, audible transitions, weak-target recapture, per-target quality gates, persistence, revalidation, and invalidation |
| Classifier | Complete and verified mechanically | Personalized robust centers, class probabilities, ambiguity/out-of-distribution abstention, explicit `unknown`, hysteresis, blink suppression, gaze-break/recovery events, and offline reprocessing |
| Measurement/recording | Complete and verified mechanically | Practice and recording modes, optional video-only operation, media-clock alignment, dropped-frame capture, periodic and lifecycle checkpoints, finalization guards, and visible incomplete/invalid recovery |
| Review/evaluation | Complete; human review open | Playback-aligned overlay and timeline, blind labeling, append-only corrections, exports, confusion/agreement/coverage/false-cue/event-timing metrics, and version comparison |
| Automated verification | Pass | 81 TypeScript tests across 20 suites; Rust tests; Swift build; 240-frame native Vision fixture; renderer production build; strict code-sign/plist checks; zero known npm vulnerabilities |
| Current signed-bundle smoke | Pass | Setup, Calibration, Test, and Review rendered from the packaged app with devices off; no permission prompt or device activation occurred; the stale calibration was correctly rejected; the app quit cleanly |

Current reproducibility identifiers:

```text
tracking provider: mediapipe-face-landmarker
tracker/model: 0.10.22/face-landmarker-float16-v1+pose-matrix.2
calibration protocol: guided-personalized/2.0.1
classifier: cluster-hysteresis/1.2.1
feature schema: 1.0.0
packaged executable SHA-256: 88cf03b91ffe776bb8c9874ae2105fc6bda7926268d33eeb984a0a7e82a675cc
```

Calibration history and compatibility note:

- Brio run four collected 440 samples and passed the then-current
  `cluster-hysteresis/1.1.0` gate at 94.0%.
- Reprocessing those samples with `cluster-hysteresis/1.2.1` produced 91.7% overall agreement but
  only 70% at the physical-lens target, below the current 80% lens gate.
- Run four is preserved for audit but is deliberately ineligible for activation. The next Brio
  calibration must use the current tracker/model and independent-validation protocol.
- The MacBook profile still needs its first current-version calibration.

Pertinent product and test decisions:

- All time-sensitive calibration instructions and transitions are shown above or inside the
  preview because the user cannot see content below the preview while posed at the eye-level Brio.
- The physical-lens baseline uses a five-second settle interval followed by five seconds of
  collection so the eyes can settle before samples count.
- The Brio is positioned at eye height. The physical camera lens—not the monitor—is the calibration
  target.
- The product owner accepted the 77.26-second, 2,319-frame Brio 4K/30 run as sufficient Phase 1
  transport-stability evidence. The proposed 30-minute Brio soak is therefore not an open gate.
- The Yeti passed a discard-only 48 kHz stereo sample-flow check, and the Brio passed 4K/30 and
  1080p/60 checks. They were tested sequentially; simultaneous Brio + Yeti negotiation remains open.
- Camera and microphone are never enabled automatically. Remaining recorded tests require explicit
  user action in the application.

Remaining Phase 1 acceptance gates:

- run a fresh current-version Brio calibration and first MacBook calibration;
- verify at least 85% held-out agreement for both profiles with user labels;
- demonstrate fewer than one false corrective cue per labeled minute;
- run a simultaneous Brio + Yeti Studio profile and inspect live A/V synchronization and drops;
- complete live blink, notes, side-screen, posture, low-light, and glasses/contact-lens cases;
- compare Apple Vision and MediaPipe on the same labeled human corpus and record the final backend
  decision;
- verify USB disconnect, Yeti mute/unmute and speaking level, sleep/wake, camera contention, and
  forced-termination recovery;
- complete a human-labeled Review pass and repeat stability over at least three sessions.

Authoritative detailed evidence lives in:

- `docs/acceptance/PHASE_1_REQUIREMENTS_MATRIX.md`;
- `docs/acceptance/PHASE_1_ACCEPTANCE.md`;
- `docs/acceptance/BUILD_MANIFEST.md`;
- `docs/benchmarks/TRACKER_BENCHMARK.md`;
- `docs/benchmarks/CAPTURE_SPIKE.md`.

### 11.1 Objective

Prove that the application can reliably distinguish natural camera contact from the user’s common gaze deviations on both existing camera setups, with low enough latency and false-cue frequency to support coaching.

### 11.2 Phase 1 scope

In scope:

- repository and desktop shell;
- device enumeration and named profiles;
- camera preview;
- camera/microphone permissions;
- tracker-provider benchmark;
- personalized calibration;
- live contact state;
- simple lens-adjacent visualization;
- optional test recording;
- timestamped tracking log;
- manual ground-truth labeling;
- evaluation report;
- calibration persistence and invalidation.

Out of scope:

- full coaching curriculum;
- progress history beyond test sessions;
- automatic clip curation;
- presenter generation;
- voice cloning;
- virtual camera;
- cloud services.

### 11.3 Work package P1-A — Repository foundation

Tasks:

- [x] Create monorepo and branch policy.
- [x] Scaffold Tauri 2 + React + TypeScript desktop app.
- [x] Enable strict TypeScript and Rust linting.
- [x] Create shared JSON Schema or TypeScript/Rust contracts.
- [x] Add SQLite migrations and repository layer.
- [x] Add structured local logging with session/job correlation IDs.
- [x] Add feature flags for experimental tracking backends.
- [x] Add deterministic test-media fixtures that do not contain private biometric data.
- [x] Add CI for unit tests, linting, schema validation, and packaging smoke tests.
- [x] Add Architecture Decision Records directory.
- [x] Add a local privacy/threat-model document before recording code lands.

Deliverables:

```text
app launches
SQLite migrates
settings persist
logging works
feature flags work
no camera access requested until the user starts setup
```

### 11.4 Work package P1-B — Device and permission layer

Tasks:

- [x] Enumerate cameras and microphones with stable runtime identifiers.
- [x] Display model/vendor information where available.
- [x] Request macOS camera permission with a clear explanation.
- [x] Request microphone permission separately.
- [x] Handle denied, restricted, and previously revoked permissions.
- [x] Detect device attach/detach while the app is open.
- [x] Build profile creation and editing UI.
- [x] Seed `MacBook Practice` and `Studio Capture` suggestions after matching hardware is detected.
- [x] Record actual negotiated resolution, frame rate, and audio format.
- [x] Never assume the requested mode was granted.

Tests:

- built-in camera + built-in mic;
- Brio + Yeti;
- camera present, mic missing;
- mic present, camera missing;
- device removed during preview;
- denied permissions;
- device renamed by macOS or driver;
- application restart with saved profile.

### 11.5 Work package P1-C — Capture spike and selection

Build three narrow prototypes, not three full implementations:

1. webview media capture;
2. Swift AVFoundation helper;
3. Rust-to-AVFoundation bridge if technically reasonable.

Measure:

- time to first frame;
- preview latency;
- 30-minute stability;
- actual 4K Brio operation;
- CPU, GPU, memory, and thermal behavior;
- timestamp access;
- microphone synchronization;
- frame drops;
- packaging/signing difficulty;
- ability to expose a clean preview without copying full 4K frames into JavaScript.

Decision output:

- ADR naming the production capture path;
- benchmark table;
- known limitations;
- fallback behavior.

### 11.6 Work package P1-D — Tracking benchmark

Implement interchangeable prototypes for:

- Apple Vision face/eye/pupil tracking;
- MediaPipe Face Landmarker;
- optional additional backend only when it has a clear technical advantage.

Benchmark media set:

- built-in camera, normal light;
- built-in camera, lower light;
- Brio 65° at 1080p;
- Brio 65° at 4K master with analysis proxy;
- glasses on/off where relevant;
- controlled head turns;
- screen-center looks;
- downward notes;
- natural speech.

Metrics:

- detection rate;
- pupil/eye stability;
- head-pose stability;
- per-frame latency;
- CPU/GPU load;
- resilience to blinks and reflections;
- data-copy overhead;
- contact-classification accuracy after calibration.

Gate:

Select the primary live backend only after the evaluation harness can compare them on the same labeled samples.

### 11.7 Work package P1-E — Calibration wizard

UI steps:

1. explain the purpose;
2. verify framing and light;
3. locate the lens anchor;
4. collect lens samples;
5. collect negative targets;
6. collect head/eye disambiguation samples;
7. run hidden validation;
8. report quality;
9. save or repeat.

Engineering tasks:

- [x] Store raw normalized feature samples, not only final thresholds.
- [x] Version feature schema and tracker.
- [x] Compute per-target sample quality.
- [x] Detect insufficient variation or unstable tracking.
- [x] Allow a quick verification on future launches.
- [x] Record physical setup notes or optional reference snapshot with separate permission.
- [x] Add invalidation reasons and revalidation flow.

### 11.8 Work package P1-F — Personalized contact classifier

Iteration order:

1. deterministic normalized thresholds;
2. nearest calibrated cluster;
3. lightweight logistic classifier;
4. only then consider a more complex model.

Tasks:

- [x] Define feature vector schema.
- [x] Build training/tuning split from calibration samples.
- [x] Add per-frame confidence.
- [x] Add temporal smoothing.
- [x] Add blink suppression.
- [x] Add `unknown` state.
- [x] Add gaze-break event builder.
- [x] Log algorithm version with every result.
- [x] Create offline reprocessing command to compare algorithm versions on the same session.

### 11.9 Work package P1-G — Live measurement UI

Display only:

- preview;
- lens anchor;
- current state halo;
- tracker confidence warning when needed;
- start/stop test;
- no performance score during the test.

Developer diagnostics hidden behind a debug switch:

- eye/pupil overlays;
- head pose;
- per-frame class probabilities;
- latency graph;
- dropped-frame count;
- active calibration ID;
- tracker provider/model.

### 11.10 Work package P1-H — Test recording and event log

The Phase 1 recorder may use a lower-complexity path, but it must still:

- preserve monotonic timestamps;
- write a session manifest;
- write tracking data;
- recover from abrupt stop where possible;
- make incomplete status visible;
- provide review playback aligned with events.

### 11.11 Work package P1-I — Ground-truth review tool

Tasks:

- [x] Video playback with contact-state overlay.
- [x] Blind mode that hides predictions.
- [x] Interval labeling.
- [x] Export labels.
- [x] Calculate confusion matrix and event timing.
- [x] Compare two tracker/algorithm versions.
- [x] Record false-cue annotations.
- [x] Preserve user corrections without overwriting original predictions.

### 11.12 Phase 1 test plan

#### Unit tests

- feature normalization;
- calibration serialization;
- classifier thresholds;
- blink suppression;
- temporal hysteresis;
- event construction;
- calibration invalidation;
- profile matching;
- time-range math.

#### Integration tests

- camera → tracker → classifier → UI;
- profile → calibration lookup;
- recording → manifest → review;
- tracker failure → unknown state;
- device removal → safe session state;
- app restart → calibration restored.

#### Hardware tests

- MacBook Practice, 30-minute preview;
- Studio Capture, 30-minute preview;
- Brio at all intended FOV/resolution combinations;
- Yeti mute/unmute and gain check;
- external USB disconnect;
- sleep/wake;
- another app requesting the camera.

#### Human validation sessions

- scripted target sequence;
- five-minute natural talk;
- reading from notes;
- simulated livestream comments;
- deliberate blinks and posture shifts;
- repeated session on a later day.

### 11.13 Phase 1 exit criteria

Phase 1 is complete only when the following gates are satisfied. A checked item has authoritative
evidence; unchecked items still need final human or hardware acceptance.

- [ ] Both hardware profiles can be selected and previewed. The profiles and individual devices
  exist; simultaneous Studio pairing and current-build live acceptance remain open.
- [ ] Each profile has an independent current-version calibration.
- [ ] Held-out classification meets the agreed accuracy threshold of at least 85% on both profiles.
- [ ] False live cues are rare enough not to disrupt speaking, with a target below one false cue per
  labeled minute.
- [ ] Blinks do not become gaze breaks. Automated coverage passes; live human confirmation remains
  open.
- [ ] Low-confidence periods are reported as unknown. Automated coverage and frame-stall behavior
  pass; live confirmation remains open.
- [x] The review tool can inspect predictions and preserve user corrections separately from original
  predictions.
- [x] Tracker, model, feature-schema, calibration-protocol, classifier, asset, and executable
  versions are reproducible.
- [ ] A written benchmark explains why the selected backend won. The benchmark is written and
  MediaPipe is selected provisionally; final promotion awaits the same labeled human corpus.
- [ ] A session can be recovered or clearly marked invalid after interruption. Automated recovery
  paths pass; forced-termination UI confirmation remains open.

### 11.14 Phase 1 deliverables

| Deliverable | Status |
|---|---|
| Desktop measurement application | Complete; packaged and ad-hoc signed |
| Two hardware profiles | Complete; final simultaneous/live acceptance open |
| Calibration wizard | Complete |
| Selected live tracking backend | Provisional MediaPipe selection; final same-corpus gate open |
| Personalized camera-contact classifier | Complete |
| Live halo | Complete |
| Recorded event log | Complete |
| Ground-truth review tool | Complete |
| Benchmark report | Published provisionally; human same-corpus result open |
| Phase 1 acceptance report | Published and maintained; final acceptance open |

---

## Phase 2 — Coaching MVP

### 12.1 Objective

Turn the proven measurement kernel into a training product that improves real behavior without making the speaker robotic or overly self-conscious.

### 12.2 Phase 2 scope

In scope:

- drill engine;
- progressive curriculum;
- lens-adjacent prompt system;
- restrained feedback policies;
- complete review timeline;
- understandable metrics;
- session goals and notes;
- progress history;
- deterministic next-drill recommendations;
- compact live-assist HUD;
- privacy state and recording controls.

Out of scope:

- automatic dataset ingestion;
- model training;
- voice cloning;
- real-time generated avatar;
- automatic public-stream integration.

### 12.2.1 Implementation status — 2026-07-26

Phase 2 is being hardened on `agent/phase-2-prototype-checkpoint`, building on
the existing coaching prototype rather than replacing it.

Implemented and covered by device-free tests:

- versioned drill schema and the complete ten-drill starter library;
- durable plain-text/Markdown outline import with an immutable drill snapshot
  stored on every coached session;
- restrained feedback engine with blink/unknown suppression, cooldowns,
  evidence logs, cue ratings, and recovery handling;
- lens-adjacent prompt width, reveal modes, and large-text mode;
- VAD speaking-window persistence through checkpoints, browser/native
  checkpoint merging, review lanes, analysis exports, progress calculations,
  and Markdown/JSON session reports;
- synchronized Review evidence lanes with 1×/2×/4×/8× zoom, keyboard seeking,
  and durable timestamped bookmark annotations;
- validated, persisted transcript documents with session-relative word and
  sentence timestamps, immutable model/stub evidence, and a separately
  revisioned user-corrected copy;
- Review import for timestamped transcript JSON plus manual add/edit/delete
  controls for non-overlapping sentence boundaries, with corrected boundaries
  feeding the timeline, analysis export, and Markdown/JSON session report;
- accessible rolling sparklines for every like-for-like Progress metric, while
  retaining baseline identity and measurement-degradation warnings;
- hands-free drill guidance: spoken instruction, four-second settle interval,
  distinct start tone, automatic timed-drill completion, and completion chime;
- display/profile prompt binding using Tauri monitor geometry, with a warning
  when the app window moves to a display that does not match the saved lens
  placement.

Still requiring live validation after CaptureCore releases the Brio and Yeti:

- speech-synthesis voice and tone audibility in the packaged Tauri app;
- one complete hands-free Level 1 run using the top-monitor Brio calibration;
- movement-warning behavior across the four-display desk setup.

Still open for later Phase 2 slices:

- custom-drill editing/deletion and richer per-beat timing controls;
- local ASR worker integration and automatic transcript attachment;
- word-text correction and explicit clip in/out controls;
- optional non-manipulative practice-streak decision;
- real transparent always-on-top Tauri live-assist window and global shortcut.

### 12.3 Work package P2-A — Drill engine

Tasks:

- [x] Define versioned drill schema.
- [x] Load built-in drills from content files rather than hard-coding UI.
- [x] Support duration, prompts, allowed note zones, feedback policy, scoring, and reflection prompts.
- [x] Validate drill files at startup and in tests.
- [x] Preserve drill version and immutable drill content in each session.
- [x] Support custom user-authored prompts.
- [x] Add durable import from plain text or Markdown outline for presentation rehearsal.

Initial built-in drill set:

- relaxed lens hold;
- greeting and introduction;
- single-sentence answer;
- thirty-second explanation;
- finish the sentence through the lens;
- glance at notes and recover;
- answer after prompt disappears;
- respond to a simulated comment;
- deliver a one-minute prepared section;
- three-minute review-only rehearsal.

### 12.4 Work package P2-B — Prompt placement and lens geometry

Tasks:

- [x] Persist lens-anchor location per display/profile.
- [x] Constrain prompt width near lens.
- [x] Support one-line reveal, phrase-by-phrase reveal, and hide-on-speech.
- [ ] Prevent system dialogs from covering the prompt during a session.
- [x] Warn when the window is moved to another display and lens geometry no longer matches.
- [x] Add large-text mode while preserving lens proximity.
- [ ] Test with MacBook built-in display and external displays.

### 12.5 Work package P2-C — Feedback policy engine

Inputs:

- current contact state;
- event duration;
- tracking confidence;
- drill policy;
- speaking/not-speaking state;
- cooldown state;
- recent cue history;
- user-selected intensity.

Outputs:

- no cue;
- halo state;
- one visual pulse;
- optional quiet sound;
- recovery acknowledgement;
- recalibration warning.

Tasks:

- [x] Implement cue suppression during blinks and unknown tracking.
- [x] Implement per-drill thresholds.
- [x] Add cue rate limit.
- [x] Log every cue with the evidence that caused it.
- [x] Let review jump to cue moments.
- [x] Let the user mark a cue helpful, unnecessary, or wrong.
- [ ] Use cue feedback to tune policy, not silently retrain identity models.

### 12.6 Work package P2-D — Speaking and sentence alignment

To calculate contact at sentence boundaries:

- run local voice activity detection during or after the session;
- transcribe after the session;
- align words and punctuation to timestamps;
- infer sentence starts and endings;
- let the user correct transcript boundaries when important.

The live coaching loop must not wait for transcription. Sentence-boundary metrics are review features.

Implementation status:

- [x] Keep live coaching independent of ASR.
- [x] Persist VAD speaking windows for post-session review.
- [x] Materialize word timestamps and inferred sentence boundaries from post-session worker output.
- [x] Preserve original model/stub transcript evidence separately from corrections.
- [x] Import, add, edit, delete, validate, and persist sentence-boundary corrections.
- [ ] Integrate and supervise a local Whisper/MLX-Whisper worker.
- [ ] Add direct word-text correction in Review.

### 12.7 Work package P2-E — Review timeline

Tasks:

- [x] Build synchronized multi-lane timeline.
- [x] Add zoom and keyboard navigation.
- [x] Click event to seek playback.
- [x] Show contact, near-lens, away, and unknown separately.
- [x] Show cue markers.
- [x] Show transcript and sentence boundaries.
- [x] Show allowed-note intervals.
- [x] Add user annotations and bookmarks.
- [ ] Add clip in/out points, but do not yet promote automatically to a dataset.
- [x] Export a session report as Markdown/JSON.

### 12.8 Work package P2-F — Progress system

Tasks:

- [x] Define comparable-session grouping by drill, profile, and feedback mode.
- [x] Store metrics with scoring-policy version.
- [x] Show accessible rolling trends without implying medical significance.
- [x] Add baseline session.
- [x] Add user comfort rating before/after session.
- [x] Highlight measurement degradation separately from performance change.
- [ ] Add session streak only if it supports practice without becoming manipulative.

### 12.9 Work package P2-G — Recommendation rules

Implement transparent rules first. Every recommendation should say why it was selected, for example:

> “Your contact was stable while speaking, but four downward note checks lasted more than two seconds. The next drill practices checking notes and returning before the next sentence.”

Tasks:

- [x] Encode rules as versioned configuration.
- [x] Include minimum evidence requirements.
- [x] Prevent recommendations when tracking confidence is poor.
- [x] Let the user dismiss or pin a drill.
- [x] Record whether the recommendation was followed and, after the resulting session, separately rate whether it was useful.

### 12.10 Work package P2-H — Live-assist HUD

First version:

- compact always-on-top transparent window;
- user-positioned directly beneath the camera;
- contact halo only;
- no recording by default;
- visible `LIVE ASSIST — NOT RECORDING` or `RECORDING` state;
- global keyboard shortcut to hide/show;
- no virtual camera yet;
- works while OBS, Zoom, or browser presentation software uses a separate camera path only when macOS device access permits.

Before release, test camera contention. If another application cannot share the camera reliably, defer clean live use until the virtual-camera architecture is implemented.

### 12.11 Phase 2 test plan

#### Coaching correctness

- cue fires only after policy threshold;
- cue does not fire on blink;
- cue does not fire during unknown;
- cue cooldown works;
- recovery acknowledgement occurs once;
- note-allowed interval changes policy;
- user feedback on cue is preserved.

#### UX tests

- prompts remain near lens at supported window sizes;
- keyboard-only session operation;
- emergency stop always available;
- recording state is unmistakable;
- no accidental recording after app restart;
- review seeks accurately to events;
- metrics exclude pauses and invalid intervals.

#### Longitudinal validation

Run a repeated protocol over multiple sessions:

- same camera profile;
- same drill;
- same approximate lighting and position;
- alternate live cues and review-only mode;
- compare objective metrics and subjective comfort;
- inspect whether improvement transfers to unscripted speaking.

### 12.12 Phase 2 exit criteria

- at least one complete drill exists at each curriculum level;
- the user can complete a session without looking away to operate the app;
- cue policy produces useful rather than irritating feedback;
- review explains every major metric with observable evidence;
- progress comparisons are like-for-like;
- recommendations distinguish performance issues from tracking issues;
- live-assist HUD does not leak into the outgoing video unless explicitly intended;
- the coaching product is useful even with all generation features disabled.

### 12.13 Phase 2 deliverables

```text
Coaching MVP
Versioned drill library
Lens-adjacent prompt system
Feedback policy engine
Review timeline
Progress dashboard
Next-drill recommendations
Live-assist HUD prototype
Coaching validation report
```

---

## Phase 3 — Dataset engine

### 13.1 Objective

Convert explicitly approved coaching recordings into a durable, diverse, model-ready presenter dataset while preserving source quality, consent, lineage, and reversibility.

### 13.2 Phase 3 scope

In scope:

- production-quality native recording;
- high-quality video and unprocessed audio master;
- safe finalization and recovery;
- timestamped transcription;
- offline facial analysis;
- automatic segmentation;
- technical quality scoring;
- human curation;
- dataset coverage map;
- duplicate detection;
- immutable dataset versions;
- portable export packages;
- storage management;
- granular consent and revocation.

Out of scope:

- custom voice model;
- custom motion model;
- general full-body dataset;
- autonomous cloud upload;
- automatic training on all approved assets.

### 13.3 Work package P3-A — Production CaptureCore

Tasks:

- [ ] Establish one camera/microphone owner.
- [ ] Support built-in and Studio profiles.
- [ ] Record master video with actual negotiated settings.
- [ ] Record raw/minimally processed Yeti audio separately where appropriate.
- [ ] Generate live preview and analysis frames without degrading master quality.
- [ ] Timestamp video and audio from capture time.
- [ ] Write periodic recovery checkpoints.
- [ ] Detect dropped frames, audio discontinuity, encoder backpressure, and disk pressure.
- [ ] Finalize media atomically.
- [ ] Validate duration, streams, decodability, and hashes before marking complete.
- [ ] Add a one-hour and multi-hour soak test.

### 13.4 Work package P3-B — Audio/video synchronization

External USB devices may use different clocks. Do not assume perfect long-session synchronization.

Tasks:

- [ ] Record monotonic timing metadata for both streams.
- [ ] Measure initial offset.
- [ ] Measure drift over long captures.
- [ ] Add an optional clap or sync phrase in studio setup tests.
- [ ] Build post-finalization drift analysis.
- [ ] Correct a derivative, never the immutable original.
- [ ] record correction parameters in the manifest.
- [ ] Flag recordings whose drift cannot be corrected confidently.

Optional safety audio:

- evaluate simultaneous built-in-microphone capture as a separate technical spike;
- do not make it an MVP dependency;
- if enabled, label it as a safety track and never mix it automatically into the training master.

### 13.5 Work package P3-C — Recording preflight and quality monitor

Before recording:

- framing and eye-height check;
- face-size target;
- lighting check;
- focus/exposure stability;
- audio level and clipping check;
- ten-second room-noise sample;
- storage estimate;
- consent selection;
- outfit/look label;
- background label;
- session objective.

During recording:

- unobtrusive warnings only for critical problems;
- disk-low warning;
- device loss;
- clipping or silence;
- severe focus loss;
- face missing for sustained period;
- thermal degradation;
- no repeated noncritical warnings that disrupt performance.

### 13.6 Work package P3-D — Media finalization pipeline

Pipeline:

```text
Stop capture
  → close streams
  → validate containers
  → calculate hashes
  → write immutable session manifest
  → create review proxy
  → extract mono analysis audio
  → build waveform and thumbnails
  → enqueue transcription
  → enqueue offline tracking
  → enqueue quality analysis
  → enqueue segmentation
```

Every step has:

- `pending`, `running`, `succeeded`, `failed`, `cancelled`;
- progress;
- worker and model version;
- input hashes;
- output hashes;
- retry policy;
- human-readable error.

### 13.7 Work package P3-E — Transcription and speech structure

Tasks:

- [ ] Run local Whisper/MLX-Whisper.
- [x] Preserve word-level timestamps when available.
- [x] Run voice activity detection.
- [ ] Detect long pauses, retakes, false starts, and interruptions.
- [x] Allow sentence-boundary correction; direct word-text editing remains open.
- [x] Preserve original model output and corrected text separately.
- [x] Derive sentence boundaries from timestamped words; richer utterance boundaries remain open.
- [ ] Mark sections with crosstalk or external audio.
- [ ] Never infer consent from spoken words; consent remains a separate UI action.

### 13.8 Work package P3-F — Offline face and motion analysis

Offline analysis may use more compute and a richer tracker than live coaching.

Extract:

- normalized face landmarks;
- pupil/eye features;
- head pose;
- blink intervals;
- mouth movement descriptors;
- selected expression blendshapes;
- face visibility and occlusion;
- face scale and crop margin;
- motion smoothness;
- camera-contact state reprocessed with the final algorithm;
- tracking confidence.

Store normalized metadata, model version, and a pointer to the source. Avoid unnecessary identity embeddings unless a specific feature requires them and consent covers their creation.

### 13.9 Work package P3-G — Automatic segmentation

Candidate segment boundaries should prefer:

- complete sentences or coherent thoughts;
- clean lead-in and tail silence;
- no app interruption;
- no visible reach toward controls;
- no severe gaze drift;
- no clipping;
- no focus or exposure jump;
- no obvious verbal mistake;
- stable tracking;
- useful duration.

Generate candidates in several ranges:

- 3–8 seconds for expression and phonetic fragments;
- 8–20 seconds for lip-sync and short presenter samples;
- 20–60 seconds for coherent delivery;
- longer continuous takes when required by an avatar provider.

Automatic segment proposal must not copy media until the user approves or an export requires a derivative. Time ranges can point into the immutable master.

### 13.10 Work package P3-H — Technical quality scoring

Keep component scores visible:

#### Video

- face detected ratio;
- eye visibility;
- sharpness;
- motion blur;
- exposure stability;
- highlight/shadow clipping;
- white-balance stability;
- compression artifacts;
- background stability;
- crop margin;
- head and shoulder framing;
- dropped/repeated frames.

#### Audio

- clipping;
- loudness range;
- signal-to-noise estimate;
- sustained background noise;
- reverberation proxy;
- dropouts;
- plosive severity;
- non-speech intrusion;
- synchronization confidence.

#### Performance

- camera-contact strength;
- natural blinking;
- complete utterance;
- no obvious restart;
- appropriate movement;
- expression usefulness;
- speaking-rate range;
- pause quality.

Technical scores are recommendations. A technically imperfect clip may be valuable for rare expression or phonetic coverage.

### 13.11 Work package P3-I — Human curation

The curation screen must support:

- rapid candidate playback;
- source-context playback before and after the clip;
- keyboard shortcuts;
- labels;
- reason tags;
- clip boundary adjustment;
- comparison with near duplicates;
- consent state;
- coverage impact preview;
- deletion;
- bulk operations with confirmation.

Labels:

```text
EXCELLENT       — preferred source for training and evaluation
USABLE          — valid supporting source
COACHING_ONLY   — retain for progress, exclude from presenter dataset
REJECTED        — exclude but retain source session unless deleted
DELETE          — remove under retention/deletion flow
```

Suggested rejection reasons:

- weak contact;
- unnatural expression;
- verbal mistake;
- audio noise;
- clipping;
- focus/exposure issue;
- duplicate;
- unwanted outfit/background;
- privacy-sensitive content;
- interrupted;
- poor sync;
- simply not representative.

### 13.12 Work package P3-J — Coverage map

Coverage dimensions:

#### Delivery style

- neutral;
- conversational;
- explanatory;
- persuasive;
- enthusiastic;
- serious;
- reflective;
- urgent but controlled;
- warm greeting;
- call to action.

#### Speech

- slow, normal, and faster pace;
- short and long sentences;
- questions;
- numbers, names, acronyms;
- broad phoneme and viseme coverage;
- soft and emphatic delivery;
- natural pauses.

#### Visual motion

- direct neutral pose;
- subtle head turns;
- nods;
- eyebrow emphasis;
- smiles of different intensity;
- listening expression;
- thinking pause;
- controlled upper-body gestures;
- natural blink distribution.

#### Capture context

- approved outfit/look;
- background;
- lighting setup;
- camera profile;
- glasses state;
- facial hair state if it changes over time;
- framing width.

Coverage UI should answer:

- What is missing?
- What is overrepresented?
- Which assets are redundant?
- Which capture setup produces the best quality?
- Which categories have only one fragile source clip?

### 13.13 Work package P3-K — Duplicate and diversity analysis

Start with non-biometric signals:

- transcript similarity;
- audio fingerprint;
- temporal overlap with same source;
- visual perceptual hash of sampled frames;
- motion-descriptor similarity;
- same look/background/session.

Use identity embeddings only if a clear need arises; they add privacy sensitivity without helping when every asset depicts the same person.

### 13.14 Work package P3-L — Dataset versions and export

Create a dataset version only after explicit confirmation.

Export package:

```text
presenter_dataset_v003/
├── README.md
├── manifest.json
├── manifest.sha256
├── consent_manifest.json
├── clips/
│   ├── clip_0001.mp4
│   └── ...
├── audio/
├── transcripts/
├── tracking/
├── coverage_report.json
├── quality_report.json
└── provenance/
```

Export options:

- full portable package;
- media only;
- metadata only;
- provider-specific adapter;
- anonymized evaluation package where possible;
- encrypted archive.

### 13.15 Work package P3-M — Consent center

The consent center must show:

- what is recorded;
- what is in each dataset version;
- whether face training is allowed;
- whether voice training is allowed;
- what has been exported and where;
- which generated outputs used which assets;
- how to revoke and create a clean new version;
- what deletion can and cannot remove from external services/backups.

No checkbox bundle should combine face and voice permission.

### 13.16 Phase 3 test plan

#### Recording reliability

- one-hour built-in capture;
- one-hour Brio + Yeti capture;
- multi-hour segmented session;
- disk fills during recording;
- app force-quit;
- camera disconnect;
- microphone disconnect;
- sleep/wake attempt;
- thermal pressure;
- encoder slowdown;
- corrupt/incomplete container recovery.

#### Data integrity

- hash verification;
- immutable original enforcement;
- transaction rollback;
- manifest atomic write;
- dataset version reproducibility;
- revoked asset excluded from new version;
- export re-import verification.

#### Analysis

- transcript timing;
- clip boundaries;
- quality flags against known fixtures;
- duplicate detection;
- coverage update after label change;
- worker failure and retry;
- model-version migration without overwriting old results.

#### Privacy

- recording cannot start without consent;
- dataset promotion requires a separate action;
- cloud export blocked without scope;
- voice assets excluded when voice consent is absent;
- deletion report is accurate;
- logs do not contain unnecessary raw transcript or biometric data.

### 13.17 Phase 3 exit criteria

- Studio Capture reliably records a high-quality master and unprocessed audio;
- long-session drift is measured and corrected in a derivative when necessary;
- interrupted sessions are recoverable or explicitly invalid;
- automatic analysis produces useful candidates;
- no candidate enters a dataset without human approval;
- dataset versions are immutable and reproducible;
- every asset has source, hash, consent, and analysis lineage;
- a complete package can be exported and revalidated;
- revocation produces a new valid version without revoked assets;
- storage use and deletion are understandable.

### 13.18 Phase 3 deliverables

```text
Production CaptureCore
Studio preflight
Safe finalization and recovery
Transcription pipeline
Offline face/motion analysis
Automatic segment proposals
Curation UI
Coverage map
Immutable dataset versions
Portable export format
Consent center
Dataset Engine acceptance report
```


---

## Phase 4 — Presenter-twin proof

### 14.1 Objective

Run a controlled proof that answers the central product question:

> Does intentionally coached, curated footage produce a more convincing presenter twin than ordinary uncoached source footage?

This phase is an experiment, not a broad model-development program.

### 14.2 Phase 4 scope

In scope:

- one or more existing avatar/generation systems;
- controlled source packages;
- same-script comparisons;
- real voice as the preferred first audio path;
- blind human evaluation;
- generation quality rubric;
- documentation of provider requirements;
- a decision on whether the presenter-twin thesis is validated.

Out of scope:

- training a foundation model from scratch;
- full-body generation;
- real-time interactive output;
- production voice cloning;
- supporting many vendors before one controlled proof succeeds.

### 14.3 Experimental conditions

Create at least four source conditions:

#### Condition A — Uncoached baseline

- ordinary usable webcam footage;
- no camera-contact coaching;
- minimal curation;
- otherwise acceptable audio and lighting.

#### Condition B — Coached continuous take

- one clean continuous take following the target provider’s recording guidance;
- strong natural lens contact;
- controlled movement;
- stable lighting and framing.

#### Condition C — Curated diverse set

- approved clips from the Dataset Engine;
- multiple expressions and delivery modes;
- consistent identity and technical quality;
- deliberately broader coverage.

#### Condition D — Real-video reference

- a real recording of the final test script;
- not generated;
- used as the quality ceiling and identity reference.

### 14.4 Keep test inputs controlled

For all generated conditions:

- use the same script;
- use the same real voice recording where the provider permits;
- use equivalent resolution, crop, and duration;
- avoid changing background or wardrobe unless that variable is the test;
- record provider/model/version/date;
- record all settings and seeds when available;
- generate multiple candidates to account for stochastic variation.

### 14.5 Provider-adapter spike

Before choosing a provider, document:

- accepted source duration;
- resolution and codec;
- need for continuous versus segmented footage;
- consent/identity-verification process;
- whether voice can be supplied separately;
- retention and deletion policy;
- training turnaround;
- API or manual workflow;
- output rights;
- cost;
- watermark/provenance behavior;
- whether the provider trains a reusable personal avatar or only animates one source.

The proof may use a commercial service, a local open-source system, or both. Do not let provider integration dominate the experiment.

### 14.6 Evaluation rubric

Use a 1–5 or pairwise preference scale for each dimension:

#### Identity and appearance

- facial likeness;
- skin and hair consistency;
- eye shape and stability;
- teeth/mouth consistency;
- wardrobe/background stability.

#### Camera presence

- directness of camera contact;
- natural blinking;
- absence of wandering or crossed gaze;
- sentence-opening and ending engagement;
- feeling of addressing the viewer.

#### Speech synchronization

- lip-sync accuracy;
- consonant and vowel articulation;
- jaw movement;
- pause behavior;
- latency between audio and visible speech.

#### Motion and expression

- natural head movement;
- expression relevance;
- temporal continuity;
- absence of freezing or overanimation;
- believable transitions.

#### Artifact burden

- mouth tearing or blur;
- eye flicker;
- identity drift;
- frame-to-frame jitter;
- background warping;
- uncanny or unusable moments.

#### Overall usefulness

- usable without editing;
- usable after minor editing;
- suitable for a short social clip;
- suitable for a presentation insert;
- clearly inferior to a real recording.

### 14.7 Blind comparison protocol

- Randomize candidate order.
- Hide source condition and provider.
- Compare matched scripts.
- Include repeated candidates to estimate evaluator consistency.
- Capture both ratings and preference reasons.
- Perform a separate expert review with frame-by-frame artifact inspection.
- Keep the real reference in the set but label it only after scoring.

### 14.8 Hypotheses

Primary hypothesis:

```text
Coached source footage produces higher camera-presence and overall-usefulness scores than uncoached source footage.
```

Secondary hypotheses:

- curated diversity improves expression and motion over one continuous take;
- strong source eye contact reduces generated gaze drift;
- real-audio-driven video is more convincing than simultaneous first-generation voice cloning;
- source consistency matters more than raw footage quantity after a minimum coverage level.

### 14.9 Success gate

Phase 4 succeeds when:

- the coached condition wins a clear majority of matched pairwise comparisons over the uncoached condition;
- at least one 10–60 second generated candidate is acceptable for the intended presenter use case;
- source-to-output lineage is reproducible;
- the provider does not require unacceptable data-control compromises;
- remaining defects can be assigned to source coverage, provider limitations, or generation settings;
- the result justifies integrating generation into the app.

Do not declare success solely because a clip can be generated. It must be useful and visibly benefit from the coached dataset.

### 14.10 Failure interpretations

If coached and uncoached conditions perform equally:

- the provider may ignore most source variation;
- the coach may be measuring a behavior that the generator does not preserve;
- the continuous-take requirement may dominate;
- the test may have insufficient source contrast;
- the generated model may impose its own fixed gaze.

If curated diversity performs worse:

- source inconsistency may be confusing the system;
- outfit/background variation may be too broad;
- the provider may expect a single continuous take;
- automatically selected clips may need stricter visual consistency.

If all generated output is poor:

- do not proceed directly to custom model training;
- first isolate whether the failure is lip sync, identity, motion, source quality, or provider suitability;
- test a second technically distinct provider or local pipeline.

### 14.11 Phase 4 deliverables

```text
Controlled source packages A–D
Provider requirements report
Generation request manifests
Candidate archive
Blind evaluation results
Artifact analysis
Validated or rejected presenter-twin hypothesis
Phase 5 go/no-go decision
```

---

## Phase 5 — Local generation adapter

### 15.1 Objective

Bring presenter generation into the application as a controlled, repeatable, provider-neutral workflow, prioritizing local execution on the existing Apple-Silicon system while retaining optional cloud adapters.

### 15.2 Phase 5 scope

In scope:

- generation request model;
- provider registry;
- local worker supervision;
- model and dependency registry;
- script/audio input;
- real-voice-driven generation;
- portrait animation and lip-sync model evaluation;
- multiple candidates;
- candidate comparison;
- job recovery and cancellation;
- resource scheduling;
- output lineage and provenance;
- provider-specific dataset exports.

Out of scope:

- guaranteed real-time generation;
- general cinematic full-body scenes;
- automatic publishing;
- unrestricted third-party access to the user’s model;
- a single permanent model choice.

### 15.3 Local-model strategy

Treat individual models as replaceable renderers.

Candidate building blocks include:

- portrait animation systems such as LivePortrait, whose official implementation supports portrait animation, video-to-video use, and Apple-Silicon macOS operation;[^liveportrait]
- lip-sync systems such as MuseTalk, whose repository provides inference and training code, while published real-time claims are tied to NVIDIA hardware and must not be assumed on macOS;[^musetalk]
- the user’s existing ComfyUI and MLX video-generation workflows for background, stylization, or longer shot experimentation;
- future models that outperform these candidates.

The app should not encode `LivePortrait` or `MuseTalk` concepts into core tables. It should encode generic source, driving audio/video, identity assets, settings, job state, and artifacts.

### 15.4 Work package P5-A — Generation request contract

```json
{
  "schema_version": "1.0",
  "job_id": "uuid",
  "provider_id": "local-presenter-v1",
  "dataset_version_id": "uuid",
  "appearance_profile_id": "uuid",
  "input": {
    "type": "audio",
    "audio_asset_id": "uuid",
    "script_text": "optional transcript"
  },
  "voice": {
    "mode": "real_recording",
    "consent_id": "uuid"
  },
  "output": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration_limit_sec": 60,
    "candidate_count": 4
  },
  "render": {
    "seed": null,
    "motion_strength": 1.0,
    "expression_profile": "conversational",
    "background_mode": "source"
  },
  "consent": {
    "face_generation_consent_id": "uuid",
    "cloud_export_consent_id": null
  }
}
```

### 15.5 Work package P5-B — Provider registry

Provider records include:

- provider ID and version;
- local/cloud;
- supported input types;
- maximum duration/resolution;
- required source format;
- model license and redistribution constraints;
- installed dependency state;
- estimated memory/storage requirements;
- privacy behavior;
- cancellation support;
- seed/reproducibility support;
- output provenance support.

The UI should expose capabilities, not unsupported controls.

### 15.6 Work package P5-C — Model installation and validation

Tasks:

- [ ] Define model package manifest.
- [ ] Verify checksums after download/import.
- [ ] Record license and source URL.
- [ ] Keep models outside the application bundle when size requires.
- [ ] Support uninstall without deleting user datasets.
- [ ] Run a known test render after installation.
- [ ] Detect incompatible Python, PyTorch, MLX, CUDA-only, or FFmpeg dependencies.
- [ ] Isolate worker environments to avoid dependency collisions.
- [ ] Never auto-upgrade a model used by a reproducible project without preserving the old version.

### 15.7 Work package P5-D — Local worker orchestration

Job states:

```text
QUEUED
VALIDATING
PREPARING_INPUTS
LOADING_MODEL
RENDERING
POST_PROCESSING
VALIDATING_OUTPUT
COMPLETED
FAILED
CANCEL_REQUESTED
CANCELLED
RECOVERY_REQUIRED
```

Tasks:

- [ ] Queue and prioritize jobs.
- [ ] Limit concurrent heavy workers.
- [ ] Reserve memory and disk before launch.
- [ ] Stream progress and logs.
- [ ] Detect worker heartbeat loss.
- [ ] Cancel safely.
- [ ] Preserve partial diagnostic artifacts without presenting them as candidates.
- [ ] Resume only when a provider explicitly supports it.
- [ ] Validate output duration, decodability, audio, frame rate, and hash.

### 15.8 Work package P5-E — Input preparation

Depending on provider:

- select representative source portrait or clip;
- crop and align face;
- normalize frame rate;
- prepare driving audio;
- add lead/tail silence;
- normalize audio without destructive overprocessing;
- select motion template;
- prepare masks;
- preserve all transformations in request lineage.

Input preparation must be deterministic and cached by input hash plus transform version.

### 15.9 Work package P5-F — Real voice first

The first production generation path should be:

```text
User records final narration
  → audio quality check
  → transcript alignment
  → presenter video generation / lip sync
  → candidate comparison
```

Benefits:

- real cadence and emphasis;
- no voice-model risk;
- simpler consent;
- easier evaluation of the visual generator;
- immediate fallback to a real talking-head recording when generation fails.

The recording UI should optionally reuse Studio Capture microphone settings without requiring video.

### 15.10 Work package P5-G — Candidate generation

For every request:

- produce more than one candidate when stochasticity exists;
- keep the same input and settings visible;
- expose only meaningful provider parameters;
- mark failed or partial candidates;
- create review proxies without altering originals;
- preserve model logs for diagnostics;
- avoid automatically selecting “best” until automatic metrics are validated.

### 15.11 Work package P5-H — Candidate comparison UI

Views:

- synchronized side-by-side playback;
- A/B keyboard toggle;
- loop selected interval;
- audio on one candidate at a time;
- frame stepping;
- eye, mouth, and full-frame zoom;
- real-reference comparison;
- rubric entry;
- artifact bookmarks;
- blind mode;
- provider/settings reveal after rating.

User labels:

```text
APPROVED
APPROVED_WITH_EDIT
REGENERATE
REJECT_IDENTITY
REJECT_GAZE
REJECT_LIPSYNC
REJECT_MOTION
REJECT_ARTIFACT
REJECT_VOICE
```

### 15.12 Work package P5-I — Automatic generation metrics

Automatic metrics can assist but must not replace visual review:

- audio/video sync estimate;
- face-detection continuity;
- eye-position stability;
- identity-consistency metric where consent permits;
- frame-interpolation/jitter signals;
- mouth-region temporal artifacts;
- black-frame or frozen-frame detection;
- output clipping and audio integrity;
- camera-contact score using the same review engine.

Keep automatic and human scores separate to learn which metrics actually predict acceptance.

### 15.13 Work package P5-J — Resource governor

The existing 128 GB Apple-Silicon Mac is capable of substantial local workloads, but the app should not assume unlimited memory or leave several large models resident.

Tasks:

- [ ] Query available memory and disk.
- [ ] Estimate per-provider requirements.
- [ ] Run one heavy generation model at a time by default.
- [ ] Pause nonessential offline analysis during generation.
- [ ] Release models after configurable idle period.
- [ ] Provide low-memory and full-quality modes.
- [ ] Monitor thermal pressure.
- [ ] Never interrupt an active master recording to start generation.
- [ ] Allow overnight queues with explicit power/sleep settings guidance.

### 15.14 Work package P5-K — Cloud adapter boundary

A cloud adapter may receive only the assets needed for the selected job.

Before upload, display:

- destination/provider;
- exact files;
- face and voice content included;
- purpose;
- provider retention/deletion terms as recorded in the adapter;
- expected cost;
- whether the provider creates a reusable identity model;
- applicable consent scopes.

After upload:

- log destination and provider job ID;
- preserve a deletion-request action when supported;
- record response and deletion confirmation;
- never treat provider deletion as proof that all backups vanished unless the provider explicitly guarantees it.

### 15.15 Work package P5-L — Provenance and export

Every approved generated clip should have a sidecar manifest containing:

- generated status;
- user identity owner ID local to the app;
- generation timestamp;
- source dataset version;
- source audio hash;
- provider and model version;
- settings;
- candidate ID;
- human approval state;
- editing steps;
- export destination if recorded.

Where tooling supports it, attach a C2PA manifest. C2PA provides a standard for cryptographically bound, tamper-evident provenance statements, but it does not itself prove that every statement is true; the app should explain that distinction.[^c2pa]

### 15.16 Phase 5 test plan

#### Provider contract

- capability discovery;
- unsupported input rejected before job launch;
- missing model detected;
- request schema migration;
- deterministic hash and cache key;
- provider failure normalized to stable app error codes.

#### Worker reliability

- worker crash;
- cancellation;
- disk-low;
- out-of-memory;
- malformed output;
- model load failure;
- app restart during job;
- corrupted model checksum;
- two jobs competing for resources.

#### Output validation

- decodable video;
- correct duration and frame rate;
- synchronized audio;
- no missing candidate file;
- provenance points to exact source/version;
- rejected output never appears as approved;
- cloud and local results share the same review model.

### 15.17 Phase 5 exit criteria

- at least one local provider completes a useful presenter clip;
- at least one optional external provider can be integrated without changing core data models;
- real-voice-driven generation is supported;
- jobs survive or fail cleanly across app/worker interruptions;
- candidate comparison is fast and evidence-based;
- model versions and settings are reproducible;
- generation cannot access a dataset or voice corpus without matching consent;
- every exported generated clip has lineage and generated-media disclosure.

### 15.18 Phase 5 deliverables

```text
Generation provider registry
Local model-package system
Generation request contract
Worker queue and resource governor
Real-voice presenter pipeline
Candidate comparison UI
Automatic output validation
Cloud adapter consent boundary
Provenance/export manifest
Local Generation acceptance report
```

---

## Phase 6 — Personal motion, expression, voice, and real-time expansion

### 16.1 Objective

Increase the presenter twin’s resemblance to the real presenter beyond static facial identity by learning or selecting characteristic voice, cadence, expressions, head movement, gestures, and approved visual looks. Add real-time output only after offline quality and identity controls are mature.

Phase 6 is a collection of separately gated programs, not one giant release.

### 16.2 Phase 6A — Voice cloning

#### Scope

- separate voice-consent flow;
- deliberate voice-capture curriculum;
- versioned voice datasets;
- local or provider-neutral voice model;
- pronunciation dictionary;
- evaluation against real recordings;
- revocation and deletion;
- visible synthetic-voice disclosure.

#### Voice capture protocol

Collect clean Studio-profile audio with:

- fixed Yeti position and cardioid mode;
- stable room acoustics;
- unprocessed 48 kHz source;
- room-tone samples;
- normal, warm, serious, enthusiastic, and emphatic delivery;
- questions and statements;
- numbers, dates, names, acronyms, and difficult words;
- varied sentence lengths;
- broad phonetic coverage;
- natural pauses and breaths;
- separate takes rather than one exhausting session.

Do not train on:

- clipped audio;
- aggressive denoising artifacts;
- background music;
- another speaker;
- illness-related voice changes unless intentionally desired;
- private speech accidentally captured during a video session;
- coaching-only clips without voice permission.

#### Voice dataset record

```json
{
  "voice_dataset_id": "uuid",
  "version": 1,
  "consent_id": "uuid",
  "assets": [],
  "capture_profile_id": "uuid",
  "language": "en",
  "style_coverage": {},
  "phonetic_coverage": {},
  "quality_summary": {},
  "created_at": "ISO-8601"
}
```

#### Voice evaluation

Compare cloned and real recordings for:

- identity likeness;
- intelligibility;
- prosody;
- emotional appropriateness;
- pronunciation;
- stability on long sentences;
- breath/noise artifacts;
- speaker similarity versus over-smoothed generic voice;
- user comfort and approval.

Use blind A/B tests and keep a “real voice required” option permanently available.

#### Voice safeguards

- Face consent never implies voice consent.
- A voice model is an explicit asset with its own delete action.
- Cloud voice export shows exact files and provider.
- Generated audio carries a synthetic-audio manifest.
- The app requires a local unlock or OS authentication before exporting a reusable voice model.
- API access to the voice model is disabled by default.
- No automatic telephone, authentication, or impersonation workflows.

#### Voice exit criteria

- cloned output is consistently recognizable and intelligible;
- pronunciation can be corrected;
- the user prefers it for at least some use cases over recording new narration;
- model deletion/revocation is tested;
- face-only workflows remain unaffected when voice is disabled.

### 16.3 Phase 6B — Personal motion and expression

#### Strategy order

1. **Retrieval before training:** select real approved motion templates matching the desired delivery.
2. **Parameterized retargeting:** adjust intensity, speed, and range.
3. **Personal motion adapter:** fine-tune only after enough diverse, approved examples exist.
4. **End-to-end personalized generation:** only if simpler approaches cannot preserve likeness and motion.

#### Motion descriptors

- head yaw/pitch/roll trajectories;
- nod frequency and amplitude;
- blink timing;
- brow emphasis;
- smile onset and intensity;
- mouth-rest behavior;
- shoulder/upper-torso motion;
- gesture timing where visible;
- pause posture;
- sentence-boundary movement;
- speaking-rate relation to motion.

#### Expression library

Create approved expression exemplars:

- neutral attentive;
- warm greeting;
- small smile;
- strong smile;
- serious emphasis;
- reflective pause;
- listening;
- surprise/interest at restrained intensity;
- persuasive emphasis;
- conclusion/call to action.

Each exemplar references real footage and an approved intensity range. The generator should not invent exaggerated emotion by default.

#### Motion evaluation

- Does movement resemble the real presenter?
- Is it temporally coherent?
- Does it support rather than compete with speech?
- Are pauses natural?
- Are gestures repeated mechanically?
- Does increased motion damage face identity or gaze?
- Does the avatar remain camera-engaged?

#### Motion exit criteria

- personalized motion wins blind comparisons over generic motion;
- no unacceptable increase in identity drift or artifacts;
- motion style can be selected and intensity controlled;
- every motion adapter names its source dataset version.

### 16.4 Phase 6C — Appearance profiles and looks

An appearance profile is a curated, consented identity presentation, not merely an arbitrary prompt.

Fields:

- name;
- source dataset version;
- wardrobe description;
- glasses/facial-hair state;
- lighting profile;
- camera crop;
- background policy;
- approved reference frames;
- intended use;
- expiration or review date.

Examples:

```text
Studio Neutral
Livestream Blue Shirt
Formal Presentation
Casual Explainer
```

Rules:

- Do not mix materially different looks into one identity adapter without testing.
- Keep look-specific source coverage visible.
- Avoid creating an appearance the user has not approved as representative.
- Record every generated clip’s selected look.

### 16.5 Phase 6D — Background and scene generation

Start with the lowest-risk options:

1. retain source background;
2. cleanly remove and replace background;
3. use approved static virtual sets;
4. generate subtle environment motion;
5. only later attempt complex scene interaction.

Requirements:

- preserve hair and shoulder edges;
- avoid background motion that changes apparent head geometry;
- keep lighting direction consistent;
- maintain readable separation between presenter and background;
- record background source/generator in provenance;
- provide a neutral safe fallback.

### 16.6 Phase 6E — Real-time presenter twin

Real-time output is the final branch because it combines the hardest requirements:

- low-latency audio capture;
- streaming speech or TTS;
- incremental lip sync;
- stable identity;
- continuous motion;
- virtual-camera output;
- recovery from model stalls;
- live privacy and disclosure.

#### Real-time pipeline

```text
Live microphone or text stream
       ↓
Voice path: real voice OR low-latency synthetic voice
       ↓
Incremental phoneme/audio features
       ↓
Portrait/motion renderer
       ↓
Frame scheduler and A/V synchronizer
       ↓
Clean virtual camera + audio device
       ↓
OBS / conferencing / livestream platform
```

#### Latency budget categories

- audio buffering;
- speech/phoneme analysis;
- render inference;
- post-processing;
- frame queue;
- virtual-device delivery;
- receiving application buffering.

Do not market “real time” until measured mouth-to-audio latency and frame stability are acceptable in the complete path, not just inside a model benchmark.

#### Fail-safe behavior

- one-key switch to real camera;
- frozen-frame prevention;
- visible local warning when generation stalls;
- outgoing slate or safe fallback frame;
- no accidental switch from real to synthetic output;
- recording and synthetic-output states independently visible;
- no coaching HUD burned into clean output.

#### Real-time exit criteria

- complete path survives an extended livestream test;
- A/V synchronization remains acceptable;
- fallback to real camera works immediately;
- the user can tell at all times what is being transmitted;
- synthetic disclosure/provenance is supported where the platform permits;
- quality is clearly better than using the offline renderer in a fragile improvised stream.

### 16.7 Phase 6F — Closed-loop learning

After voice and motion exist, the app can recommend capture needs based on generation reviews.

Example rules:

```text
IF generated smile looks unstable
AND dataset has fewer than N approved small-smile segments
THEN request a controlled small-smile capture drill.

IF pronunciation errors cluster around proper names
THEN add those names to the pronunciation capture list.

IF generic motion is repeatedly preferred over personal motion
THEN suspend personal adapter promotion and inspect source consistency.
```

No model should silently retrain after a review. The app proposes a dataset update, shows affected assets, and requires explicit approval.

### 16.8 Phase 6 test plan

#### Voice

- voice consent isolation;
- source-quality gates;
- pronunciation correction;
- long-form stability;
- model delete/revoke;
- real-versus-cloned blind comparison;
- synthetic manifest.

#### Motion

- generic versus retrieval-based versus personalized;
- identity preservation;
- temporal stability;
- gaze preservation;
- intensity limits;
- source lineage.

#### Looks/backgrounds

- profile isolation;
- hair/edge artifacts;
- lighting consistency;
- look versioning;
- background fallback.

#### Real time

- end-to-end latency;
- hour-long stability;
- worker stall;
- network or platform interruption;
- virtual camera reconnect;
- instant real-camera fallback;
- privacy-state clarity.

### 16.9 Phase 6 deliverables

```text
Separately consented voice dataset and optional voice model
Voice evaluation suite
Personal motion descriptor library
Retrieval-based motion profiles
Optional personal motion adapter
Approved appearance profiles
Background replacement/generation pipeline
Real-time architecture and virtual-camera output
Fail-safe real-camera fallback
Closed-loop capture recommendations
Phase 6 safety and quality reports
```


---

# 17. Cross-cutting implementation requirements

## 17.1 Privacy, security, consent, and identity safety

### 17.1.1 Threat model

Protect against:

- accidental recording;
- another local account opening raw footage;
- cloud upload without informed action;
- theft of reusable face or voice adapters;
- stale dataset versions continuing to contain revoked assets;
- logs leaking transcripts or file paths;
- generated media losing its synthetic label;
- third-party provider retention;
- compromised local worker or dependency;
- model output being published without review;
- ambiguity about whether the real or synthetic camera is live.

### 17.1.2 Consent architecture

Every consent is:

- scoped;
- explicit;
- timestamped;
- versioned to human-readable terms;
- tied to a target asset/dataset/job where practical;
- revocable;
- recorded in the audit log.

Required separations:

```text
recording ≠ dataset inclusion
face dataset ≠ voice dataset
local generation ≠ cloud export
generation ≠ publication
one dataset version ≠ all future versions
```

### 17.1.3 Recording indicators

The application must provide:

- persistent visible red recording state;
- optional audible start/stop cue;
- countdown before recording;
- menu-bar or dock indication where feasible;
- no auto-resume after crash or relaunch;
- clear distinction between camera preview and recording.

### 17.1.4 Local encryption

Recommended approach:

- rely on FileVault as the system baseline;
- offer an optional app-managed encrypted vault for media and personal model artifacts;
- store vault keys in macOS Keychain, gated by user presence for sensitive exports;
- encrypt cloud API credentials in Keychain;
- never place secrets in project files, logs, or manifests;
- use cryptographic erasure for app-managed encrypted assets.

### 17.1.5 Network boundary

Default state: no network required and no background upload.

Every network action should identify:

- domain/provider;
- reason;
- exact asset class;
- expected size;
- whether face or voice data is included;
- whether data creates a reusable model;
- cancellation possibility.

Provide a `Local Only` mode that disables all provider adapters and telemetry.

### 17.1.6 Dependency and worker security

- pin worker dependencies;
- verify model and binary checksums;
- store license/source metadata;
- run workers with the minimum filesystem scope possible;
- expose only job-specific directories;
- validate all worker JSON;
- treat media files as untrusted input;
- avoid shell construction from user text;
- sign and notarize bundled helpers;
- maintain a software bill of materials for releases.

### 17.1.7 Provenance

For real source recordings, provenance may state:

- captured by the application;
- timestamp;
- device profile;
- whether processing created a derivative;
- hashes and edit lineage.

For synthetic output, provenance should state:

- generated or substantially AI-modified;
- source dataset version;
- provider/model;
- voice mode;
- human approval;
- subsequent edits.

Content Credentials/C2PA should be an export enhancement, not the sole provenance database. The local manifest remains authoritative for the application.[^c2pa]

### 17.1.8 Privacy-safe logging

Default logs include:

- IDs, states, durations, versions, and error codes;
- no full transcript;
- no facial landmarks unless an explicit diagnostic bundle is created;
- no API secrets;
- no raw cloud responses containing sensitive data;
- relative or redacted paths.

A user-created support bundle should preview exactly what will be included.

---

## 17.2 Storage, codecs, and retention

### 17.2.1 Planning estimates

Approximate storage based on selected bitrates:

| Stream | Example bitrate | Approximate size per hour |
|---|---:|---:|
| 4K HEVC master | 35 Mb/s | 15.75 GB |
| 4K HEVC master | 60 Mb/s | 27.00 GB |
| 1080p H.264/HEVC | 8 Mb/s | 3.60 GB |
| 1080p H.264/HEVC | 16 Mb/s | 7.20 GB |
| Mono PCM 48 kHz/16-bit | 0.768 Mb/s | 0.35 GB |

Actual encoded size varies with codec, scene complexity, quality settings, and hardware encoder behavior. The app must calculate its estimate from the active settings rather than displaying one fixed number.

### 17.2.2 Codec policy

Recommended default:

- high-quality HEVC master for long 4K webcam sessions;
- PCM WAV audio master;
- H.264 review proxy for broad playback compatibility;
- provider-specific transcodes only as derivatives;
- no ProRes default because storage growth is disproportionate for this use case;
- allow ProRes only for a deliberately selected high-end capture protocol.

### 17.2.3 Storage tiers

```text
HOT       — recent sessions, proxies, active dataset, active jobs
WARM      — approved source and dataset versions
ARCHIVED  — encrypted external archive with local manifest pointer
TRASH     — pending deletion with expiry and visible restore window
```

### 17.2.4 Retention controls

User-selectable policies:

- keep all original sessions;
- delete non-dataset raw sessions after N days;
- keep coaching metrics but delete media;
- archive Studio masters externally;
- retain only approved segments plus manifest;
- prompt when storage crosses a threshold;
- never delete automatically without an enabled policy and a visible audit record.

### 17.2.5 Cache policy

Safe-to-rebuild cache:

- thumbnails;
- waveforms;
- review proxies;
- temporary input transforms;
- model download fragments;
- intermediate generation frames when not required for reproducibility.

Not cache:

- source masters;
- approved dataset clips;
- consent manifests;
- generation requests and approved outputs;
- personal model adapters.

---

## 17.3 Performance and resource management

### 17.3.1 Priority order during active capture

1. preserve master recording;
2. preserve audio;
3. preserve timestamps and health telemetry;
4. maintain usable preview;
5. run live tracking;
6. render decorative UI.

Under load, reduce analysis frame rate or preview resolution before dropping master frames.

### 17.3.2 Process isolation

Separate heavy workers so that:

- a transcription crash cannot terminate capture;
- a generation out-of-memory event cannot corrupt SQLite;
- model dependencies do not collide;
- workers can be restarted independently;
- active capture can pause all nonessential jobs.

### 17.3.3 Scheduling classes

```text
REALTIME_CAPTURE    — highest application priority
LIVE_ANALYSIS       — high, degradable
SESSION_FINALIZE    — high after capture
REVIEW_PROXY        — normal
TRANSCRIPTION       — background
OFFLINE_ANALYSIS    — background
GENERATION          — exclusive heavy job by default
ARCHIVE/EXPORT      — background, pauseable
```

### 17.3.4 Thermal policy

When macOS reports pressure or measured performance falls:

- reduce analysis FPS;
- reduce analysis resolution;
- pause offline jobs;
- suspend background generation;
- warn before a recording mode becomes unsustainable;
- never silently change master resolution mid-session unless the capture would otherwise fail, and log any emergency change.

---

## 17.4 Accessibility and interaction design

Requirements:

- complete keyboard control;
- configurable global start/stop shortcut;
- large controls near the lens during setup;
- scalable text;
- high-contrast and reduced-motion options;
- screen-reader names and state announcements;
- no dependence on red/green color alone;
- captions/transcripts for all recorded speech;
- adjustable cue sound and visual feedback;
- ability to operate from a stable seated position without reaching for the camera;
- optional remote control from a keyboard shortcut or supported device only after the core app is stable;
- avoid forcing fine pointer precision during recording.

The interface should require minimal visual scanning while speaking. The speaker’s attention belongs on the lens, not the dashboard.

---

## 17.5 Observability and diagnostics

### 17.5.1 Structured events

Examples:

```text
capture.session.started
capture.video.frame_drop
capture.audio.discontinuity
tracking.provider.timeout
calibration.quality.low
coaching.cue.emitted
session.finalization.completed
analysis.transcription.failed
dataset.version.created
consent.revoked
generation.job.failed
export.generated_media.completed
```

Each event includes:

- timestamp;
- correlation/session/job ID;
- app version;
- provider/model version where applicable;
- severity;
- stable error code;
- safe context.

### 17.5.2 Health panel

Developer/advanced-user panel:

- device states;
- active formats;
- frame rate and drops;
- audio level and discontinuities;
- capture-to-cue latency;
- tracking confidence;
- queued workers;
- memory/disk use;
- current calibration and model versions;
- latest failed job and recovery action.

### 17.5.3 Reproducible debug bundle

With user confirmation, export:

- app and OS version;
- hardware profile without serial number where possible;
- manifest and settings;
- logs;
- anonymized timing metrics;
- optional selected short media excerpt only when separately checked;
- no full session by default.

---

# 18. Testing and quality strategy

## 18.1 Test pyramid

### Unit tests

- state machines;
- calibration math;
- temporal smoothing;
- gaze event construction;
- session metrics;
- drill validation;
- consent rules;
- dataset manifest generation;
- hash and lineage logic;
- provider request validation;
- storage estimates;
- migration logic.

### Contract tests

- CaptureCore IPC;
- tracker result schema;
- worker request/response;
- generation provider interface;
- export schema;
- version migration;
- error-code normalization.

### Integration tests

- device → capture → tracker → session;
- session → finalize → analyze → review;
- review label → dataset version;
- dataset → generation → candidate review;
- consent revoke → new dataset version;
- app restart → job/session recovery.

### End-to-end tests

Automate UI flows that do not require a physical camera using prerecorded fixtures and virtual/mock providers. Keep physical-device tests as a separate hardware suite.

## 18.2 Golden media corpus

Maintain a small, consent-cleared test corpus containing:

- direct camera contact;
- screen-center gaze;
- downward notes;
- left/right gaze;
- blinks;
- tracking loss;
- audio clipping;
- background noise;
- A/V offset;
- frame drops;
- clean and poor candidate clips;
- generated artifacts.

For private user footage, store evaluation labels locally and never commit media to the repository.

## 18.3 Hardware matrix

| Test | MacBook Practice | Brio + Yeti Studio |
|---|---:|---:|
| Preview | Required | Required |
| Calibration | Required | Required |
| 30-minute session | Required | Required |
| 60-minute recording | Recommended | Required |
| Device disconnect | Built-in simulated/permission path | Required physical test |
| Sleep/wake | Required | Required |
| Low light | Required | Required |
| Glasses/reflection | As relevant | As relevant |
| External display | Optional | Required when used in studio |
| OBS/Zoom contention | Required before live assist | Required before live assist |

## 18.4 Soak and failure testing

- repeated start/stop cycles;
- 100-session database growth;
- multi-hour recording split into segments;
- generation queue overnight;
- low disk;
- worker leak detection;
- model install/uninstall cycles;
- app update and database migration;
- power interruption simulation;
- cloud provider timeout;
- provider returns malformed media;
- revoked permission mid-session.

## 18.5 Computer-vision evaluation

Track by model/calibration version:

- precision/recall/F1;
- confusion matrix;
- event onset/offset error;
- false-cue rate;
- unknown rate;
- latency percentiles;
- performance by camera profile;
- performance by lighting/glasses state;
- day-to-day calibration stability.

Never improve headline accuracy by hiding difficult frames as unknown without reporting the unknown rate.

## 18.6 Generation evaluation

Track:

- human acceptance rate;
- candidates per approved output;
- most frequent rejection reason;
- lip-sync estimate;
- contact score;
- temporal artifact count;
- identity consistency where permitted;
- generation time and resource use;
- provider/model version;
- coached versus uncoached source preference.

## 18.7 Privacy and security testing

- permission denial and revocation;
- app relaunch cannot resume recording;
- secret scanning;
- path traversal in imports;
- malformed media;
- malicious worker output;
- cloud upload scope;
- audit-log completeness;
- keychain failure;
- encrypted vault lock/unlock;
- cryptographic erasure flow;
- model export requires authorization;
- generated-media manifest cannot accidentally claim real capture.

## 18.8 Release gates

No phase is considered complete merely because its UI exists. Each release requires:

- automated tests green;
- hardware acceptance suite;
- migration and rollback test;
- privacy checklist;
- performance baseline;
- written known limitations;
- acceptance report with evidence;
- tagged dataset/model/algorithm versions used in evaluation.

---

# 19. Suggested repository structure

```text
camera-presenter-app/
├── apps/
│   └── desktop/
│       ├── src/                         # React/TypeScript UI
│       └── src-tauri/                   # Tauri/Rust application shell
├── native/
│   └── capture-macos/                   # AVFoundation CaptureCore or bridge
├── crates/
│   ├── app-core/                        # state machines and orchestration
│   ├── data-store/                      # SQLite repositories/migrations
│   ├── consent/                         # policy and audit logic
│   ├── media-contracts/                 # shared data structures
│   ├── job-system/                      # worker supervision
│   └── provenance/                      # manifests and hashing
├── packages/
│   ├── contracts/                       # JSON Schema / TS types
│   ├── ui/                              # reusable UI components
│   ├── drills/                          # versioned drill definitions
│   └── evaluation/                      # metric and rubric definitions
├── workers/
│   ├── media-worker/
│   ├── transcription-worker/
│   ├── offline-face-worker/
│   ├── quality-worker/
│   ├── generation-worker/
│   └── provenance-worker/
├── models/
│   └── manifests/                       # metadata only; no large weights in Git
├── fixtures/
│   ├── public-test-media/
│   └── provider-mocks/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   ├── hardware/
│   └── evaluation/
├── docs/
│   ├── adr/
│   ├── architecture/
│   ├── privacy/
│   ├── protocols/
│   ├── benchmarks/
│   └── acceptance/
└── scripts/
    ├── dev/
    ├── package/
    ├── evaluate/
    └── verify-release/
```

## 19.1 Versioning policy

Version independently:

- desktop application;
- database schema;
- capture contract;
- tracking provider/model;
- gaze feature schema;
- calibration schema;
- coaching policy;
- drill definitions;
- transcription model;
- quality rules;
- dataset manifest schema;
- generation provider/model;
- personal adapters;
- provenance schema.

A session or generated output must record every version that materially affected it.

## 19.2 Branch and release policy

Recommended:

- `main` always passes automated tests;
- short feature branches;
- feature flags for unstable tracking/generation work;
- signed release tags;
- schema migration tested against a copy of a real local database;
- local beta channel before public distribution;
- no automatic model upgrades in stable releases.

---

# 20. Parallel workstreams and ownership

A small team or multiple builders can work in parallel only after shared contracts are frozen.

## Workstream A — Desktop product and coaching UX

Owns:

- Tauri/React shell;
- Train/Review/Dataset/Generate screens;
- drill engine;
- timeline;
- progress;
- live-assist HUD;
- accessibility;
- application state.

Must not invent tracking or dataset formats independently.

## Workstream B — Capture, tracking, and measurement

Owns:

- native CaptureCore;
- devices and profiles;
- tracker benchmark;
- calibration;
- contact classifier;
- event generation;
- capture performance and recovery;
- measurement evaluation.

Must provide stable contracts and fixtures to Workstream A.

## Workstream C — Data, curation, and generation

Owns:

- media workers;
- transcription;
- offline analysis;
- segmentation;
- curation and coverage logic;
- dataset manifests;
- generation providers;
- model packaging;
- provenance.

Must not bypass consent or write directly into another workstream’s tables.

## Integration owner

One owner must control:

- architecture decisions;
- schemas;
- migrations;
- release gates;
- threat model;
- acceptance reports;
- cross-workstream integration.

## Shared-contract rule

Before parallel implementation begins, publish:

- `CaptureEvent` schema;
- `FaceTrackingResult` schema;
- `GazeState` and `GazeEvent` schema;
- `SessionManifest` schema;
- worker job protocol;
- consent scopes;
- dataset manifest;
- generation request/result contract;
- stable error codes.

---

# 21. Milestone roadmap and dependency graph

## 21.1 Dependency graph

```text
Repository + privacy foundation
        ↓
Device profiles + capture spike
        ↓
Tracker benchmark + calibration
        ↓
Personalized measurement kernel
        ↓
Coaching UI + review + progress
        ↓
Production capture + dataset engine
        ↓
Controlled presenter-twin proof
        ↓
Local generation adapter
        ↓
Voice / motion / looks / backgrounds
        ↓
Real-time presenter twin
```

No later phase should rewrite the consent, source-lineage, or immutable-media foundations.

## 21.2 Rough engineering effort bands

These are planning ranges for a focused solo engineer or equivalently sized effort, not delivery promises. Hardware, model, and packaging discoveries can change them substantially.

| Phase | Approximate focused engineering effort |
|---|---:|
| Phase 1 | 4–7 person-weeks |
| Phase 2 | 4–7 person-weeks |
| Phase 3 | 7–12 person-weeks |
| Phase 4 | 2–5 person-weeks |
| Phase 5 | 8–15 person-weeks |
| Phase 6 | Multiple 4–12 person-week subprograms |

The fastest route to user value is still Phase 1 → Phase 2. Phase 3–6 should not delay shipping a useful local coach.

## 21.3 Milestone gates

### M0 — Foundation ready

- repository;
- app shell;
- SQLite;
- privacy/consent framework;
- logging;
- schemas;
- CI.

### M1 — Camera contact measurable

- both profiles;
- calibration;
- tracker selected;
- human-labeling tool;
- held-out benchmark.

### M2 — Coach useful

- drills;
- cues;
- review;
- progress;
- repeated-session evidence.

### M3 — Dataset trustworthy

- production master capture;
- curation;
- coverage;
- versioning;
- export;
- consent/revocation.

### M4 — Thesis proven

- controlled A/B;
- coached source wins;
- useful presenter clip exists.

### M5 — Generation integrated

- local provider;
- multiple candidates;
- resource governor;
- provenance;
- optional cloud adapter.

### M6 — Personalization expanded

- separately approved voice;
- motion/expressions;
- looks;
- backgrounds;
- real-time path with fallback.

---

# 22. Risk register

| Risk | Impact | Mitigation / gate |
|---|---|---|
| Webcam gaze is less accurate than expected | Coaching becomes irritating or misleading | Personal calibration, unknown state, human labeling, Phase 1 gate before coaching expansion |
| Prompt placement teaches screen gaze | Core behavior fails | Lens anchor, constrained near-lens UI, test actual recorded appearance |
| User becomes stiff from overcoaching | Real presentation worsens | Cue cooldown, natural-contact philosophy, review-only mode, subjective comfort tracking |
| Built-in and Brio profiles drift | Metrics become incomparable | Separate calibration and profile-specific trends |
| Brio settings change automatically | Dataset inconsistency | Lock supported settings, preflight actual negotiated mode, invalidate calibration on crop/FOV change |
| Yeti captures excessive room echo | Poor voice dataset | Close placement, cardioid, room check, raw quality gate |
| Long-session USB A/V drift | Lip sync degrades | independent timestamps, drift measurement, corrected derivative, soak tests |
| Raw video consumes too much storage | User disables recording or loses data | HEVC default, estimates, archive tiers, retention policies |
| Automatic curation promotes bad clips | Dataset quality degrades | proposals only; explicit human labels; dataset version gate |
| Repetitive footage creates weak coverage | Hours do not translate into better model | coverage map, duplicate detection, targeted capture protocols |
| One vendor determines product design | Lock-in and data risk | provider-neutral contracts and portable datasets |
| Local model is too slow on Apple Silicon | Generation UX disappoints | offline queue, model benchmark, cloud optional, do not promise real time |
| Open-source model dependencies conflict | Fragile installation | isolated workers/environments, model package manifests, checksums |
| Voice model increases impersonation risk | Severe identity misuse | separate consent, local unlock, no external API by default, provenance |
| Revoked data remains in old models | Consent failure | model-to-dataset lineage, revoke/retrain workflow, clear limits for external providers |
| Generated output loses disclosure | Trust risk | sidecar manifest, embedded metadata/C2PA, export UI |
| Capture crash corrupts source | Lost session | checkpoints, atomic finalization, recovery tests |
| Another app takes camera | Live assist fails | one camera owner, contention tests, virtual camera later |
| Full-body ambition expands scope | Product never becomes useful | presenter-twin non-goal until Phase 6+ separate capture program |
| Metrics imply insecurity/confidence | Harmful product claims | behavior-only language and explainable evidence |
| Model quality changes after update | Reproducibility breaks | pin versions, retain old models, re-benchmark before promotion |

---

# 23. Definition of done by product capability

## Camera profile is done when

- the right devices can be selected reliably;
- actual settings are recorded;
- the profile has its own valid calibration;
- preflight detects critical problems;
- profile changes do not silently reuse incompatible calibration.

## Camera-contact measurement is done when

- held-out human-labeled performance meets the gate;
- unknown is handled honestly;
- false cues are low;
- events link to visible evidence;
- algorithm and calibration are reproducible.

## Coaching session is done when

- it can be completed without interacting away from the lens;
- feedback is restrained;
- metrics exclude invalid intervals;
- review is synchronized;
- recommendations are explainable.

## Recording is done when

- master streams are decodable and hashed;
- actual formats and timing are known;
- finalization status is explicit;
- failure recovery is tested;
- no dataset use is implied by recording.

## Dataset asset is done when

- user approved it;
- source and boundaries are known;
- consent covers intended use;
- technical and coverage metadata exist;
- it belongs to an immutable dataset version;
- it can be revoked from a new version.

## Generated candidate is done when

- request, source, provider, model, and settings are recorded;
- output is validated;
- user evaluated it;
- it is not confused with an approved export;
- provenance identifies it as generated.

## Voice model is done when

- separate consent exists;
- source corpus is versioned;
- quality is validated against real speech;
- deletion/revocation is tested;
- export requires authorization;
- synthetic disclosure is attached.

---

# 24. Initial implementation backlog

This is the recommended order for the first concrete tickets.

This numbered list is retained as the original implementation ordering, not as the live source of
truth for completion. The current Phase 1 state is recorded in Section 11.0 and the detailed
requirements and acceptance ledgers linked there.

## Foundation

1. `APP-001` Scaffold Tauri 2/React/TypeScript application.
2. `APP-002` Add Rust application core and command boundary.
3. `DATA-001` Add SQLite migration runner.
4. `DATA-002` Implement settings and capture-profile repositories.
5. `SEC-001` Add macOS Keychain secret service.
6. `SEC-002` Define consent scopes and audit-log schema.
7. `OBS-001` Add structured local logging.
8. `CONTRACT-001` Publish core JSON schemas.
9. `CI-001` Add lint/test/build workflow.
10. `DOC-001` Write ADR-001 through ADR-010.

## Capture and devices

11. `CAP-001` Enumerate cameras and microphones.
12. `CAP-002` Build permission flow.
13. `CAP-003` Create/save profile UI.
14. `CAP-004` Implement basic preview.
15. `CAP-005` Detect actual negotiated camera format.
16. `CAP-006` Detect device removal.
17. `CAP-007` Run webview/native capture spike.
18. `CAP-008` Produce capture benchmark and select production path.
19. `CAP-009` Implement capture health events.
20. `CAP-010` Add profile-specific lens anchor.

## Tracking and calibration

21. `CV-001` Implement Apple Vision tracker adapter.
22. `CV-002` Implement MediaPipe tracker adapter.
23. `CV-003` Create common tracking-result schema.
24. `CV-004` Build tracker benchmark harness.
25. `CAL-001` Build calibration wizard shell.
26. `CAL-002` Collect lens baseline.
27. `CAL-003` Collect negative targets.
28. `CAL-004` Collect head/eye disambiguation.
29. `CAL-005` Add hidden validation pass.
30. `CAL-006` Persist/version calibration.
31. `GAZE-001` Define normalized feature vector.
32. `GAZE-002` Implement baseline cluster classifier.
33. `GAZE-003` Add temporal smoothing and blink suppression.
34. `GAZE-004` Add gaze-event builder.
35. `GAZE-005` Add current-state halo.

## Evaluation

36. `EVAL-001` Record scripted target session.
37. `EVAL-002` Build interval-labeling review UI.
38. `EVAL-003` Add confusion matrix and event metrics.
39. `EVAL-004` Add tracker-version comparison.
40. `EVAL-005` Run built-in-camera held-out benchmark.
41. `EVAL-006` Run Brio held-out benchmark.
42. `EVAL-007` Measure false-cue rate.
43. `EVAL-008` Publish Phase 1 acceptance report.

## Coaching MVP

44. `DRILL-001` Define drill schema.
45. `DRILL-002` Implement lens-familiarization drill.
46. `DRILL-003` Implement lens-adjacent reading drill.
47. `DRILL-004` Implement prompted-response drill.
48. `COACH-001` Implement feedback policy engine.
49. `COACH-002` Add cue cooldown and user feedback.
50. `REVIEW-001` Build multi-lane timeline.
51. `REVIEW-002` Add transcript alignment.
52. `PROGRESS-001` Add comparable-session trends.
53. `RECOMMEND-001` Add deterministic next-drill rules.
54. `HUD-001` Build compact always-on-top live HUD.
55. `EVAL-009` Publish Phase 2 coaching report.

## Dataset engine

56. `CAP-011` Implement production master recorder.
57. `CAP-012` Add recovery checkpoints.
58. `CAP-013` Add A/V drift measurement.
59. `MEDIA-001` Add media validation and proxy worker.
60. `ASR-001` Add MLX-Whisper worker.
61. `FACE-001` Add offline face-analysis worker.
62. `SEG-001` Add automatic candidate segmentation.
63. `QUALITY-001` Add component quality metrics.
64. `CURATE-001` Build clip-review workflow.
65. `COVERAGE-001` Implement coverage taxonomy and map.
66. `DUP-001` Add duplicate detection.
67. `DATASET-001` Create immutable dataset manifest.
68. `EXPORT-001` Export/re-import portable package.
69. `CONSENT-001` Build consent center and revocation.
70. `EVAL-010` Publish Phase 3 acceptance report.

## Presenter proof and generation

71. `PROOF-001` Build controlled source conditions A–D.
72. `PROOF-002` Document candidate provider requirements.
73. `PROOF-003` Generate matched candidates.
74. `PROOF-004` Build blind comparison rubric.
75. `PROOF-005` Publish Phase 4 result and go/no-go.
76. `GEN-001` Define generation request/result contract.
77. `GEN-002` Implement provider registry.
78. `MODEL-001` Implement model package manifests/checksums.
79. `GEN-003` Implement local worker queue.
80. `GEN-004` Add real-audio input path.
81. `GEN-005` Integrate first local presenter provider.
82. `GEN-006` Build candidate comparison screen.
83. `GEN-007` Add resource governor.
84. `PROV-001` Add generated-media manifest.
85. `EVAL-011` Publish Phase 5 acceptance report.

---

# 25. Decisions to make at phase gates

These decisions should not block Phase 1, but must be resolved with evidence later.

| Decision | Resolve at | Evidence needed |
|---|---|---|
| Swift sidecar vs Rust AVFoundation bridge | Early Phase 1 | Capture benchmark, packaging, latency, reliability |
| Apple Vision vs MediaPipe for live tracking | Mid Phase 1 | Same labeled corpus and latency profile |
| Exact contact thresholds | End Phase 1 | False-cue and held-out event metrics |
| Whether live assist needs virtual camera immediately | End Phase 2 | Camera-contention tests with actual presentation apps |
| Master video bitrate/codec presets | Early Phase 3 | Quality/storage tests and downstream compatibility |
| Optional built-in safety audio | Early Phase 3 | Simultaneous capture reliability and utility |
| First presenter-twin provider | Early Phase 4 | Data policy, source requirements, output quality, reproducibility |
| First local generation model stack | Early Phase 5 | Apple-Silicon benchmark and Phase 4 defect analysis |
| Voice-model provider/architecture | Phase 6A | Voice corpus, privacy, local feasibility, quality |
| Motion retrieval vs fine-tuning | Phase 6B | Generic/retrieval comparison and dataset coverage |
| Real-time architecture | Phase 6E | Offline quality, renderer latency, virtual-camera feasibility |

---

# 26. Final recommended build order

The disciplined build order is:

1. **Prove measurement.** Do not build a large coaching curriculum around an unvalidated gaze signal.
2. **Prove coaching usefulness.** The application must create value without any avatar generation.
3. **Harden recording and data governance.** The dataset is an identity asset and must be trustworthy.
4. **Run the coached-versus-uncoached proof.** Verify that the two halves truly compound.
5. **Integrate generation as a replaceable renderer.** Keep source data and evaluation under application control.
6. **Add voice and motion separately.** Each expands both quality and risk.
7. **Attempt real time last.** Offline quality, identity safety, and fallback must already work.

The most important first release is not an AI avatar. It is a camera-contact coach that can say, with evidence:

> “This is where you addressed the camera, this is where you drifted, this is how quickly you returned, and this is the clean footage you explicitly chose to preserve.”

Once that foundation is reliable, the same evidence and approved footage become the defensible basis for a presenter twin.

---

# 27. Reference baseline

The following official or primary references informed the technology choices. Model and library capabilities should be re-benchmarked when implementation reaches the relevant phase because these projects continue to change.

[^tauri-sidecar]: Tauri, “Embedding External Binaries,” <https://v2.tauri.app/develop/sidecar/>.
[^avfoundation]: Apple Developer Documentation, “Setting up a capture session,” <https://developer.apple.com/documentation/avfoundation/setting-up-a-capture-session>.
[^apple-vision]: Apple Developer Documentation, “Tracking the User’s Face in Real Time,” <https://developer.apple.com/documentation/vision/tracking-the-user-s-face-in-real-time>.
[^mediapipe]: Google AI Edge, “Face landmark detection guide,” <https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>.
[^whisper]: OpenAI, “Whisper,” <https://github.com/openai/whisper>.
[^mlx-whisper]: Apple ML Explore, “Speech recognition with Whisper in MLX,” <https://github.com/ml-explore/mlx-examples/blob/main/whisper/README.md>.
[^liveportrait]: KwaiVGI/Kling AI Research, “LivePortrait,” <https://github.com/KwaiVGI/LivePortrait>.
[^musetalk]: TMElyralab, “MuseTalk,” <https://github.com/TMElyralab/MuseTalk>.
[^c2pa]: Coalition for Content Provenance and Authenticity, “C2PA Specifications 2.4,” <https://spec.c2pa.org/specifications/specifications/2.4/index.html>.
[^brio-specs]: Logitech, “Brio/Brio 4K Specifications,” <https://hub.sync.logitech.com/brio/post/brio-brio-4k-specifications-BJKhhCqWmecRhPD>.
[^yeti-manual]: Blue/Logitech, “Yeti Professional Multi-Pattern USB Microphone Manual,” <https://www.logitech.com/assets/66310/3/blue-yeti-web-qsg.pdf>.
[^apple-mbp]: Apple Support, “MacBook Pro (14-inch, M5 Pro or M5 Max) — Technical Specifications,” <https://support.apple.com/en-us/126318>.

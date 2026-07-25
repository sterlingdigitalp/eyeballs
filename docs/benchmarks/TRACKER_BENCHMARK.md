# Phase 1 tracker benchmark

Status: Harness complete; human/hardware corpus pending

## Providers

| Provider | Implementation | Outputs |
|---|---|---|
| MediaPipe Face Landmarker | Integrated `TrackingProvider` in the live renderer | iris position, blendshape blink score, normalized eye/head pose, face scale, confidence, and per-frame latency |
| Apple Vision | `vision-benchmark` Swift executable | the same normalized feature-vector fields plus provider/model identity and media/analysis timestamps |

Both providers preserve media timestamps and identify provider/model versions. Every new session
checkpoints the exact calibration snapshot used to produce it. The exported session analysis and
`npm run reprocess -- <session.json> <output.json>` command therefore allow algorithm versions to
run against the same raw normalized feature sequence without replacing original predictions or
guessing which calibration produced them.

`npm run benchmark:tracker -- <features-or-session.json> <shared-labels.json> <output.json>` accepts
either provider feature JSONL, a JSON feature array, or the complete in-app session export. A single
set of relative-time calibration and evaluation intervals is applied to both providers. The report
includes detection/usable rates, blink frames, median/p95 analysis latency, agreement, decision
coverage, unknown frames, pupil-detection rate, per-target eye/head jitter, face-scale stability,
break/recovery timing, missed transitions, and false cues per minute. It
also emits the versioned predictions and their source clock origin; Review rebases cross-provider
predictions onto the selected session clock before comparing them.

The Vision prototype estimates blink from both eye-contour aspect ratios. Missing pupil landmarks
alone are recorded as a pupil-detection failure rather than mislabeled as a blink, which keeps
reflection failures distinct from deliberate eyelid closure.

## Promotion gate

The selected primary provider must be evaluated on the same manually labeled clips from:

- built-in camera in normal and low light;
- Brio 65° at 1080p and 4K with an analysis proxy;
- glasses on/off where applicable;
- lens, near-lens, screen center, notes, left/right glance, blink, speech, and head/eye separation;
- at least three later-session calibration checks.

Required:

- at least 85% held-out binary contact/not-contact agreement on both profiles;
- fewer than one false corrective cue per minute in a known-contact drill;
- blinks do not create gaze breaks;
- low-confidence frames become `unknown`.

## Current selection

MediaPipe is provisionally integrated because it provides iris landmarks and blink blendshapes in
the same zero-IPC webview path. It is not finally promoted: a human-labeled same-video corpus has
not yet been run through both providers. Phase 2 remains gated until the benchmark table is
populated.

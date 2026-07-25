# Phase 1 privacy and threat model

## Protected data

Camera and microphone device identifiers, calibration samples, face landmarks, test recordings,
human labels, session manifests, and local diagnostics are private user data. Calibration features
are treated as biometric-adjacent identity data even though Phase 1 does not build an identity
model.

## Trust boundaries

- The Tauri core, application-owned SQLite database, and application data directory are trusted.
- MediaPipe runs locally from pinned application assets.
- The webview is denied arbitrary network access by the content security policy.
- No cloud service, analytics service, or generation provider exists in Phase 1.
- Camera permission and microphone permission are separate user actions.

## Threats and controls

| Threat | Phase 1 control |
|---|---|
| Capture begins unexpectedly | No device request on launch; explicit setup actions; visible preview and recording state |
| Microphone implied by camera permission | Separate permission buttons and independent streams |
| Low-confidence tracking becomes a negative judgment | Explicit `unknown` state; no personality or emotion inference |
| Calibration reused for an incompatible setup | Fingerprint camera, negotiated format, lens anchor, tracker, and model version |
| Original predictions disappear after correction | Corrections are append-only intervals |
| Interrupted recording appears valid | Recording starts `recording`; only successful finalization writes `complete` |
| Local data leaks over network | Local model assets and restrictive CSP; no telemetry |
| Diagnostic logs contain frames or raw features | Structured event logs contain IDs/status only, never media or landmarks |
| Dependency/model substitution | Pinned dependency lock and local model checksum in release verification |

## Phase 1 exclusions

There is no dataset promotion, cloud upload, model training, voice cloning, virtual camera, or
publishing. Adding any of those capabilities requires a new consent and threat-model review.

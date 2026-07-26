# Build manifest

Generated: 2026-07-26

This manifest identifies a local release bundle suitable for Phase 1 human validation
**and** exploratory use of the Phase 2 coaching / Phase 3 dataset **prototypes**.

Status reminder:

- Phase 1 engineering is largely complete; human/hardware acceptance remains open.
- Phase 2 is an integrated coaching **prototype**, not an accepted Coaching MVP.
- Phase 3 is domain scaffolding and UI only — not a production dataset engine
  (no disk-backed CaptureCore, workers, or portable file export yet).

## Versioned measurement components

| Component | Version |
|---|---|
| Application | `0.1.0` |
| Live tracker | `mediapipe-face-landmarker` |
| Tracker/model version | `0.10.22/face-landmarker-float16-v1+pose-matrix.2` |
| Feature schema | `1.0.0` |
| Calibration protocol | `guided-personalized/2.0.1` |
| Classifier | `cluster-hysteresis/1.2.1` |
| Coaching scoring policy | `coaching-scoring/1.0.0` (prototype) |
| Dataset integrity digests | `fnv1a64:…` prototype digests — **not** cryptographic SHA-256 |

## SHA-256 checksums

| Artifact | SHA-256 |
|---|---|
| `face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `vision_wasm_internal.wasm` | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| Synthetic A/V fixture | `83e3732537617ab45a6fb3bc3fc6f4fc4e8474c9f324561af10f49c4dcccd3e1` |
| Release app executable | `415d875ca94268d53c2203dddfafdb68812988e0737a644a31230e7155364f5f` |
| `package-lock.json` | `07b2b57c8c51c5d776c3e08952288fa0ea8ffd2c7c85cc0705ab3e467d434690` |

The release bundle is:

```text
apps/desktop/src-tauri/target/release/bundle/macos/Camera Presence Coach.app
```

`npm run package:app` builds the bundle, applies a local ad-hoc signature, validates the property
list, and performs strict code-sign verification. This signature is suitable for local validation;
Developer ID signing and notarization remain release work. Run `npm run verify` before packaging,
then regenerate the executable checksum.

## Provenance note

As of 2026-07-26, Phase 2/3 source may exist only in a local working tree until intentionally
committed and pushed. A fresh clone of the remote may still show Phase 1 only.

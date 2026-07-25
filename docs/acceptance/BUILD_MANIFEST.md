# Phase 1 build manifest

Generated: 2026-07-25

This manifest identifies the release bundle prepared for Phase 1 human validation.

## Versioned measurement components

| Component | Version |
|---|---|
| Application | `0.1.0` |
| Live tracker | `mediapipe-face-landmarker` |
| Tracker/model version | `0.10.22/face-landmarker-float16-v1+pose-matrix.2` |
| Feature schema | `1.0.0` |
| Calibration protocol | `guided-personalized/2.0.1` |
| Classifier | `cluster-hysteresis/1.2.1` |
| Node.js | `v26.3.1` |
| npm | `11.16.0` |
| Rust | `1.96.0` |
| Swift | `6.3.3` |

## SHA-256 checksums

| Artifact | SHA-256 |
|---|---|
| `face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `vision_wasm_internal.wasm` | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| Synthetic A/V fixture | `83e3732537617ab45a6fb3bc3fc6f4fc4e8474c9f324561af10f49c4dcccd3e1` |
| Release app executable | `88cf03b91ffe776bb8c9874ae2105fc6bda7926268d33eeb984a0a7e82a675cc` |
| `package-lock.json` | `07b2b57c8c51c5d776c3e08952288fa0ea8ffd2c7c85cc0705ab3e467d434690` |

The release bundle is:

```text
apps/desktop/src-tauri/target/release/bundle/macos/Camera Presence Coach.app
```

`npm run package:app` builds the bundle, applies a local ad-hoc signature, validates the property
list, and performs strict code-sign verification. This signature is suitable for local Phase 1
validation; Developer ID signing and notarization remain release work. Run `npm run verify` before
packaging, then regenerate the executable checksum.

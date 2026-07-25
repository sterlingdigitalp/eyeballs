# Phase 1 capture spike

Date: 2026-07-25

## Candidates

| Path | Prototype evidence | Phase 1 disposition |
|---|---|---|
| Webview `MediaStream` | Integrated preview, negotiated settings, device events, MediaRecorder checkpoints | Selected for Phase 1 measurement/test recordings |
| Swift AVFoundation helper | `capture-probe` builds and enumerates stable IDs and formats | Retained for native inventory and Phase 3 production-capture work |
| Rust AVFoundation bridge | Tauri/Rust core builds; direct frame bridge not implemented | Rejected for Phase 1 because it adds a second full-frame copy/FFI surface without improving the integrated MediaPipe path |

## Measured facts

- AVFoundation found the MacBook Pro Camera and its 1920×1080/30 format.
- AVFoundation found the built-in microphone.
- The packaged app obtained a live MacBook preview and persisted the actually negotiated
  1920×1080/30 video mode and 48 kHz mono microphone format after separate user-approved grants.
- The packaged app now records time from the camera request to the first decodable preview frame.
  A warm, already-approved MacBook restart displayed 8 ms to first frame (1 ms device request);
  a run that included waiting for renewed user approval displayed 10.76 s (9.90 s device request).
  Permission-interaction time is deliberately included rather than being mislabeled as device latency.
- A currently attached external camera exposes up to 1920×1440/30 and 1920×1080/60.
- Blue Yeti is detected through AVFoundation with 48 kHz/16-bit and 44.1 kHz/16-bit stereo modes.
- Brio is detected with a stable AVFoundation ID; short 4K/30 and 1080p/60 discard-only captures pass.
- The renderer loads the 3.76 MB face-landmarker model and 11.15 MB SIMD WASM asset locally.
- Browser/WebView runtime starts without requesting camera or microphone permission.

## Decision

Use the webview as the single camera owner in Phase 1. It provides the preview frame directly to the
selected live tracker and records optional test media without passing 4K frames through IPC.
Microphone access remains a separate stream and permission.

This is not approval for dataset-master recording. Phase 3 must make a new production decision after
30-minute/4K/A/V-drift/recovery/signing tests against Swift AVFoundation.

# CaptureCore Stage 5 — preview / analysis transport

Date: 2026-07-26  
Branch: `feature/capture-core`

## Decision (measured low-rate first)

| Choice | Value | Rationale |
|---|---|---|
| Ownership | CaptureCore only while Dataset records | No webview dual-own of the same camera |
| Transport | **JPEG file** `sessionRoot/preview/latest.jpg` + `preview_frame` protocol event | Avoids unmeasured base64-at-30fps on the IPC bus |
| Rate cap | **5 fps** default (max 10) | Framing only; not MediaPipe analysis |
| Resolution | Max width **640** (height scales) | Keeps encode + disk cheap |
| Quality | JPEG ~0.55 | Small enough for frequent replace |
| Analysis path | **Not** full-rate in Stage 5 | Charter: full-rate only after separate benchmark |

## Protocol

```json
{
  "type": "preview_frame",
  "payload": {
    "path": "/…/preview/latest.jpg",
    "sequence": 1,
    "width": 640,
    "height": 360,
    "jpegBytes": 18420,
    "encodeMs": 3.2,
    "previewMaxFps": 5,
    "transport": "file"
  }
}
```

Health also reports: `previewFrames`, `previewAchievedFps`, `lastPreviewEncodeMs`, `lastPreviewJpegBytes`.

## Webview display

Tauri `convertFileSrc(path)` + asset protocol scope on app data / temp. Cache-bust with `?s=<sequence>`.

## What is explicitly out of scope (Stage 5)

- Shared memory / IOSurface (candidate for later measured spike)
- MediaPipe on the Dataset master path
- Base64 JPEG at master capture rate
- Webview `getUserMedia` while CaptureCore holds the same devices

## Exit

- [x] Measured low-rate preview implemented (file + metrics)
- [x] Framing UX in Dataset panel
- [x] Dual ownership avoided (release webview media; CaptureCore owns camera)
- [x] Full-rate analysis deferred with written design numbers

## Smoke

```sh
cd /Users/sterlingdigital/eyeballs-capture-core
sh scripts/dev/test-capture-core-dry-run.sh
# expects preview_frame events + preview/latest.jpg
```

### Human live smoke — 2026-07-26 (PASS)

Host: Terminal + packaged `CaptureCore.app` (not agent/hive parent)  
Session: `/tmp/capture-core-stage5-live-smoke` · 1080p Brio + Yeti · 12s · exit **0**

| Check | Result |
|---|---|
| Dual Brio + Yeti | Pass · PCM audio |
| Active format | 1920×1080, range 5–30 fps |
| `preview_frame` count | **50** in ~12s (~4.2 fps achieved vs 5 fps cap) |
| Last preview | **640×360** · 38 363 bytes · **~6.9 ms** encode · `transport: file` |
| `preview/latest.jpg` | Valid JPEG (JFIF) |
| Masters | 2 segments video+audio |
| `recording-finished` | OK |

Agent/hive parent cannot run live smoke (TCC abort); Terminal or Tauri product parent required.

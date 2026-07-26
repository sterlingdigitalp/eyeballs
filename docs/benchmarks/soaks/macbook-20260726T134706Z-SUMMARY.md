# Soak evidence: macbook 1h (2026-07-26)

## SOAK_RESULT

```
SOAK_RESULT=PASS
profile=macbook
requestedDurationSec=3600
elapsedSec=3601
captureCoreExit=0
validationExit=0
finished=yes
seal=yes
status=complete
measuredVideoFps=29.989221942831904
wallDurationSec=3600.1600910425186
negotiatedWidth=1920
negotiatedHeight=1080
negotiatedFrameRate=30
avInitialOffsetUs=40934
videoFrames=107966
segments=346
droppedVideo=0
segmentCount=692
```

Run dir: `/tmp/capture-core-soak/macbook-20260726T134706Z`

## Comparison with Brio 4K 1h soak

| Metric | MacBook 1080p | Brio 4K |
|---|---|---|
| Result | **PASS** | **PASS** |
| Measured FPS | **~29.99** | **~23.97** |
| Negotiated | 1920×1080 @ 30 | 3840×2160 @ 30 (advertised) |
| Drops | 0 | 0 |
| Segments | 346 (~692 files) | 345 (~690 files) |
| A/V offset | ~40.9 ms | ~53.4 ms |
| Session size | ~2.8 GiB | ~14 GiB |
| Boundary outliers | 0 | 0 |

Built-in camera delivers honest **~30 fps**; Brio 4K delivers honest **~24 fps** without UVC frame-duration lock.

## Analysis highlights

- Boundary firstVideoPts gaps: mean ~10.41 s, **0 outliers**
- Health instantaneous FPS: mean ~29.99, median ~30.00
- Seal written by soak script (`seal=yes`)
- Validation RESULT=PASS (every closed segment)

## Matrix

| Row | Result |
|---|---|
| 1h MacBook + built-in mic | **PASS** |

# Soak evidence: brio-yeti 1h (2026-07-26)

## SOAK_RESULT
```
SOAK_RESULT=PASS
profile=brio-yeti
requestedDurationSec=3600
elapsedSec=3602
captureCoreExit=0
validationExit=0
runDir=/tmp/capture-core-soak/brio-yeti-20260726T115313Z
sessionRoot=/tmp/capture-core-soak/brio-yeti-20260726T115313Z/session
events=/tmp/capture-core-soak/brio-yeti-20260726T115313Z/events.jsonl
stderr=/tmp/capture-core-soak/brio-yeti-20260726T115313Z/stderr.txt
validation=/tmp/capture-core-soak/brio-yeti-20260726T115313Z/VALIDATION_REPORT.txt
finished=yes
seal=no
status=complete
measuredVideoFps=23.965375896409814
wallDurationSec=3600.2773489952087
negotiatedWidth=3840
negotiatedHeight=2160
negotiatedFrameRate=30
avInitialOffsetUs=53370
videoFrames=86282
segments=345
droppedVideo=0
```

## Notes

- Wall duration: 3600.3s
- Measured video FPS: **23.965** (negotiated range advertised 30)
- Resolution: 3840x2160 H.264
- Audio: PCM preferred=True
- Segments finalized: 345 (690 files on disk = video+audio pairs)
- Video frames: 86282, droppedVideo: 0
- A/V initial offset: 53370 µs (53.4 ms)
- Preview frames: 14808
- Validation: every closed segment decodable (RESULT=PASS); seal backfilled post-hoc for hashes
- Session size: ~14 GiB under `/tmp/capture-core-soak/brio-yeti-20260726T115313Z/session`

## Matrix

| Row | Result |
|---|---|
| 1h Brio 4K + Yeti soak | **PASS** |

## Post-soak analysis (added)

See `brio-yeti-20260726T115313Z-ANALYSIS_REPORT.txt`.

| Check | Result |
|---|---|
| Segment boundary firstVideoPts gaps | **344** pairs · mean **~10.45 s** · min 10.17 · max 10.67 · **0 outliers** |
| Instantaneous FPS (health Δ) | mean **~23.97** · range 23.14–24.96 (matches measured ~23.97) |
| A/V initial offset | **53.4 ms** |
| Disk free from health | Unchanged across samples (instrumentation sticky; use `du` for growth ~14 GiB) |

**Boundary continuity:** first-PTS method shows stable ~segment-duration spacing for the full hour.

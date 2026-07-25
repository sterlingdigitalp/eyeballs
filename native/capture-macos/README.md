# macOS capture and tracking probes

`capture-probe` enumerates AVFoundation camera/microphone identifiers and every negotiated video
format exposed by each camera. It does not request capture permission.

`vision-benchmark` runs Apple Vision face/eye/pupil landmarks over a supplied video and emits one
versioned JSON record per frame with monotonic media timestamps and per-frame latency.

```sh
swift run --package-path native/capture-macos capture-probe
swift run --package-path native/capture-macos vision-benchmark --input fixtures/public-test-media/example.mp4
```

The same labeled media can be reprocessed by the app’s MediaPipe provider for the Phase 1 tracker
comparison. No private fixture media is committed.

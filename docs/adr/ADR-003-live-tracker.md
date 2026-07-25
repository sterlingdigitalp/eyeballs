# ADR-003: Phase 1 live tracking provider

Status: Provisional pending labeled hardware benchmark

MediaPipe Face Landmarker is the integrated live provider because it exposes 478 face/iris
landmarks, blendshapes for blink suppression, and a browser-compatible GPU path. The provider is
isolated behind `TrackingProvider`; its ID and model version are stored in every calibration and
prediction.

Apple Vision remains the benchmark comparator. MediaPipe may be promoted only after both providers
are scored on the same labeled corpus and meet the Phase 1 contact agreement and false-cue gates.

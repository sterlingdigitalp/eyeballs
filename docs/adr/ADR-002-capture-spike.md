# ADR-002: Phase 1 capture path

Status: Provisional pending hardware acceptance

Use one `MediaStream` camera owner inside the Tauri webview for Phase 1 preview, test recording, and
the analysis frame source. A separate microphone stream is added only for an explicitly recorded
test. This is the lowest-copy path for MediaPipe because frames remain in the webview.

Production dataset capture is not decided by this ADR. Before Phase 3, compare a Swift
AVFoundation helper and a Rust bridge using 4K stability, timestamp access, A/V drift, recovery,
signing, and clean-preview criteria. A webview recorder must not graduate to dataset-master capture
without meeting those gates.

Fallback behavior: if the selected device is removed or tracking fails, transition measurement to
`unknown`, stop recording safely, and mark an unfinalized session incomplete.

# ADR-001: macOS desktop stack

Status: Accepted

Use Tauri 2 with a React/TypeScript webview and a Rust application core. The UI owns interaction and
low-resolution live analysis. Rust owns durable local metadata, migrations, logs, and future worker
supervision. This keeps Phase 1 packaging native without sending frames off-device.

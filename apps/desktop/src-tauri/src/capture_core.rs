//! CaptureCore supervisor + on-disk SHA-256 for closed segment files.
//! Live camera requires a TCC-capable parent (Terminal / packaged app). Dry-run works headless.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::time::{Duration, Instant};
use tracing::{info, warn};

const PROTOCOL_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRecordRequest {
    pub session_id: String,
    pub session_root: String,
    pub camera_unique_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub microphone_unique_id: Option<String>,
    pub video: VideoSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<AudioSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefer_pcm_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_max_fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_max_width: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSettings {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub sample_rate: f64,
    pub channel_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentHash {
    pub path: String,
    pub sha256: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRunResult {
    pub exit_code: i32,
    pub events: Vec<Value>,
    pub segment_hashes: Vec<SegmentHash>,
    pub session_root: String,
    pub dry_run: bool,
    /// Path to Rust-written seal file when hashing succeeds after a clean exit.
    pub seal_path: Option<String>,
}

/// Stream SHA-256 of a closed file (does not load whole file into memory).
pub fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    let mut total: u64 = 0;
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
    Ok((hex, total))
}

/// Hash every regular file under session_root/master/segments/.
pub fn hash_session_segments(session_root: &Path) -> Result<Vec<SegmentHash>, String> {
    let segments = session_root.join("master").join("segments");
    if !segments.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&segments)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    entries.sort();
    for path in entries {
        let (sha256, byte_length) = sha256_file(&path)?;
        out.push(SegmentHash {
            path: path.display().to_string(),
            sha256,
            byte_length,
        });
    }
    Ok(out)
}

/// Write `session-seal.json` with Rust SHA-256 digests after a clean CaptureCore exit.
pub fn write_session_seal(
    session_root: &Path,
    session_id: &str,
    exit_code: i32,
    dry_run: bool,
    segment_hashes: &[SegmentHash],
) -> Result<PathBuf, String> {
    // CaptureCoreExitCode: 0 success, 5 cancelled (see RecordRequest.swift).
    let status = if exit_code == 0 {
        "complete"
    } else if exit_code == 5 {
        "cancelled"
    } else {
        "failed"
    };
    let seal = json!({
        "protocolVersion": PROTOCOL_VERSION,
        "sessionId": session_id,
        "sessionRoot": session_root.display().to_string(),
        "exitCode": exit_code,
        "status": status,
        "dryRun": dry_run,
        "hashedBy": "rust-sha2",
        "segmentCount": segment_hashes.len(),
        "segments": segment_hashes,
        "writtenAt": chrono::Utc::now().to_rfc3339(),
    });
    let path = session_root.join("session-seal.json");
    let body = serde_json::to_vec_pretty(&seal).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("write session-seal: {e}"))?;
    Ok(path)
}

fn repo_root_candidates() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        // apps/desktop/src-tauri → repo root
        roots.push(PathBuf::from(&manifest).join("../.."));
        roots.push(PathBuf::from(&manifest)); // src-tauri itself (binaries/)
    }
    // cwd when running from repo root or src-tauri
    roots.push(PathBuf::from("."));
    roots.push(PathBuf::from("../.."));
    roots.push(PathBuf::from("../../.."));
    roots
}

fn sidecar_name_candidates() -> Vec<String> {
    let mut names = vec!["capture-core".into()];
    // Prefer the compile-time OS/arch triple used by Tauri externalBin naming.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    names.push("capture-core-aarch64-apple-darwin".into());
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    names.push("capture-core-x86_64-apple-darwin".into());
    names.push("capture-core-aarch64-apple-darwin".into());
    names.push("capture-core-x86_64-apple-darwin".into());
    names.push("capture-core-universal-apple-darwin".into());
    if let Ok(target) = std::env::var("TARGET") {
        names.insert(0, format!("capture-core-{target}"));
    }
    names
}

/// Resolve capture-core binary: env override → next to app exe / sidecar → repo build outputs.
pub fn resolve_capture_core_binary() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("CAPTURE_CORE_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path.canonicalize().unwrap_or(path));
        }
        return Err(format!("CAPTURE_CORE_BIN not a file: {}", path.display()));
    }

    let names = sidecar_name_candidates();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Tauri externalBin lands beside the main binary (…/Contents/MacOS/).
            search_dirs.push(dir.to_path_buf());
            // Some layouts keep helpers under Resources.
            if let Some(contents) = dir.parent() {
                search_dirs.push(contents.join("Resources"));
                search_dirs.push(contents.join("MacOS"));
            }
        }
    }

    for root in repo_root_candidates() {
        // Prefer freshly built Swift products over a possibly stale staged sidecar.
        search_dirs.push(root.join("native/capture-macos/.build/arm64-apple-macosx/debug"));
        search_dirs.push(root.join("native/capture-macos/.build/debug"));
        search_dirs.push(root.join("native/capture-macos/.build/x86_64-apple-macosx/debug"));
        search_dirs.push(root.join("native/capture-macos/.build/arm64-apple-macosx/release"));
        search_dirs.push(root.join("native/capture-macos/.build/release"));
        search_dirs.push(root.join("native/capture-macos/.build/CaptureCore.app/Contents/MacOS"));
        search_dirs.push(root.join("binaries"));
        search_dirs.push(root.join("apps/desktop/src-tauri/binaries"));
    }

    for dir in search_dirs {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate.canonicalize().unwrap_or(candidate));
            }
        }
        // Unpackaged Swift product is just "capture-core"
        let plain = dir.join("capture-core");
        if plain.is_file() {
            return Ok(plain.canonicalize().unwrap_or(plain));
        }
    }

    Err(
        "capture-core binary not found. Run: sh scripts/dev/prepare-capture-core-sidecar.sh (or set CAPTURE_CORE_BIN)"
            .into(),
    )
}

/// Run capture-core list-devices (JSON inventory on stdout).
pub fn list_capture_devices() -> Result<Value, String> {
    let binary = resolve_capture_core_binary()?;
    let output = Command::new(&binary)
        .arg("list-devices")
        .output()
        .map_err(|e| format!("spawn list-devices: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "list-devices exit {}: {err}",
            output.status.code().unwrap_or(-1)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("parse list-devices JSON: {e}"))
}

/// Optional hooks while a record is in flight (UI progress + cooperative stop).
pub struct CaptureRunHooks {
    /// Called on the supervisor thread for each stdout protocol event.
    pub on_event: Option<Box<dyn FnMut(Value) + Send>>,
    /// When a message arrives, write stdin `{"type":"stop"}` (keeps stdin open until then).
    pub stop_rx: Option<Receiver<()>>,
}

/// Run capture-core record to completion (dry-run or live). Collects stdout JSONL events.
/// Optional hooks support live UI events and cooperative stdin stop.
pub fn run_capture_record_with_hooks(
    request: CaptureRecordRequest,
    mut hooks: CaptureRunHooks,
) -> Result<CaptureRunResult, String> {
    let binary = resolve_capture_core_binary()?;
    let session_root = PathBuf::from(&request.session_root);
    fs::create_dir_all(session_root.join("master").join("segments"))
        .map_err(|e| format!("create session root: {e}"))?;

    let request_path = session_root.join("capture-request.json");
    let body = serde_json::to_vec_pretty(&request).map_err(|e| e.to_string())?;
    fs::write(&request_path, body).map_err(|e| e.to_string())?;

    info!(
        binary = %binary.display(),
        session = %request.session_id,
        dry_run = request.dry_run.unwrap_or(false),
        "capture_core_spawn"
    );

    let mut child = Command::new(&binary)
        .arg("record")
        .arg("--request")
        .arg(&request_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn capture-core: {e}"))?;

    // Dry-run finishes on its own; live maxDuration also self-stops.
    let timeout = Duration::from_secs(
        request
            .max_duration_sec
            .map(|s| (s.ceil() as u64) + 15)
            .unwrap_or(120),
    );
    let started = Instant::now();

    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;
    let mut stdin = child.stdin.take();

    let (event_tx, event_rx): (Sender<Value>, Receiver<Value>) = mpsc::channel();
    let stdout_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if event_tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf);
        buf
    });

    let mut events: Vec<Value> = Vec::new();
    let mut stop_sent = false;

    let drain_events = |events: &mut Vec<Value>,
                        event_rx: &Receiver<Value>,
                        on_event: &mut Option<Box<dyn FnMut(Value) + Send>>| {
        loop {
            match event_rx.try_recv() {
                Ok(value) => {
                    if let Some(cb) = on_event.as_mut() {
                        cb(value.clone());
                    }
                    events.push(value);
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
    };

    loop {
        drain_events(&mut events, &event_rx, &mut hooks.on_event);

        if !stop_sent {
            if let Some(rx) = hooks.stop_rx.as_ref() {
                if rx.try_recv().is_ok() {
                    if let Some(ref mut sin) = stdin {
                        let _ = writeln!(sin, r#"{{"type":"stop"}}"#);
                        let _ = sin.flush();
                        info!("capture_core_stop_sent");
                    }
                    stop_sent = true;
                }
            }
        }

        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            return Err("capture-core timed out".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // Drop stdin so any remaining reader unblocks; drain leftover events.
                drop(stdin);
                let _ = stdout_thread.join();
                drain_events(&mut events, &event_rx, &mut hooks.on_event);
                while let Ok(value) = event_rx.try_recv() {
                    if let Some(cb) = hooks.on_event.as_mut() {
                        cb(value.clone());
                    }
                    events.push(value);
                }
                let err_log = stderr_thread.join().unwrap_or_default();
                if !err_log.trim().is_empty() {
                    warn!(%err_log, "capture_core_stderr");
                }
                let exit_code = status.code().unwrap_or(-1);
                let segment_hashes = hash_session_segments(&session_root)?;
                let dry_run = request.dry_run.unwrap_or(false);
                let seal_path = if exit_code == 0 || !segment_hashes.is_empty() {
                    match write_session_seal(
                        &session_root,
                        &request.session_id,
                        exit_code,
                        dry_run,
                        &segment_hashes,
                    ) {
                        Ok(p) => Some(p.display().to_string()),
                        Err(e) => {
                            warn!(%e, "session_seal_failed");
                            None
                        }
                    }
                } else {
                    None
                };
                return Ok(CaptureRunResult {
                    exit_code,
                    events,
                    segment_hashes,
                    session_root: session_root.display().to_string(),
                    dry_run,
                    seal_path,
                });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(format!("wait capture-core: {e}")),
        }
    }
}

/// True when `candidate` resolves inside `root` (after canonicalize).
pub fn path_is_under_root(candidate: &Path, root: &Path) -> Result<bool, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("canonicalize root: {e}"))?;
    if candidate.exists() {
        let cand = fs::canonicalize(candidate).map_err(|e| format!("canonicalize path: {e}"))?;
        return Ok(cand.starts_with(&root));
    }
    // Not yet on disk: require absolute path whose parent chain is under root.
    let mut cursor = candidate.to_path_buf();
    while !cursor.exists() {
        match cursor.parent() {
            Some(parent) if parent != cursor => cursor = parent.to_path_buf(),
            _ => return Ok(false),
        }
    }
    let existing = fs::canonicalize(&cursor).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Ok(false);
    }
    // Remaining components must not escape via `..`
    let suffix = candidate.strip_prefix(&cursor).unwrap_or(candidate);
    Ok(!suffix
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir)))
}

pub fn ensure_under_sessions_root(session_root: &Path, sessions_root: &Path) -> Result<(), String> {
    if path_is_under_root(session_root, sessions_root)? {
        return Ok(());
    }
    Err(format!(
        "session root must be under app sessions directory ({})",
        sessions_root.display()
    ))
}

/// Sanitize session id for a single path component (no traversal).
pub fn sanitize_session_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("session id must be 1–128 characters".into());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("session id may only contain A–Z, a–z, 0–9, -, _".into());
    }
    Ok(trimmed.to_string())
}

/// Create `sessions_root/<sessionId>/master/segments` for a new recording.
pub fn prepare_session_dir(
    sessions_root: &Path,
    session_id: Option<String>,
) -> Result<(String, PathBuf), String> {
    fs::create_dir_all(sessions_root).map_err(|e| format!("create sessions root: {e}"))?;
    let id = match session_id {
        Some(raw) => sanitize_session_id(&raw)?,
        None => uuid::Uuid::new_v4().to_string(),
    };
    let session_root = sessions_root.join(&id);
    if session_root.exists() {
        // Allow reusing empty prepared dirs; reject non-empty unexpected content later at record time.
        if !session_root.is_dir() {
            return Err(format!("session path exists and is not a directory: {id}"));
        }
    }
    fs::create_dir_all(session_root.join("master").join("segments"))
        .map_err(|e| format!("create session dir: {e}"))?;
    ensure_under_sessions_root(&session_root, sessions_root)?;
    let canonical = fs::canonicalize(&session_root).map_err(|e| e.to_string())?;
    Ok((id, canonical))
}

/// Scan session roots for incomplete segment dirs (orphan detection helper).
pub fn scan_orphan_sessions(sessions_root: &Path) -> Result<Vec<Value>, String> {
    if !sessions_root.is_dir() {
        return Ok(vec![]);
    }
    let mut orphans = Vec::new();
    for entry in fs::read_dir(sessions_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let segments = path.join("master").join("segments");
        let finished = path.join("recording-finished.json");
        let seal = path.join("session-seal.json");
        if segments.is_dir() && !finished.is_file() && !seal.is_file() {
            let hashes = hash_session_segments(&path).unwrap_or_default();
            orphans.push(json!({
                "sessionRoot": path.display().to_string(),
                "sessionId": path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                "protocolVersion": PROTOCOL_VERSION,
                "segmentCount": hashes.len(),
                "segmentHashes": hashes,
                "status": "incomplete_or_orphan",
            }));
        }
    }
    Ok(orphans)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn sha256_file_matches_known_digest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bin");
        let mut f = File::create(&path).unwrap();
        f.write_all(b"abc").unwrap();
        let (hex, len) = sha256_file(&path).unwrap();
        assert_eq!(len, 3);
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_session_segments_lists_files() {
        let dir = tempfile::tempdir().unwrap();
        let segments = dir.path().join("master").join("segments");
        fs::create_dir_all(&segments).unwrap();
        fs::write(segments.join("seg_000_video.mov"), b"video").unwrap();
        fs::write(segments.join("seg_000_audio.caf"), b"audio").unwrap();
        let hashes = hash_session_segments(dir.path()).unwrap();
        assert_eq!(hashes.len(), 2);
        assert!(hashes.iter().all(|h| h.sha256.len() == 64));
    }

    #[test]
    fn write_session_seal_and_orphan_scan() {
        let root = tempfile::tempdir().unwrap();
        let complete = root.path().join("complete-session");
        let orphan = root.path().join("orphan-session");
        fs::create_dir_all(complete.join("master").join("segments")).unwrap();
        fs::write(
            complete.join("master").join("segments").join("seg.mov"),
            b"x",
        )
        .unwrap();
        let hashes = hash_session_segments(&complete).unwrap();
        write_session_seal(&complete, "s1", 0, true, &hashes).unwrap();
        assert!(complete.join("session-seal.json").is_file());

        fs::create_dir_all(orphan.join("master").join("segments")).unwrap();
        fs::write(
            orphan.join("master").join("segments").join("seg.mov"),
            b"y",
        )
        .unwrap();

        let orphans = scan_orphan_sessions(root.path()).unwrap();
        assert_eq!(orphans.len(), 1);
        assert!(orphans[0]["sessionRoot"]
            .as_str()
            .unwrap()
            .contains("orphan-session"));
    }

    #[test]
    fn sanitize_session_id_rejects_traversal() {
        assert!(sanitize_session_id("../etc").is_err());
        assert!(sanitize_session_id("a/b").is_err());
        assert_eq!(sanitize_session_id("abc-123_X").unwrap(), "abc-123_X");
    }

    #[test]
    fn prepare_session_dir_is_under_root() {
        let root = tempfile::tempdir().unwrap();
        let (id, path) = prepare_session_dir(root.path(), Some("sess_1".into())).unwrap();
        assert_eq!(id, "sess_1");
        assert!(path.starts_with(fs::canonicalize(root.path()).unwrap()));
        assert!(path.join("master").join("segments").is_dir());
        assert!(ensure_under_sessions_root(&path, root.path()).is_ok());
        let outside = tempfile::tempdir().unwrap();
        assert!(ensure_under_sessions_root(outside.path(), root.path()).is_err());
    }

    #[test]
    fn dry_run_end_to_end_when_binary_present() {
        let Ok(binary) = resolve_capture_core_binary() else {
            eprintln!("skip: capture-core binary not built");
            return;
        };
        assert!(binary.is_file());
        let dir = tempfile::tempdir().unwrap();
        let session_root = dir.path().join("dry-session");
        let request = CaptureRecordRequest {
            session_id: "cargo-dry".into(),
            session_root: session_root.display().to_string(),
            camera_unique_id: "unused".into(),
            microphone_unique_id: None,
            video: VideoSettings {
                width: 1280,
                height: 720,
                frame_rate: 30.0,
            },
            audio: None,
            segment_duration_sec: Some(0.4),
            max_duration_sec: Some(1.0),
            video_only: None,
            dry_run: Some(true),
            prefer_pcm_audio: None,
            preview_enabled: Some(true),
            preview_max_fps: Some(5.0),
            preview_max_width: Some(640),
        };
        let result = run_capture_record_with_hooks(
            request,
            CaptureRunHooks {
                on_event: None,
                stop_rx: None,
            },
        )
        .expect("dry-run should succeed");
        assert_eq!(result.exit_code, 0);
        assert!(result.dry_run);
        assert!(!result.events.is_empty());
        assert!(result
            .events
            .iter()
            .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("recording_finished")));
        assert!(result
            .events
            .iter()
            .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("preview_frame")));
        assert!(session_root
            .join("master")
            .join("segments")
            .join("seg_000_video.mov")
            .is_file());
        // Multi-segment dry-run with 1s / 0.4s → three placeholders
        assert!(session_root
            .join("master")
            .join("segments")
            .join("seg_002_video.mov")
            .is_file());
        assert!(session_root.join("preview").join("latest.jpg").is_file());
        assert!(session_root.join("recording-finished.json").is_file());
        assert!(result.seal_path.is_some());
        assert!(session_root.join("session-seal.json").is_file());
        assert!(result.segment_hashes.len() >= 3);
        assert_eq!(result.segment_hashes[0].sha256.len(), 64);
    }

    /// Stage 4 vertical slice: confined session → CaptureCore → Rust SHA-256 seal.
    #[test]
    fn stage4_vertical_slice_prepare_record_seal() {
        let Ok(_) = resolve_capture_core_binary() else {
            eprintln!("skip: capture-core binary not built");
            return;
        };
        let sessions = tempfile::tempdir().unwrap();
        let (session_id, session_root) =
            prepare_session_dir(sessions.path(), Some("stage4-slice".into())).unwrap();
        assert!(session_root.starts_with(sessions.path().canonicalize().unwrap()));

        let request = CaptureRecordRequest {
            session_id: session_id.clone(),
            session_root: session_root.display().to_string(),
            camera_unique_id: "unused".into(),
            microphone_unique_id: None,
            video: VideoSettings {
                width: 1280,
                height: 720,
                frame_rate: 30.0,
            },
            audio: None,
            segment_duration_sec: Some(0.4),
            max_duration_sec: Some(1.0),
            video_only: None,
            dry_run: Some(true),
            prefer_pcm_audio: None,
            preview_enabled: Some(true),
            preview_max_fps: Some(5.0),
            preview_max_width: Some(640),
        };
        let result = run_capture_record_with_hooks(
            request,
            CaptureRunHooks {
                on_event: None,
                stop_rx: None,
            },
        )
        .expect("stage4 dry-run vertical slice");

        assert_eq!(result.exit_code, 0, "exit code");
        assert!(result.dry_run);
        assert!(!result.events.is_empty(), "protocol events collected");
        assert!(result.seal_path.is_some(), "seal path returned");
        let seal = session_root.join("session-seal.json");
        assert!(seal.is_file(), "session-seal.json on disk");
        assert!(session_root.join("recording-finished.json").is_file());
        assert!(!result.segment_hashes.is_empty());
        for hash in &result.segment_hashes {
            assert_eq!(hash.sha256.len(), 64);
            let path = PathBuf::from(&hash.path);
            assert!(path.is_file(), "segment missing: {}", hash.path);
            let (rehash, len) = sha256_file(&path).unwrap();
            assert_eq!(rehash, hash.sha256, "seal digest must match re-hash");
            assert_eq!(len, hash.byte_length);
        }
        // Confined session is not an orphan after clean finish.
        let orphans = scan_orphan_sessions(sessions.path()).unwrap();
        assert!(
            orphans.is_empty(),
            "completed sealed session must not appear as orphan: {orphans:?}"
        );
    }
}

//! CaptureCore supervisor + on-disk SHA-256 for closed segment files.
//! Live camera requires a TCC-capable parent (Terminal / packaged app). Dry-run works headless.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
        roots.push(PathBuf::from(manifest).join("../.."));
        roots.push(PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../.."));
    }
    // cwd when running from repo root or src-tauri
    roots.push(PathBuf::from("."));
    roots.push(PathBuf::from("../.."));
    roots.push(PathBuf::from("../../.."));
    roots
}

fn resolve_capture_core_binary() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("CAPTURE_CORE_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path.canonicalize().unwrap_or(path));
        }
        return Err(format!("CAPTURE_CORE_BIN not a file: {}", path.display()));
    }

    let relative_bins = [
        "native/capture-macos/.build/arm64-apple-macosx/debug/capture-core",
        "native/capture-macos/.build/debug/capture-core",
        "native/capture-macos/.build/x86_64-apple-macosx/debug/capture-core",
        "native/capture-macos/.build/arm64-apple-macosx/release/capture-core",
        "native/capture-macos/.build/release/capture-core",
    ];

    for root in repo_root_candidates() {
        for rel in relative_bins {
            let candidate = root.join(rel);
            if candidate.is_file() {
                return Ok(candidate.canonicalize().unwrap_or(candidate));
            }
        }
    }

    Err(
        "capture-core binary not found. Build with: swift build --package-path native/capture-macos (or set CAPTURE_CORE_BIN)"
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

/// Run capture-core record to completion (dry-run or live). Collects stdout JSONL events.
pub fn run_capture_record(request: CaptureRecordRequest) -> Result<CaptureRunResult, String> {
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
    // Drop stdin so EOF → Swift treats as stop if still running without maxDuration.
    drop(child.stdin.take());

    let stdout_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut events = Vec::new();
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                events.push(value);
            }
        }
        events
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf);
        buf
    });

    loop {
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("capture-core timed out".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let events = stdout_thread.join().unwrap_or_default();
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
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
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
        };
        let result = run_capture_record(request).expect("dry-run should succeed");
        assert_eq!(result.exit_code, 0);
        assert!(result.dry_run);
        assert!(!result.events.is_empty());
        assert!(result
            .events
            .iter()
            .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("recording_finished")));
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
        assert!(session_root.join("recording-finished.json").is_file());
        assert!(result.seal_path.is_some());
        assert!(session_root.join("session-seal.json").is_file());
        assert!(result.segment_hashes.len() >= 3);
        assert_eq!(result.segment_hashes[0].sha256.len(), 64);
    }
}

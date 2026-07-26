#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture_core;
mod persistence;

use capture_core::{
    ensure_under_sessions_root, hash_session_segments, list_capture_devices, prepare_session_dir,
    run_capture_record, scan_orphan_sessions, sha256_file, CaptureRecordRequest, CaptureRunResult,
    SegmentHash,
};
use persistence::Database;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};
use tracing::{error, info, warn};

struct AppState {
    database: Mutex<Database>,
    /// Application Support …/sessions — CaptureCore masters are confined here.
    sessions_dir: PathBuf,
}

#[tauri::command]
fn persist_json(
    state: State<'_, AppState>,
    bucket: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(|_| "Database lock was poisoned.".to_string())?
        .put_json(&bucket, &key, &value)
        .map_err(|error| {
            error!(%bucket, %key, %error, "persist_json failed");
            error.to_string()
        })
}

#[tauri::command]
fn load_json(
    state: State<'_, AppState>,
    bucket: String,
    key: String,
) -> Result<Option<Value>, String> {
    state
        .database
        .lock()
        .map_err(|_| "Database lock was poisoned.".to_string())?
        .get_json(&bucket, &key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_json(state: State<'_, AppState>, bucket: String) -> Result<Vec<Value>, String> {
    state
        .database
        .lock()
        .map_err(|_| "Database lock was poisoned.".to_string())?
        .list_json(&bucket)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn health(state: State<'_, AppState>) -> Result<Value, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "Database lock was poisoned.")?;
    Ok(serde_json::json!({
        "database": database.health().map_err(|error| error.to_string())?,
        "localOnly": true,
        "schemaVersion": 1,
        "sessionsDir": state.sessions_dir.display().to_string(),
    }))
}

#[tauri::command]
fn log_event(
    event: String,
    correlation_id: Option<String>,
    level: Option<String>,
    fields: Option<Value>,
) {
    let fields = fields.unwrap_or_else(|| serde_json::json!({}));
    match level.as_deref() {
        Some("error") => {
            error!(%event, ?correlation_id, fields = %fields, "renderer_event");
        }
        Some("warn") => {
            warn!(%event, ?correlation_id, fields = %fields, "renderer_event");
        }
        _ => {
            info!(%event, ?correlation_id, fields = %fields, "renderer_event");
        }
    }
}

/// Absolute path to app-created sessions root (CaptureCore masters).
#[tauri::command]
fn capture_core_sessions_root(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.sessions_dir.display().to_string())
}

/// Create a root-confined session directory under Application Support/sessions.
#[tauri::command]
fn capture_core_prepare_session(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<Value, String> {
    let (id, root) = prepare_session_dir(&state.sessions_dir, session_id)?;
    Ok(serde_json::json!({
        "sessionId": id,
        "sessionRoot": root.display().to_string(),
        "sessionsRoot": state.sessions_dir.display().to_string(),
    }))
}

/// Run CaptureCore record (prefer dryRun: true until TCC-capable host).
/// Session root must live under the app sessions directory.
#[tauri::command]
fn capture_core_record(
    state: State<'_, AppState>,
    request: CaptureRecordRequest,
) -> Result<CaptureRunResult, String> {
    ensure_under_sessions_root(
        PathBuf::from(&request.session_root).as_path(),
        &state.sessions_dir,
    )?;
    run_capture_record(request)
}

/// Stream SHA-256 for a single closed file path (must be under sessions root).
#[tauri::command]
fn capture_core_hash_file(state: State<'_, AppState>, path: String) -> Result<SegmentHash, String> {
    let path = PathBuf::from(path);
    ensure_under_sessions_root(&path, &state.sessions_dir)?;
    let (sha256, byte_length) = sha256_file(&path)?;
    Ok(SegmentHash {
        path: path.display().to_string(),
        sha256,
        byte_length,
    })
}

/// Hash all files under sessionRoot/master/segments.
#[tauri::command]
fn capture_core_hash_segments(
    state: State<'_, AppState>,
    session_root: String,
) -> Result<Vec<SegmentHash>, String> {
    let root = PathBuf::from(session_root);
    ensure_under_sessions_root(&root, &state.sessions_dir)?;
    hash_session_segments(root.as_path())
}

/// List incomplete session dirs. Empty `sessionsRoot` uses the app default.
#[tauri::command]
fn capture_core_scan_orphans(
    state: State<'_, AppState>,
    sessions_root: Option<String>,
) -> Result<Value, String> {
    let root = match sessions_root {
        Some(path) if !path.trim().is_empty() => {
            let p = PathBuf::from(path);
            ensure_under_sessions_root(&p, &state.sessions_dir)?;
            p
        }
        _ => state.sessions_dir.clone(),
    };
    let orphans = scan_orphan_sessions(root.as_path())?;
    Ok(serde_json::json!({
        "sessionsRoot": root.display().to_string(),
        "orphans": orphans,
    }))
}

/// AVFoundation device inventory via capture-core list-devices.
#[tauri::command]
fn capture_core_list_devices() -> Result<Value, String> {
    list_capture_devices()
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let sessions_dir = data_dir.join("sessions");
            std::fs::create_dir_all(&sessions_dir)?;
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            let file_appender = tracing_appender::rolling::daily(log_dir, "presence.jsonl");
            tracing_subscriber::fmt()
                .json()
                .with_writer(file_appender)
                .with_env_filter("info")
                .try_init()
                .ok();
            let database = Database::open(data_dir.join("presence.sqlite3"))?;
            // Startup orphan scan (log only — UI can re-query).
            match scan_orphan_sessions(&sessions_dir) {
                Ok(orphans) if !orphans.is_empty() => {
                    warn!(count = orphans.len(), "capture_core_orphans_at_startup");
                }
                Ok(_) => info!("capture_core_no_orphans_at_startup"),
                Err(error) => warn!(%error, "capture_core_orphan_scan_failed"),
            }
            app.manage(AppState {
                database: Mutex::new(database),
                sessions_dir: sessions_dir.clone(),
            });
            info!(sessions = %sessions_dir.display(), "application_initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            persist_json,
            load_json,
            list_json,
            health,
            log_event,
            capture_core_sessions_root,
            capture_core_prepare_session,
            capture_core_record,
            capture_core_hash_file,
            capture_core_hash_segments,
            capture_core_scan_orphans,
            capture_core_list_devices
        ])
        .run(tauri::generate_context!())
        .expect("error while running Camera Presence Coach");
}

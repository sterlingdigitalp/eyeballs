#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod persistence;

use persistence::Database;
use serde_json::Value;
use std::sync::Mutex;
use tauri::{Manager, State};
use tracing::{error, info, warn};

struct AppState {
    database: Mutex<Database>,
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
        "schemaVersion": 1
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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
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
            app.manage(AppState {
                database: Mutex::new(database),
            });
            info!("application_initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            persist_json,
            load_json,
            list_json,
            health,
            log_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running Camera Presence Coach");
}

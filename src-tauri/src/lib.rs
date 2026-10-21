//! RepoHub native shell.
//!
//! The web frontend owns all GitHub logic. This crate provides:
//! * secure token storage in the OS keychain (`secret_*` commands)
//! * the menu-bar / system-tray item with live stats (`update_tray`)
//! * a small popover window anchored to the tray icon (desktop only)

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updater;

/// iOS/Android: updates come from the store, so these are inert.
#[cfg(mobile)]
mod updater {
    #[tauri::command]
    pub async fn update_check(_channel: String) -> Result<Option<()>, String> {
        Ok(None)
    }
    #[tauri::command]
    pub async fn update_download() -> Result<(), String> {
        Err("Updates are delivered through the App Store".into())
    }
    #[tauri::command]
    pub async fn update_install() -> Result<(), String> {
        Err("Updates are delivered through the App Store".into())
    }
    #[tauri::command]
    pub fn update_status() -> Option<()> {
        None
    }
}

const KEYRING_SERVICE: &str = "io.github.duserzym.repohub";

/// One line in the tray menu, e.g. "Open issues — 42".
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TrayLine {
    pub label: String,
    #[serde(default)]
    pub detail: String,
}

/// Snapshot pushed by the frontend after every sync.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TraySummary {
    /// Text shown next to the icon in the macOS menu bar (empty = icon only).
    #[serde(default)]
    pub title: String,
    /// Hover tooltip (Windows / Linux / macOS).
    #[serde(default)]
    pub tooltip: String,
    /// Read-only lines at the top of the tray menu.
    #[serde(default)]
    pub lines: Vec<TrayLine>,
    /// Free-form payload rendered by the popover window.
    #[serde(default)]
    pub extra: serde_json::Value,
}

#[derive(Default)]
pub struct AppState {
    summary: Mutex<Option<TraySummary>>,
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn update_tray(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    summary: TraySummary,
) -> Result<(), String> {
    #[cfg(desktop)]
    tray::apply(&app, &summary).map_err(|e| e.to_string())?;
    let _ = app.emit("summary-updated", &summary);
    *state.summary.lock().map_err(|e| e.to_string())? = Some(summary);
    Ok(())
}

#[tauri::command]
fn get_tray_summary(state: State<'_, AppState>) -> Option<TraySummary> {
    state.summary.lock().ok().and_then(|s| s.clone())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle, route: Option<String>) {
    show_main(&app);
    if let Some(route) = route {
        let _ = app.emit_to("main", "navigate", route);
    }
}

pub(crate) fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    #[cfg(desktop)]
    if let Some(p) = app.get_webview_window(tray::POPOVER) {
        let _ = p.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdateState::default());
    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_delete,
            update_tray,
            get_tray_summary,
            show_main_window,
            updater::update_check,
            updater::update_download,
            updater::update_install,
            updater::update_status
        ])
        .setup(|app| {
            #[cfg(desktop)]
            tray::setup(app.handle())?;
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps RepoHub alive in the menu bar / tray.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building RepoHub")
        .run(|app, event| {
            // macOS: clicking the Dock icon re-opens the hidden main window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

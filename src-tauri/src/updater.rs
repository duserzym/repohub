//! In-app updates, modelled on CodexBar's flow:
//! background check → silent download → an inline "Update ready — restart"
//! action in the window, tray menu and popover → install + relaunch.
//!
//! Releases are signed (minisign); CI publishes `latest.json` next to the
//! installers on GitHub Releases. The beta channel picks the newest release
//! including pre-releases.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const REPO: &str = "duserzym/repohub";

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
    ready: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub ready: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn info(u: &Update, ready: bool) -> UpdateInfo {
    UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
        ready,
    }
}

/// Stable: GitHub's "latest" release. Beta: newest release, pre-releases included.
async fn endpoint(channel: &str) -> Result<Url, String> {
    let stable = format!("https://github.com/{REPO}/releases/latest/download/latest.json");
    if channel != "beta" {
        return Url::parse(&stable).map_err(|e| e.to_string());
    }
    let client = tauri_plugin_http::reqwest::Client::new();
    let res = client
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=10"))
        .header("User-Agent", "RepoHub-updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    let releases: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let url = releases
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .flat_map(|r| r["assets"].as_array().cloned().unwrap_or_default())
        .find(|a| a["name"] == "latest.json")
        .and_then(|a| a["browser_download_url"].as_str().map(str::to_owned))
        .unwrap_or(stable);
    Url::parse(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
    channel: String,
) -> Result<Option<UpdateInfo>, String> {
    if let Some(v) = state.ready.lock().map_err(|e| e.to_string())?.clone() {
        // Already downloaded — keep offering the restart.
        if let Some(u) = state.pending.lock().map_err(|e| e.to_string())?.as_ref() {
            if u.version == v {
                return Ok(Some(info(u, true)));
            }
        }
    }
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint(&channel).await?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let out = update.as_ref().map(|u| info(u, false));
    *state.pending.lock().map_err(|e| e.to_string())? = update;
    Ok(out)
}

#[tauri::command]
pub async fn update_download(app: AppHandle, state: State<'_, UpdateState>) -> Result<UpdateInfo, String> {
    let update = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No update available")?;
    let mut downloaded: u64 = 0;
    let handle = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = handle.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    *state.bytes.lock().map_err(|e| e.to_string())? = Some(bytes);
    *state.ready.lock().map_err(|e| e.to_string())? = Some(update.version.clone());
    let i = info(&update, true);
    crate::tray::set_update_ready(&app, Some(update.version.clone()));
    let _ = app.emit("update-ready", &i);
    Ok(i)
}

/// Installs the downloaded update and relaunches RepoHub.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    install(&app)
}

#[tauri::command]
pub fn update_status(state: State<'_, UpdateState>) -> Option<UpdateInfo> {
    let ready = state.ready.lock().ok()?.clone()?;
    let pending = state.pending.lock().ok()?;
    pending.as_ref().filter(|u| u.version == ready).map(|u| info(u, true))
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let update = state.pending.lock().map_err(|e| e.to_string())?.clone().ok_or("No update downloaded")?;
    let bytes = state.bytes.lock().map_err(|e| e.to_string())?.take().ok_or("No update downloaded")?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

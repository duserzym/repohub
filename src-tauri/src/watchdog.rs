//! Blank-window watchdog.
//!
//! The main window's frontend calls `heartbeat` every 15 s (and on focus) while
//! it has UI on screen. If the user focuses the window and no heartbeat arrives
//! within a few seconds — the page went blank after a render crash, or WebKit
//! killed the web content process — the webview is reloaded.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

static START: OnceLock<Instant> = OnceLock::new();
static LAST_BEAT: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_RELOAD: Mutex<Option<Instant>> = Mutex::new(None);
static FOCUS_SEQ: AtomicU64 = AtomicU64::new(0);

const GRACE: Duration = Duration::from_secs(8);
const STARTUP: Duration = Duration::from_secs(30);
const COOLDOWN: Duration = Duration::from_secs(60);

pub fn start() {
    let _ = START.set(Instant::now());
}

pub fn beat() {
    if let Ok(mut g) = LAST_BEAT.lock() {
        *g = Some(Instant::now());
    }
}

pub fn on_focus<R: Runtime>(app: AppHandle<R>) {
    let focused_at = Instant::now();
    let seq = FOCUS_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(GRACE);
        if FOCUS_SEQ.load(Ordering::SeqCst) != seq {
            return; // a newer focus event runs its own check
        }
        if START.get().is_some_and(|s| s.elapsed() < STARTUP) {
            return; // still starting up
        }
        let alive = LAST_BEAT.lock().ok().and_then(|g| *g).is_some_and(|t| t >= focused_at);
        let cooling = LAST_RELOAD.lock().ok().and_then(|g| *g).is_some_and(|t| t.elapsed() < COOLDOWN);
        if alive || cooling {
            return;
        }
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) {
                eprintln!("RepoHub: main window stopped responding — reloading");
                reload(&w);
            }
        }
    });
}

fn reload<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    if let Ok(mut g) = LAST_RELOAD.lock() {
        *g = Some(Instant::now());
    }
    let _ = w.reload();
}

/// "Reload Window" in the tray menu: reloads the main window and the popover.
pub fn reload_all<R: Runtime>(app: &AppHandle<R>) {
    for (_, w) in app.webview_windows() {
        reload(&w);
    }
}

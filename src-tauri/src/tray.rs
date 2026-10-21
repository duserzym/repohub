//! Menu-bar (macOS) / system-tray (Windows, Linux) item.
//!
//! * The title next to the icon shows a live stat summary (macOS menu bar).
//! * Left click toggles a small popover window with the dashboard summary.
//! * Right click (or click on Windows/Linux menus) opens a menu with the same
//!   numbers plus Open / Refresh / Quit.

use crate::{show_main, TraySummary};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Runtime, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

use std::sync::Mutex;

pub const TRAY_ID: &str = "repohub-tray";
static LAST: Mutex<Option<TraySummary>> = Mutex::new(None);
static UPDATE_READY: Mutex<Option<String>> = Mutex::new(None);
pub const POPOVER: &str = "tray";
const POP_W: f64 = 360.0;
const POP_H: f64 = 520.0;

fn build_menu<R: Runtime>(app: &AppHandle<R>, s: Option<&TraySummary>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    match s {
        Some(s) if !s.lines.is_empty() => {
            for (i, line) in s.lines.iter().enumerate() {
                let text = if line.detail.is_empty() {
                    line.label.clone()
                } else {
                    format!("{}  —  {}", line.label, line.detail)
                };
                // Disabled items render as plain read-only text.
                menu.append(&MenuItem::with_id(app, format!("line-{i}"), text, false, None::<&str>)?)?;
            }
        }
        _ => {
            menu.append(&MenuItem::with_id(app, "line-none", "Waiting for first sync…", false, None::<&str>)?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(v) = UPDATE_READY.lock().ok().and_then(|g| g.clone()) {
        // CodexBar-style inline prompt once an update has been downloaded.
        menu.append(&MenuItem::with_id(app, "install-update", format!("Update ready (v{v}) — restart now?"), true, None::<&str>)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", "Open RepoHub", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit RepoHub", true, None::<&str>)?)?;
    Ok(menu)
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let menu = build_menu(app, None)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        // Monochrome template icon adapts to light/dark menu bars on macOS.
        .icon_as_template(true)
        .tooltip("RepoHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "refresh" => {
                let _ = app.emit("tray-refresh", ());
            }
            "check-updates" => {
                show_main(app);
                let _ = app.emit("check-updates", ());
            }
            "install-update" => {
                if let Err(e) = crate::updater::install(app) {
                    let _ = app.emit("update-error", e);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), rect);
            }
        })
        .build(app)?;

    let popover = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("index.html#/tray".into()))
        .title("RepoHub")
        .inner_size(POP_W, POP_H)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;

    let handle = popover.clone();
    popover.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = handle.hide();
        }
    });
    Ok(())
}

/// Show the popover just below (macOS menu bar) or above (Windows taskbar) the icon.
fn toggle_popover<R: Runtime>(app: &AppHandle<R>, rect: Rect) {
    let Some(win) = app.get_webview_window(POPOVER) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos: PhysicalPosition<f64> = rect.position.to_physical(scale);
    let size: PhysicalSize<f64> = rect.size.to_physical(scale);
    let (w, h) = (POP_W * scale, POP_H * scale);

    let mut x = pos.x + size.width / 2.0 - w / 2.0;
    let mut y = pos.y + size.height + 6.0;
    if let Ok(Some(m)) = win.monitor_from_point(pos.x, pos.y) {
        let (mx, my) = (m.position().x as f64, m.position().y as f64);
        let (mw, mh) = (m.size().width as f64, m.size().height as f64);
        // Tray in the lower half of the screen (Windows taskbar) → open upwards.
        if pos.y > my + mh / 2.0 {
            y = pos.y - h - 6.0;
        }
        x = x.clamp(mx + 6.0, mx + mw - w - 6.0);
        y = y.clamp(my, my + mh - h);
    }
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("popover-shown", ());
}

pub fn set_update_ready<R: Runtime>(app: &AppHandle<R>, version: Option<String>) {
    if let Ok(mut g) = UPDATE_READY.lock() {
        *g = version;
    }
    let last = LAST.lock().ok().and_then(|g| g.clone());
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_menu(app, last.as_ref()) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

pub fn apply<R: Runtime>(app: &AppHandle<R>, s: &TraySummary) -> tauri::Result<()> {
    if let Ok(mut g) = LAST.lock() {
        *g = Some(s.clone());
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        // Title is shown in the macOS menu bar; ignored on Windows.
        tray.set_title(if s.title.is_empty() { None } else { Some(s.title.as_str()) })?;
        tray.set_tooltip(Some(if s.tooltip.is_empty() { "RepoHub" } else { s.tooltip.as_str() }))?;
        tray.set_menu(Some(build_menu(app, Some(s))?))?;
    }
    Ok(())
}

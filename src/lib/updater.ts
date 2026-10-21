import { useEffect, useSyncExternalStore } from "react";
import { invoke, isMobile, isTauri, listen } from "./platform";
import { useApp } from "./state";

// CodexBar-style updates: check quietly in the background, download on its
// own (if enabled), then offer one inline "Restart to update" action.

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  ready: boolean;
}

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none"; checkedAt: number }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; pct: number | null }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "installing"; info: UpdateInfo }
  | { kind: "error"; message: string };

export const updatesSupported = isTauri && !isMobile;
const CHECK_EVERY = 6 * 3600_000;

let status: UpdateStatus = { kind: "idle" };
const subs = new Set<() => void>();
function set(s: UpdateStatus) {
  status = s;
  subs.forEach((f) => f());
}

/** `manual` = the user asked: always hits the network, even right after a background check. */
export async function checkForUpdates(channel: string, autoDownload: boolean, manual = false) {
  if (!updatesSupported || status.kind === "downloading" || status.kind === "installing" || status.kind === "checking") return;
  if (status.kind === "ready" && !manual) return;
  set({ kind: "checking" });
  try {
    const info = await invoke<UpdateInfo | null>("update_check", { channel });
    if (!info) return set({ kind: "none", checkedAt: Date.now() });
    if (info.ready) return set({ kind: "ready", info });
    set({ kind: "available", info });
    if (autoDownload) await downloadUpdate();
  } catch (e) {
    const msg = String(e);
    set({ kind: "error", message: /pubkey|public key|base64|decode/i.test(msg) ? "Updates aren't configured for this build yet (run npm run updater:setup)." : msg });
  }
}

export async function downloadUpdate() {
  if (status.kind !== "available" && status.kind !== "error") return;
  const info = status.kind === "available" ? status.info : null;
  if (!info) return;
  set({ kind: "downloading", info, pct: 0 });
  let total = 0;
  const off = await listen<{ downloaded: number; total: number | null }>("update-progress", (p) => {
    total = p.total ?? total;
    if (status.kind === "downloading") set({ ...status, pct: total ? Math.round((p.downloaded / total) * 100) : null });
  });
  try {
    const ready = await invoke<UpdateInfo>("update_download");
    set({ kind: "ready", info: ready ?? info });
  } catch (e) {
    set({ kind: "error", message: String(e) });
  } finally {
    off();
  }
}

export async function installUpdate() {
  if (status.kind !== "ready") return;
  set({ kind: "installing", info: status.info });
  try {
    await invoke("update_install"); // relaunches the app on success
  } catch (e) {
    set({ kind: "error", message: String(e) });
  }
}

// Browser preview of the inline update UI: add ?update-preview to the URL.
if (!isTauri && typeof location !== "undefined" && location.search.includes("update-preview")) {
  status = { kind: "ready", info: { version: "0.2.0", currentVersion: "0.1.0", notes: "Faster sync · new charts", date: null, ready: true } };
}

export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => status,
  );
}

/** Mount once in the main window: startup check + periodic checks. */
export function useUpdateScheduler() {
  const { settings, ready } = useApp();
  useEffect(() => {
    if (!updatesSupported || !ready) return;
    const run = () => checkForUpdates(settings.updateChannel, settings.autoUpdate);
    const first = setTimeout(run, 8_000);
    const every = setInterval(run, CHECK_EVERY);
    const offs: (() => void)[] = [];
    listen<string>("update-error", (m) => set({ kind: "error", message: m })).then((f) => offs.push(f));
    // "Check for Updates…" in the menu-bar menu: show the result in Settings → Updates.
    listen("check-updates", () => {
      location.hash = "#/settings";
      void checkForUpdates(settings.updateChannel, settings.autoUpdate, true);
    }).then((f) => offs.push(f));
    return () => {
      clearTimeout(first);
      clearInterval(every);
      offs.forEach((f) => f());
    };
  }, [ready, settings.updateChannel, settings.autoUpdate]);
}

/** For the tray popover window, which has its own JS context. */
export async function readyUpdateFromNative(): Promise<UpdateInfo | null> {
  return (await invoke<UpdateInfo | null>("update_status").catch(() => null)) ?? null;
}

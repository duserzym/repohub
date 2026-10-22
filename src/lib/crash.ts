import { invoke, isTauri } from "./platform";

// Crash capture + liveness heartbeat.
// * Every render crash / uncaught error is kept (last 5) so it can be shown in
//   Settings → Diagnostics and copied into a bug report.
// * The main window tells the native side it is alive while it has UI on
//   screen. If the window is focused and no heartbeat arrives (blank page,
//   dead web process), the native side reloads the webview.

export interface CrashRecord {
  at: string;
  message: string;
  stack?: string;
  where: string;
  version: string;
}

const KEY = "repohub:crashes";

export function recordCrash(err: unknown, where: string, extra?: string): CrashRecord {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const rec: CrashRecord = {
    at: new Date().toISOString(),
    message: e.message,
    stack: [e.stack, extra].filter(Boolean).join("\n").slice(0, 4000),
    where,
    version: __APP_VERSION__,
  };
  console.error(`[RepoHub ${where}]`, err);
  try {
    const list = readCrashes();
    list.unshift(rec);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    /* storage unavailable */
  }
  return rec;
}

export function readCrashes(): CrashRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function clearCrashes() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function crashText(c: CrashRecord) {
  return `RepoHub ${c.version} · ${c.where} · ${c.at}\n${c.message}\n${c.stack ?? ""}`;
}

let installed = false;

/** Global error capture + heartbeat. Call once, in the main window only. */
export function installCrashGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => recordCrash(ev.error ?? ev.message, "window.onerror"));
  window.addEventListener("unhandledrejection", (ev) => {
    // Network hiccups are handled by the queries themselves; keep only real bugs.
    const r = ev.reason;
    if (r instanceof TypeError || r instanceof RangeError || r instanceof ReferenceError) recordCrash(r, "unhandledrejection");
  });
  if (!isTauri) return;
  const beat = () => {
    // Alive = visible UI. An empty #root means React unmounted (blank window).
    if (!document.getElementById("root")?.firstElementChild) return;
    void invoke("heartbeat").catch(() => {});
  };
  beat();
  setInterval(beat, 15_000);
  window.addEventListener("focus", beat);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && beat());
}

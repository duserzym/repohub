// Thin layer that lets the same UI run inside Tauri (desktop + iOS) and in a
// plain browser during development (`npm run dev`).

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type FetchFn = typeof fetch;
let tauriFetch: FetchFn | null = null;

/** fetch() that bypasses CORS inside Tauri (needed for github.com/login/*). */
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    if (!tauriFetch) tauriFetch = (await import("@tauri-apps/plugin-http")).fetch as FetchFn;
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

export async function openUrl(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => cb(e.payload));
}

export const isMobile =
  typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

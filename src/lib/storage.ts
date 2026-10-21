import { invoke, isTauri } from "./platform";

// ---- Secrets (GitHub token) -------------------------------------------------
// Tauri: OS keychain via Rust `secret_*` commands. Browser dev: localStorage.

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri) {
    try {
      return (await invoke<string | null>("secret_get", { key })) ?? null;
    } catch (e) {
      console.warn("keychain read failed", e);
      return null;
    }
  }
  try {
    return localStorage.getItem(`secret:${key}`);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string) {
  if (isTauri) return void (await invoke("secret_set", { key, value }));
  try {
    localStorage.setItem(`secret:${key}`, value);
  } catch {
    /* ignore */
  }
}

export async function deleteSecret(key: string) {
  if (isTauri) return void (await invoke("secret_delete", { key }));
  try {
    localStorage.removeItem(`secret:${key}`);
  } catch {
    /* ignore */
  }
}

// ---- Key/value app data (settings, categories, caches) ---------------------
// Tauri: plugin-store JSON file in the app data dir. Browser: localStorage.

type StoreLike = {
  get<T>(k: string): Promise<T | undefined>;
  set(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<boolean>;
  save(): Promise<void>;
};

const stores = new Map<string, Promise<StoreLike>>();
function store(file = "repohub.json"): Promise<StoreLike> {
  let p = stores.get(file);
  if (!p) {
    p = import("@tauri-apps/plugin-store").then(
      ({ load }) => load(file, { autoSave: 400, defaults: {} }) as unknown as Promise<StoreLike>,
    );
    stores.set(file, p);
  }
  return p;
}

export async function kvGet<T>(key: string, file?: string): Promise<T | undefined> {
  if (isTauri) return (await store(file)).get<T>(key);
  try {
    const raw = localStorage.getItem(`kv:${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown, file?: string) {
  if (isTauri) return (await store(file)).set(key, value);
  try {
    localStorage.setItem(`kv:${key}`, JSON.stringify(value));
  } catch {
    /* quota or private mode — ignore */
  }
}

export async function kvDelete(key: string, file?: string) {
  if (isTauri) return void (await store(file)).delete(key);
  try {
    localStorage.removeItem(`kv:${key}`);
  } catch {
    /* ignore */
  }
}

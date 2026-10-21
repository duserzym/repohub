import { httpFetch } from "./platform";
import { kvGet, kvSet } from "./storage";
import type { Repo } from "./types";

// Repo icons are read from the repository itself (logo/icon files found in the
// root, .github, assets, docs, images or public folders), fetched through the
// contents API so private repos work, and cached as data URLs.

const FILE = "icons.json";
const TTL = 7 * 864e5;
const MAX_BYTES = 400_000;
const mem = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const MIME: Record<string, string> = {
  png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ico: "image/x-icon",
};

interface Cached {
  url: string | null;
  at: number;
}

export function iconKey(r: Repo) {
  return `${r.nameWithOwner}:${r.iconPaths[0] ?? ""}`;
}

export function cachedIcon(r: Repo): string | null | undefined {
  return mem.get(iconKey(r));
}

export function resolveIcon(r: Repo, token: string | null): Promise<string | null> {
  const key = iconKey(r);
  if (mem.has(key)) return Promise.resolve(mem.get(key)!);
  let p = inflight.get(key);
  if (!p) {
    p = load(r, token, key).then((url) => {
      mem.set(key, url);
      inflight.delete(key);
      return url;
    });
    inflight.set(key, p);
  }
  return p;
}

async function load(r: Repo, token: string | null, key: string): Promise<string | null> {
  const cached = await kvGet<Cached>(key, FILE);
  if (cached && Date.now() - cached.at < TTL) return cached.url;

  let url: string | null = null;
  for (const path of r.iconPaths) {
    url = await fetchFile(r.nameWithOwner, path, token).catch(() => null);
    if (url) break;
  }
  // Fall back to a custom social-preview image when the repo has one.
  if (!url && r.socialImage) url = r.socialImage;
  await kvSet(key, { url, at: Date.now() } satisfies Cached, FILE);
  return url;
}

async function fetchFile(repo: string, path: string, token: string | null): Promise<string | null> {
  const ext = path.split(".").pop()!.toLowerCase();
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await httpFetch(`https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`, { headers });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
  return toDataUrl(buf, MIME[ext] ?? "application/octet-stream");
}

function toDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function clearIconMemory() {
  mem.clear();
}

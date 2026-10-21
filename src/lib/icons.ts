import { httpFetch } from "./platform";
import { kvGet, kvSet } from "./storage";
import type { Repo } from "./types";

// Repo icons, best source first:
//  1. logo/icon files in common folders (root, .github, assets, docs, images, public, img, static)
//  2. the first logo-like image near the top of the README
//  3. the repo's custom social-preview image
//  (the card falls back to the org avatar, then a monogram)
// Files are fetched through the contents API so private repos work, and cached.

const FILE = "icons.json";
const TTL = 7 * 864e5;
const MAX_BYTES = 400_000;
const mem = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const MIME: Record<string, string> = {
  png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ico: "image/x-icon", gif: "image/gif",
};

interface Cached {
  url: string | null;
  at: number;
}

export function iconKey(r: Repo) {
  return `v2:${r.nameWithOwner}:${r.iconPaths[0] ?? ""}`; // v2: ignore misses cached by older builds
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

// At most 4 icon downloads at a time, so icons never compete with the repo list.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((res) => waiting.push(res));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function load(r: Repo, token: string | null, key: string): Promise<string | null> {
  if (r.id.startsWith("demo-")) return r.socialImage; // demo data: no network
  const cached = await kvGet<Cached>(key, FILE);
  if (cached && Date.now() - cached.at < TTL) return cached.url;
  return slot(() => download(r, token, key));
}

async function download(r: Repo, token: string | null, key: string): Promise<string | null> {
  let url: string | null = null;
  for (const path of r.iconPaths) {
    url = await fetchFile(r.nameWithOwner, path, token).catch(() => null);
    if (url) break;
  }
  if (!url) url = await readmeLogo(r.nameWithOwner, token).catch(() => null);
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

const BADGE = /shields\.io|badge|badgen|travis-ci|codecov|coveralls|circleci|readthedocs|zenodo|doi\.org|actions\/workflows|githubusercontent\.com\/.*\/workflows|img\.shields|pepy|pypi|anaconda\.org|binder|colab|star-history|contrib\.rocks/i;

/** The first logo-like image near the top of the README (skips CI/version badges). */
async function readmeLogo(repo: string, token: string | null): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await httpFetch(`https://api.github.com/repos/${repo}/readme`, { headers });
  if (!res.ok) return null;
  const text = (await res.text()).slice(0, 8000);
  const found: { src: string; hint: string; at: number }[] = [];
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)/g)) found.push({ src: m[2], hint: m[1], at: m.index ?? 0 });
  for (const m of text.matchAll(/<img[^>]*?src=["']([^"']+)["'][^>]*>/gi)) found.push({ src: m[1], hint: m[0], at: m.index ?? 0 });
  const images = found
    .filter((f) => !BADGE.test(f.src) && /\.(png|svg|jpe?g|webp|gif)(\?|#|$)/i.test(f.src.split("?")[0] + "?"))
    .sort((a, b) => a.at - b.at);
  const pick = images.find((f) => /logo|icon|brand/i.test(f.src + " " + f.hint)) ?? images.find((f) => f.at < 1500);
  if (!pick) return null;
  let src = pick.src;
  const blob = src.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/[^/]+\/(.+)$/);
  if (blob && blob[1].toLowerCase() === repo.toLowerCase()) src = blob[2]; // same repo → fetch via API (works when private)
  if (/^https?:\/\//i.test(src)) return src.replace(/^http:/, "https:"); // external image: load directly
  const path = src.replace(/^\.?\//, "").split(/[?#]/)[0];
  return fetchFile(repo, decodeURI(path), token).catch(() => null);
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

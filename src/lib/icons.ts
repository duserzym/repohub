import { httpFetch } from "./platform";
import { kvGet, kvSet } from "./storage";
import type { Repo } from "./types";

// Repo icons, best source first:
//  0. the icon you gave the project on your own website (<you>.github.io → _data/software.yml / projects.yml)
//  1. logo/icon files in common folders (root, .github, assets, docs, images, public, img, static)
//  2. the first logo-like image near the top of the README
//  3. the icon declared by the repo's homepage (GitHub Pages sites)
//  4. the repo's custom social-preview image
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
  return `v3:${r.nameWithOwner}:${r.iconPaths[0] ?? ""}`; // v3: ignore misses cached by older builds
}

export function cachedIcon(r: Repo): string | null | undefined {
  return mem.get(iconKey(r));
}

export function resolveIcon(r: Repo, token: string | null, login?: string): Promise<string | null> {
  const key = iconKey(r);
  if (mem.has(key)) return Promise.resolve(mem.get(key)!);
  let p = inflight.get(key);
  if (!p) {
    p = load(r, token, key, login).then((url) => {
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

async function load(r: Repo, token: string | null, key: string, login?: string): Promise<string | null> {
  if (r.id.startsWith("demo-")) return r.socialImage; // demo data: no network
  if (login) {
    const cat = await siteCatalog(token, login);
    const hit = lookupByUrl(cat, r, login);
    if (hit) return hit;
  }
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
  if (!url && r.homepageUrl) url = await homepageIcon(r.homepageUrl).catch(() => null);
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

// ---------------------------------------------------------------------------
// 0. Icons from your own website's project list
// ---------------------------------------------------------------------------

const norm = (u: string) => u.trim().toLowerCase().replace(/^http:/, "https:").replace(/\.git$/, "").replace(/\/+$/, "");
let catalogFor: string | null = null;
let catalogP: Promise<Map<string, string>> | null = null;

/** url → icon URL, read from <login>/<login>.github.io: _data/software.yml and _data/projects.yml. */
export function siteCatalog(token: string | null, login: string): Promise<Map<string, string>> {
  if (catalogP && catalogFor === login) return catalogP;
  catalogFor = login;
  catalogP = (async () => {
    const map = new Map<string, string>();
    const repo = `${login}/${login}.github.io`;
    const site = `https://${login.toLowerCase()}.github.io`;
    for (const file of ["_data/software.yml", "_data/projects.yml"]) {
      const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await httpFetch(`https://api.github.com/repos/${repo}/contents/${file}`, { headers }).catch(() => null);
      if (!res?.ok) continue;
      for (const e of parseYamlList(await res.text())) {
        const icon = e.icon || e.img || e.image || e.logo;
        const urls = [e.url, e.github, e.repo, e.repository, e.homepage].filter(Boolean) as string[];
        if (!icon || !urls.length) continue;
        const abs = /^https?:\/\//i.test(icon) ? icon : `${site}${icon.startsWith("/") ? "" : "/"}${icon}`;
        for (const u of urls) {
          const full = /^https?:\/\//i.test(u) ? u : u.includes("/") ? `https://github.com/${u}` : `${site}/${u}`;
          map.set(norm(full), abs);
        }
      }
    }
    return map;
  })();
  return catalogP;
}

function lookupByUrl(cat: Map<string, string>, r: Repo, login: string): string | null {
  const candidates = [
    r.url,
    r.homepageUrl ?? "",
    `https://${r.owner}.github.io/${r.name}`,
    `https://${login}.github.io/${r.name}`,
  ];
  for (const c of candidates) {
    const hit = c && cat.get(norm(c));
    if (hit) return hit;
  }
  return null;
}

/** Tiny parser for a YAML list of flat mappings (the format of Jekyll _data files). */
function parseYamlList(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    const m = line.match(/^(-\s+|\s+)?([A-Za-z_]+):\s*(.*)$/);
    if (line.startsWith("- ")) {
      cur = {};
      out.push(cur);
    }
    if (m && cur) cur[m[2]] = m[3].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Icon declared by the repo's homepage (GitHub Pages sites)
// ---------------------------------------------------------------------------

async function homepageIcon(homepage: string): Promise<string | null> {
  if (!/^https:\/\/[^/]+\.github\.io\//i.test(homepage + "/")) return null; // only GitHub Pages (allowed by the app's network policy)
  const res = await httpFetch(homepage, { headers: { Accept: "text/html" } });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 30000);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, a: string) => tag.match(new RegExp(`${a}=["']([^"']+)["']`, "i"))?.[1] ?? "";
  const icons = links
    .filter((l) => /icon/i.test(attr(l, "rel")))
    .map((l) => ({ href: attr(l, "href"), rel: attr(l, "rel").toLowerCase(), type: attr(l, "type") }))
    .filter((l) => l.href && !/\.ico(\?|$)/i.test(l.href));
  const best =
    icons.find((l) => l.rel.includes("apple-touch")) ??
    icons.find((l) => /svg/.test(l.type) || /\.svg(\?|$)/i.test(l.href)) ??
    icons.find((l) => /\.png(\?|$)/i.test(l.href));
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const pick = best?.href ?? og;
  return pick ? new URL(pick, homepage.endsWith("/") ? homepage : homepage + "/").toString() : null;
}

const BADGE = /shields\.io|badge|badgen|travis-ci|codecov|coveralls|circleci|readthedocs|zenodo|doi\.org|actions\/workflows|githubusercontent\.com\/.*\/workflows|img\.shields|pepy|pypi|anaconda\.org|binder|colab|star-history|contrib\.rocks|creativecommons|licensebuttons/i;

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
  // Only clearly logo-like images: the first figure in a README is usually a plot, not an icon.
  const pick = images.find((f) => /logo|icon|brand/i.test(f.src + " " + f.hint));
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

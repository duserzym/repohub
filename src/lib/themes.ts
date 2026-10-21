// Color themes ("palettes"). Each has a light and a dark variant; the
// light/dark/system mode is chosen separately. All derived tokens are computed
// here as plain hex/rgba so older WebKit (macOS 11+) renders them correctly.
//
// Status colors (✓ green / ◷ amber / ✕ red / – gray) and chart category
// colors are deliberately NOT themed, so they read the same everywhere.

export interface PaletteMode {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  blob: string;
  /** optional second glow color (defaults to a mix of accent and background) */
  blob2?: string;
  /** glow strength multiplier for brighter themes (default 1) */
  glow?: number;
}
export interface Palette {
  id: string;
  name: string;
  mood: string;
  light: PaletteMode;
  dark: PaletteMode;
}

export const PALETTES: Palette[] = [
  { id: "porcelain-sapphire", name: "Porcelain & Sapphire", mood: "Cool white, quiet deep blue",
    light: { bg: "#f1f3f7", ink: "#151a24", muted: "#6c7486", accent: "#2f4a7a", accent2: "#4a679a", blob: "#b7a98e" },
    dark: { bg: "#0c111d", ink: "#e6eaf2", muted: "#8590a6", accent: "#93aede", accent2: "#b4c7ea", blob: "#3d4e7a" } },
  { id: "lagoon", name: "Lagoon", mood: "Bright teal, ocean blue, sea-glass green",
    light: { bg: "#ecf8f6", ink: "#0f1d20", muted: "#5a7378", accent: "#0a7d84", accent2: "#14b8a6", blob: "#3b82f6", blob2: "#22c55e", glow: 1.9 },
    dark: { bg: "#081419", ink: "#e4f3f2", muted: "#7f9a9d", accent: "#2ed3bf", accent2: "#7ce8db", blob: "#2563eb", blob2: "#10b981", glow: 1.5 } },
  { id: "ivory-brass", name: "Ivory & Brass", mood: "Warm ivory, antique brass",
    light: { bg: "#f3efe8", ink: "#1d1b18", muted: "#80786b", accent: "#846430", accent2: "#a9864a", blob: "#768ca4" },
    dark: { bg: "#101115", ink: "#ece7de", muted: "#8e877b", accent: "#d4b47e", accent2: "#e6cc9c", blob: "#546a96" } },
  { id: "sage-pewter", name: "Sage & Pewter", mood: "Soft green on grey stone",
    light: { bg: "#eef1ec", ink: "#171c18", muted: "#6f7a71", accent: "#4f6e57", accent2: "#6e8e76", blob: "#a3a8ae" },
    dark: { bg: "#0e1310", ink: "#e5ebe6", muted: "#859087", accent: "#9cc2a5", accent2: "#bcd8c2", blob: "#4b5a52" } },
  { id: "sandstone-terracotta", name: "Sandstone & Terracotta", mood: "Desert stone, fired clay",
    light: { bg: "#f5eee6", ink: "#211915", muted: "#86766a", accent: "#9a5236", accent2: "#b87355", blob: "#c9a77f" },
    dark: { bg: "#15100d", ink: "#f0e6de", muted: "#958376", accent: "#e39d7d", accent2: "#efbca3", blob: "#6b4430" } },
  { id: "graphite-platinum", name: "Graphite & Platinum", mood: "Near-monochrome brushed metal",
    light: { bg: "#eceef0", ink: "#15171a", muted: "#6e737a", accent: "#3a3f46", accent2: "#5b616a", blob: "#b4b9c0" },
    dark: { bg: "#0e0f11", ink: "#e9ebee", muted: "#868b93", accent: "#cdd2d9", accent2: "#e4e7eb", blob: "#3b4048" } },
  { id: "plum-smoke", name: "Plum & Smoke", mood: "Muted aubergine, smoky grey",
    light: { bg: "#f3eff3", ink: "#1c1620", muted: "#7c7181", accent: "#6a4871", accent2: "#8a6891", blob: "#a7a1b5" },
    dark: { bg: "#120e14", ink: "#ece4ee", muted: "#8f8494", accent: "#c9a8d1", accent2: "#dcc3e2", blob: "#4d3b57" } },
  { id: "glacier-slate", name: "Glacier & Slate", mood: "Ice blue, slate teal",
    light: { bg: "#eef3f5", ink: "#13191b", muted: "#6a787d", accent: "#2b6370", accent2: "#4a8391", blob: "#9fb4c4" },
    dark: { bg: "#0b1416", ink: "#e3eef0", muted: "#7f9296", accent: "#84c5cf", accent2: "#acdbe1", blob: "#2f5662" } },
  { id: "basalt-copper", name: "Basalt & Copper", mood: "Volcanic stone, copper veins",
    light: { bg: "#efedea", ink: "#1a1816", muted: "#7a746d", accent: "#94562a", accent2: "#b2764a", blob: "#8f8c88" },
    dark: { bg: "#121110", ink: "#ece8e3", muted: "#8d8780", accent: "#dc9566", accent2: "#e9b48f", blob: "#4a3426" } },
  { id: "linen-olive", name: "Linen & Olive", mood: "Natural linen, olive grove",
    light: { bg: "#f4f1e6", ink: "#1b1a12", muted: "#7c7966", accent: "#5f5e27", accent2: "#7f7e45", blob: "#c2ad85" },
    dark: { bg: "#12120c", ink: "#ebe9dc", muted: "#8c8a78", accent: "#c7c47f", accent2: "#dbd9a3", blob: "#4b4a2a" } },
  { id: "rose-taupe", name: "Rosé Quartz & Taupe", mood: "Blush mineral, warm taupe",
    light: { bg: "#f6efee", ink: "#1f1718", muted: "#86777a", accent: "#94545c", accent2: "#b2737b", blob: "#bba99d" },
    dark: { bg: "#151011", ink: "#efe5e6", muted: "#958689", accent: "#e3a7ae", accent2: "#eec3c8", blob: "#5a3c41" } },
];

export const DEFAULT_PALETTE = "porcelain-sapphire";
export const paletteById = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/* ----------------------------------------------------------- color math */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
/** t = 0 → a, t = 1 → b */
export function mix(a: string, b: string, t: number) {
  const A = rgb(a), B = rgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}
export function alpha(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

/* ------------------------------------------------------------ CSS vars */

function tokens(p: PaletteMode, dark: boolean): Record<string, string> {
  const t: Record<string, string> = {
    "--bg": p.bg,
    "--fg": p.ink,
    "--fg-2": mix(p.ink, p.bg, dark ? 0.2 : 0.25),
    "--muted": p.muted,
    "--accent": p.accent,
    "--accent-2": p.accent2,
    "--accent-fg": dark ? mix(p.bg, "#000000", 0.2) : "#fffaf3",
    "--blob-1": alpha(p.accent2, Math.min(0.6, (dark ? 0.13 : 0.2) * (p.glow ?? 1))),
    "--blob-2": alpha(p.blob, Math.min(0.6, 0.2 * (p.glow ?? 1))),
    "--blob-3": alpha(p.blob2 ?? mix(p.accent, p.bg, 0.5), Math.min(0.6, (dark ? 0.1 : 0.22) * (p.glow ?? 1))),
    "--series-1": p.accent,
  };
  if (dark) {
    Object.assign(t, {
      "--glass": alpha(mix(p.bg, "#ffffff", 0.09), 0.55),
      "--glass-strong": alpha(mix(p.bg, "#ffffff", 0.1), 0.86),
      "--glass-edge": "rgb(255 255 255 / 0.08)",
      "--bg-2": "rgb(255 255 255 / 0.05)",
      "--line": "rgb(255 255 255 / 0.08)",
      "--line-2": "rgb(255 255 255 / 0.15)",
      "--viz-grid": "rgb(255 255 255 / 0.07)",
      "--viz-axis": "rgb(255 255 255 / 0.18)",
      "--viz-none": "rgb(255 255 255 / 0.14)",
      "--seq-0": "rgb(255 255 255 / 0.05)",
    });
    // dark: more activity = brighter
    [0.2, 0.36, 0.52, 0.7, 0.86, 1].forEach((k, i) => (t[`--seq-${i + 1}`] = i < 5 ? mix(p.bg, p.accent, k) : p.accent2));
  } else {
    Object.assign(t, {
      "--glass": alpha(mix(p.bg, "#ffffff", 0.7), 0.58),
      "--glass-strong": alpha(mix(p.bg, "#ffffff", 0.75), 0.84),
      "--glass-edge": "rgb(255 255 255 / 0.75)",
      "--bg-2": alpha(p.ink, 0.06),
      "--line": alpha(p.ink, 0.1),
      "--line-2": alpha(p.ink, 0.18),
      "--viz-grid": alpha(p.ink, 0.09),
      "--viz-axis": alpha(p.ink, 0.22),
      "--viz-none": alpha(p.ink, 0.16),
      "--seq-0": alpha(p.ink, 0.07),
    });
    // light: more activity = darker
    [0.18, 0.34, 0.52, 0.72, 0.88].forEach((k, i) => (t[`--seq-${i + 1}`] = mix(p.bg, p.accent, k)));
    t["--seq-6"] = mix(p.accent, p.ink, 0.35);
  }
  return t;
}

const block = (sel: string, t: Record<string, string>) =>
  `${sel}{${Object.entries(t).map(([k, v]) => `${k}:${v}`).join(";")}}`;

/** Injects the palette as a <style> that overrides the defaults in app.css. */
export function applyPalette(id: string) {
  const p = paletteById(id);
  const css = [
    block(":root", tokens(p.light, false)),
    `@media (prefers-color-scheme: dark){${block(':root:not([data-theme="light"])', tokens(p.dark, true))}}`,
    block(':root[data-theme="dark"]', tokens(p.dark, true)),
  ].join("\n");
  let el = document.getElementById("palette-vars") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "palette-vars";
    document.head.appendChild(el);
  }
  el.textContent = css;
  document.documentElement.dataset.palette = p.id;
  try {
    localStorage.setItem("palette-cache", p.id); // instant apply on next launch, before settings load
  } catch {
    /* ignore */
  }
}

export function applyMode(mode: "system" | "light" | "dark") {
  const el = document.documentElement;
  if (mode === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", mode);
  try {
    localStorage.setItem("mode-cache", mode);
  } catch {
    /* ignore */
  }
}

/** Called before first render so the last-used look appears without a flash. */
export function applyCachedAppearance() {
  try {
    applyPalette(localStorage.getItem("palette-cache") ?? DEFAULT_PALETTE);
    const mode = localStorage.getItem("mode-cache") as "system" | "light" | "dark" | null;
    if (mode) applyMode(mode);
  } catch {
    /* ignore */
  }
}

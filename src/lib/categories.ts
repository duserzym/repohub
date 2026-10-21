import type { Category, Repo } from "./types";

export const UNCATEGORIZED = "uncategorized";

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "geochemistry",
    name: "Geochemistry",
    color: "#d97706",
    keywords: [
      "geochem", "isotope", "isotopic", "tims", "icp-ms", "icpms", "la-icp", "mass-spec", "mass spectrometry",
      "geochron", "u-pb", "upb", "zircon", "ar-ar", "argon", "radiogenic", "petrology", "mineral", "xrf",
      "trace element", "lu-hf", "sm-nd", "rb-sr",
    ],
  },
  {
    id: "geophysics",
    name: "Geophysics",
    color: "#2563eb",
    keywords: [
      "geophys", "paleomag", "pmag", "magnetic", "magnetism", "seism", "gravity", "geodyn", "geodesy",
      "tectonic", "mantle", "apwp", "paleopole", "gnss", "insar", "magnetotelluric", "geoid",
    ],
  },
];

export const CATEGORY_COLORS = [
  "#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626", "#475569",
];

/** Keyword-based suggestion used when a repo has no manual assignment. */
export function suggestCategory(repo: Repo, categories: Category[]): string | null {
  const hay = ` ${repo.name} ${repo.description} ${repo.topics.join(" ")} `.toLowerCase().replace(/[_]/g, "-");
  let best: { id: string; hits: number } | null = null;
  for (const c of categories) {
    const hits = c.keywords.filter((k) => k && hay.includes(k.toLowerCase())).length;
    if (hits && (!best || hits > best.hits)) best = { id: c.id, hits };
  }
  return best?.id ?? null;
}

export function categoryOf(
  repo: Repo,
  categories: Category[],
  assignments: Record<string, string>,
): { id: string; auto: boolean } {
  const manual = assignments[repo.nameWithOwner];
  if (manual && (manual === UNCATEGORIZED || categories.some((c) => c.id === manual))) return { id: manual, auto: false };
  const s = suggestCategory(repo, categories);
  return s ? { id: s, auto: true } : { id: UNCATEGORIZED, auto: true };
}

export const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `cat-${Date.now()}`;

import type { Repo } from "./types";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

export const num = (n: number) =>
  n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Single "progress" number per repo:
 * nearest open milestone if any, otherwise share of issues closed.
 * Returns null when there is nothing to measure.
 */
export function repoProgress(r: Repo): { pct: number; label: string } | null {
  const m = r.milestones[0];
  if (m && m.open + m.closed > 0) return { pct: m.progress, label: m.title };
  const total = r.openIssues + r.closedIssues;
  if (total > 0) return { pct: Math.round((r.closedIssues / total) * 100), label: "Issues closed" };
  return null;
}

export const commits30 = (r: Repo) => r.weekly.slice(-4).reduce((a, b) => a + b, 0);

export function isOverdue(due: string | null) {
  return !!due && new Date(due).getTime() < Date.now();
}

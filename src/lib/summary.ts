import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "./categories";
import { ago, commits30, isOverdue, repoProgress } from "./format";
import { invoke, isTauri } from "./platform";
import type { Category, MenuBarStat, Repo } from "./types";

export interface Attention {
  repo: string;
  kind: "ci" | "overdue" | "prs" | "stale-pr";
  text: string;
}

export interface Summary {
  repos: number;
  openIssues: number;
  closedIssues: number;
  openPRs: number;
  failingCI: number;
  passingCI: number;
  commits30: number;
  releases30: number;
  avgProgress: number | null;
  byCategory: { id: string; name: string; color: string; repos: number; openIssues: number; openPRs: number; failing: number }[];
  attention: Attention[];
  recent: { repo: string; when: string; message: string }[];
}

export function summarize(repos: Repo[], categories: Category[], assignments: Record<string, string>): Summary {
  const month = Date.now() - 30 * 864e5;
  const cats = new Map(
    [...categories, { id: UNCATEGORIZED, name: "Uncategorized", color: UNCATEGORIZED_COLOR, keywords: [] }].map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, repos: 0, openIssues: 0, openPRs: 0, failing: 0 },
    ]),
  );
  const attention: Attention[] = [];
  const progresses: number[] = [];
  let failingCI = 0;
  let passingCI = 0;
  for (const r of repos) {
    const c = cats.get(categoryOf(r, categories, assignments).id)!;
    c.repos++;
    c.openIssues += r.openIssues;
    c.openPRs += r.openPRs;
    const failing = r.ci === "FAILURE" || r.ci === "ERROR";
    if (failing) {
      failingCI++;
      c.failing++;
      attention.push({
        repo: r.nameWithOwner,
        kind: "ci",
        text: r.ciFailing?.length ? `${r.ciFailing[0]}${r.ciFailing.length > 1 ? ` +${r.ciFailing.length - 1}` : ""} failing` : "CI failing on " + (r.defaultBranch ?? "default branch"),
      });
    } else if (r.ci === "SUCCESS") passingCI++;
    for (const m of r.milestones)
      if (isOverdue(m.dueOn) && m.open > 0)
        attention.push({ repo: r.nameWithOwner, kind: "overdue", text: `Milestone “${m.title}” overdue · ${m.open} open` });
    if (r.openPRs >= 3) attention.push({ repo: r.nameWithOwner, kind: "prs", text: `${r.openPRs} pull requests open` });
    const p = repoProgress(r);
    if (p) progresses.push(p.pct);
  }
  const recent = repos
    .filter((r) => r.lastCommit)
    .sort((a, b) => +new Date(b.lastCommit!.date) - +new Date(a.lastCommit!.date))
    .slice(0, 6)
    .map((r) => ({ repo: r.nameWithOwner, when: r.lastCommit!.date, message: r.lastCommit!.message }));

  return {
    repos: repos.length,
    openIssues: sum(repos, (r) => r.openIssues),
    closedIssues: sum(repos, (r) => r.closedIssues),
    openPRs: sum(repos, (r) => r.openPRs),
    failingCI,
    passingCI,
    commits30: sum(repos, commits30),
    releases30: repos.filter((r) => r.latestRelease && +new Date(r.latestRelease.publishedAt) > month).length,
    avgProgress: progresses.length ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length) : null,
    byCategory: [...cats.values()].filter((c) => c.repos > 0 || c.id !== UNCATEGORIZED),
    attention: attention.sort((a, b) => rank(a.kind) - rank(b.kind)),
    recent,
  };
}

const rank = (k: Attention["kind"]) => ({ ci: 0, overdue: 1, prs: 2, "stale-pr": 3 })[k];
const sum = (rs: Repo[], f: (r: Repo) => number) => rs.reduce((a, r) => a + f(r), 0);

/** Compact text for the macOS menu bar, e.g. "⊙ 42  ⑂ 7  ✕ 1". */
export function menuBarTitle(s: Summary, stats: MenuBarStat[]): string {
  const parts: string[] = [];
  for (const k of stats) {
    if (k === "issues") parts.push(`⊙ ${s.openIssues}`);
    if (k === "prs") parts.push(`⑂ ${s.openPRs}`);
    if (k === "ci") parts.push(s.failingCI ? `✕ ${s.failingCI}` : "✓");
    if (k === "commits") parts.push(`↑ ${s.commits30}`);
    if (k === "progress" && s.avgProgress != null) parts.push(`${s.avgProgress}%`);
  }
  return parts.join("  ");
}

export async function pushTray(s: Summary, stats: MenuBarStat[], fetchedAt: string, login: string) {
  if (!isTauri) return;
  const lines = [
    { label: `Repositories`, detail: String(s.repos) },
    { label: `Open issues`, detail: String(s.openIssues) },
    { label: `Open pull requests`, detail: String(s.openPRs) },
    { label: `CI`, detail: s.failingCI ? `${s.failingCI} failing · ${s.passingCI} passing` : `${s.passingCI} passing` },
    { label: `Commits (30 days)`, detail: String(s.commits30) },
    ...(s.avgProgress != null ? [{ label: "Average progress", detail: `${s.avgProgress}%` }] : []),
    ...s.byCategory.filter((c) => c.repos).map((c) => ({ label: `  ${c.name}`, detail: `${c.repos} repos · ${c.openIssues} issues` })),
    { label: `Synced ${ago(fetchedAt)} as @${login}`, detail: "" },
  ];
  const tooltip = `RepoHub — ${s.openIssues} issues, ${s.openPRs} PRs${s.failingCI ? `, ${s.failingCI} CI failing` : ""}`;
  try {
    await invoke("update_tray", {
      summary: { title: menuBarTitle(s, stats), tooltip, lines, extra: { summary: s, fetchedAt, login } },
    });
  } catch (e) {
    console.warn("tray update failed", e);
  }
}

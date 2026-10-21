import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Empty, Progress, Spinner, Stat } from "../components/bits";
import { Icon } from "../components/Icon";
import { RepoCard, RepoRow } from "../components/RepoCard";
import { categoryOf, UNCATEGORIZED } from "../lib/categories";
import { ago, commits30, repoProgress } from "../lib/format";
import { useRepos } from "../lib/queries";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import { summarize } from "../lib/summary";
import type { Repo, Settings } from "../lib/types";

function pref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const SORTS: Record<Settings["sort"], (a: Repo, b: Repo) => number> = {
  pushed: (a, b) => +new Date(b.pushedAt ?? 0) - +new Date(a.pushedAt ?? 0),
  name: (a, b) => a.name.localeCompare(b.name),
  progress: (a, b) => (repoProgress(b)?.pct ?? -1) - (repoProgress(a)?.pct ?? -1),
  issues: (a, b) => b.openIssues - a.openIssues,
  stars: (a, b) => b.stars - a.stars,
};

export function Dashboard({ category }: { category: string | null }) {
  const app = useApp();
  const { categories, assignments, pinned, settings, update } = app;
  const { data, isLoading, isFetching, error, summary } = useRepos();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"grid" | "list">(() => pref("view-mode", "grid") as "grid" | "list");
  const setModeP = (m: "grid" | "list") => {
    setMode(m);
    try {
      localStorage.setItem("view-mode", m);
    } catch {
      /* ignore */
    }
  };

  const cat = categories.find((c) => c.id === category);
  const title = category ? (cat?.name ?? (category === UNCATEGORIZED ? "Uncategorized" : "Category")) : "Dashboard";

  const repos = useMemo(() => {
    let rs = data?.repos ?? [];
    if (category) rs = rs.filter((r) => categoryOf(r, categories, assignments).id === category);
    const f = filter.trim().toLowerCase();
    if (f) rs = rs.filter((r) => `${r.nameWithOwner} ${r.description} ${r.topics.join(" ")} ${r.language?.name ?? ""}`.toLowerCase().includes(f));
    return [...rs].sort(SORTS[settings.sort]);
  }, [data, category, categories, assignments, filter, settings.sort]);

  const s = useMemo(() => (category ? summarize(repos, categories, assignments) : summary), [category, repos, categories, assignments, summary]);

  if (isLoading) return <div className="center-fill"><Spinner /> <span className="muted">Loading your repositories…</span></div>;
  if (error && !data)
    return (
      <Empty icon="alert" title="Couldn't load repositories">
        <p className="muted">{(error as Error).message}</p>
        <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["repos"] })}>Retry</button>
      </Empty>
    );

  const pinnedRepos = !category && !filter ? repos.filter((r) => pinned.includes(r.nameWithOwner)) : [];
  const renderList = (items: Repo[]) =>
    mode === "grid" ? (
      <div className="grid">{items.map((r) => <RepoCard key={r.id} repo={r} />)}</div>
    ) : (
      <div className="card list">{items.map((r) => <RepoRow key={r.id} repo={r} />)}</div>
    );

  const sections = !category && !filter
    ? [...categories, { id: UNCATEGORIZED, name: "Uncategorized", color: "#94a3b8", keywords: [] }]
        .map((c) => ({ c, items: repos.filter((r) => categoryOf(r, categories, assignments).id === c.id) }))
        .filter((x) => x.items.length)
    : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="row gap">
            {cat && <span className="dot big" style={{ background: cat.color }} />}
            {title}
          </h1>
          <div className="muted small">
            {data && <>Synced {ago(data.fetchedAt)} · auto-refresh every {settings.pollMinutes} min · {data.rateLimit.remaining}/{data.rateLimit.limit} API points left</>}
          </div>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter repositories" aria-label="Filter repositories" />
          </div>
          <select className="input" value={settings.sort} onChange={(e) => update("settings", (x) => ({ ...x, sort: e.target.value as Settings["sort"] }))} aria-label="Sort">
            <option value="pushed">Recently pushed</option>
            <option value="progress">Progress</option>
            <option value="issues">Open issues</option>
            <option value="stars">Stars</option>
            <option value="name">Name</option>
          </select>
          <div className="seg">
            <button className={mode === "grid" ? "on" : ""} onClick={() => setModeP("grid")} aria-label="Grid view"><Icon name="grid" /></button>
            <button className={mode === "list" ? "on" : ""} onClick={() => setModeP("list")} aria-label="List view"><Icon name="list" /></button>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["repos"] })} disabled={isFetching} title="Refresh now">
            <Icon name="refresh" className={isFetching ? "spin" : ""} />
            <span className="hide-sm">Refresh</span>
          </button>
        </div>
      </header>

      {s && (
        <div className="stats">
          <Stat icon="folder" label="Repositories" value={s.repos} />
          <Stat icon="issue" label="Open issues" value={s.openIssues} sub={`${s.closedIssues} closed`} />
          <Stat icon="pr" label="Open PRs" value={s.openPRs} />
          <Stat icon="play" label="CI" value={s.failingCI ? `${s.failingCI} failing` : "All green"} tone={s.failingCI ? "bad" : "ok"} sub={`${s.passingCI} passing`} />
          <Stat icon="activity" label="Commits · 30d" value={s.commits30} />
          <Stat icon="milestone" label="Avg progress" value={s.avgProgress != null ? `${s.avgProgress}%` : "—"} sub={`${s.releases30} releases this month`} />
        </div>
      )}

      {!category && s && !filter && (
        <div className="panels">
          <section className="card panel">
            <h3><Icon name="alert" size={14} /> Needs attention</h3>
            {s.attention.length ? (
              <ul className="feed">
                {s.attention.slice(0, 6).map((a, i) => (
                  <li key={i}>
                    <span className={`pill ${a.kind}`}>{a.kind === "ci" ? "CI" : a.kind === "overdue" ? "Due" : "PRs"}</span>
                    <a href={href.repo(a.repo, a.kind === "ci" ? "actions" : a.kind === "prs" ? "pulls" : "milestones")}>
                      <strong>{a.repo.split("/")[1]}</strong> <span className="muted">{a.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing urgent. Nice.</p>
            )}
          </section>
          <section className="card panel">
            <h3><Icon name="commit" size={14} /> Latest commits</h3>
            <ul className="feed">
              {s.recent.map((r) => (
                <li key={r.repo}>
                  <a href={href.repo(r.repo, "commits")}>
                    <strong>{r.repo.split("/")[1]}</strong> <span className="muted truncate">{r.message}</span>
                  </a>
                  <span className="small muted when">{ago(r.when)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card panel">
            <h3><Icon name="folder" size={14} /> By category</h3>
            <ul className="cat-bars">
              {s.byCategory.map((c) => {
                const items = (data?.repos ?? []).filter((r) => categoryOf(r, categories, assignments).id === c.id);
                const ps = items.map(repoProgress).filter(Boolean).map((p) => p!.pct);
                const avg = ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : 0;
                return (
                  <li key={c.id}>
                    <a href={href.category(c.id)} className="row between small">
                      <span className="row gap"><span className="dot" style={{ background: c.color }} />{c.name}</span>
                      <span className="muted">{c.repos} repos · {c.openIssues} issues · {items.reduce((a, r) => a + commits30(r), 0)} commits</span>
                    </a>
                    <Progress pct={avg} color={c.color} thin />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {pinnedRepos.length > 0 && (
        <section className="section">
          <h2 className="section-title"><Icon name="pin" size={14} /> Pinned</h2>
          {renderList(pinnedRepos)}
        </section>
      )}

      {repos.length === 0 ? (
        <Empty icon="folder" title={filter ? "No matches" : "No repositories here yet"}>
          <p className="muted small">
            {category ? "Assign repos from any card's category menu, or add keywords to this category." : "Try Discover to track public projects."}
          </p>
        </Empty>
      ) : sections ? (
        sections.map(({ c, items }) => (
          <section className="section" key={c.id}>
            <h2 className="section-title">
              <span className="dot" style={{ background: c.color }} />
              <a href={href.category(c.id)}>{c.name}</a>
              <span className="muted small">{items.length}</span>
            </h2>
            {renderList(items)}
          </section>
        ))
      ) : (
        <section className="section">
          {renderList(repos)}
        </section>
      )}
    </div>
  );
}

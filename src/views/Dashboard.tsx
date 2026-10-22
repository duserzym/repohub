import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Progress, Spinner, Stat } from "../components/bits";
import { Icon } from "../components/Icon";
import { Insights } from "../components/Insights";
import { Drilldown, type DrillKind } from "../components/Drilldown";
import { RepoCard, RepoRow } from "../components/RepoCard";
import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { ago, commits30, repoProgress } from "../lib/format";
import { useLoadProgress, useRepos } from "../lib/queries";
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

export function Dashboard({ category, drill: initialDrill = null }: { category: string | null; drill?: DrillKind | null }) {
  const app = useApp();
  const { categories, assignments, pinned, settings, update } = app;
  const { data, isLoading, isFetching, error, summary } = useRepos();
  const progress = useLoadProgress();
  // Light data is on screen but progress / CI / activity are still streaming in.
  const pending = !!data?.repos.some((r) => r.enriched === false);
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [drill, setDrill] = useState<DrillKind | null>(initialDrill);
  const toggle = (k: DrillKind) => setDrill((d) => (d === k ? null : k));
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDrill(initialDrill), [initialDrill]);

  // Keyboard: "/" filters, "r" refreshes, Esc closes the details panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (typing && el === filterRef.current && filter) setFilter("");
        else setDrill(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
      } else if (e.key === "r") {
        void qc.invalidateQueries({ queryKey: ["repos"] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filter, qc]);
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

  if (isLoading && !data) return <div className="center-fill"><Spinner /> <span className="muted">Connecting to GitHub…</span></div>;
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
    ? [...categories, { id: UNCATEGORIZED, name: "Uncategorized", color: UNCATEGORIZED_COLOR, keywords: [] }]
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
            {progress ? (
              <span className="row gap">
                <span className="spinner" />
                {progress.phase === "list"
                  ? `Loading repositories… ${progress.done} of ${progress.total}`
                  : `Loading progress, CI and activity… ${progress.done} of ${progress.total}`}
              </span>
            ) : isFetching && data ? (
              <span className="row gap"><span className="spinner" /> Refreshing…</span>
            ) : (
              data && <>Synced {ago(data.fetchedAt)} · auto-refresh every {settings.pollMinutes} min · {data.rateLimit.remaining}/{data.rateLimit.limit} API points left</>
            )}
          </div>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={14} />
            <input ref={filterRef} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter repositories  ( / )" aria-label="Filter repositories" />
            {filter && <button className="icon-btn tiny" onClick={() => setFilter("")} aria-label="Clear filter"><Icon name="x" size={12} /></button>}
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
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["repos"] })} disabled={isFetching} title="Refresh now (R)">
            <Icon name="refresh" className={isFetching ? "spin" : ""} />
            <span className="hide-sm">Refresh</span>
          </button>
        </div>
      </header>

      {s && (
        <div className="stats">
          <Stat icon="folder" label="Repositories" value={s.repos} onClick={() => toggle("repos")} active={drill === "repos"} />
          <Stat icon="issue" label="Open issues" value={s.openIssues} sub={`${s.closedIssues} closed`} onClick={() => toggle("issues")} active={drill === "issues"} />
          <Stat icon="pr" label="Open PRs" value={s.openPRs} sub={s.openPRs ? "click to review" : undefined} onClick={() => toggle("prs")} active={drill === "prs"} />
          {pending ? (
            <>
              <Stat icon="clock" label="CI" value="…" sub="loading" />
              <Stat icon="activity" label="Commits · 30d" value="…" sub="loading" />
              <Stat icon="milestone" label="Avg progress" value="…" sub="loading" />
            </>
          ) : (
            <>
              <Stat icon={s.failingCI ? "x" : "check"} label="CI" value={s.failingCI ? `${s.failingCI} failing` : "All passing"} tone={s.failingCI ? "bad" : "ok"} sub={`✓ ${s.passingCI} passing`} onClick={() => toggle("ci")} active={drill === "ci"} />
              <Stat icon="activity" label="Commits · 30d" value={s.commits30} onClick={() => toggle("commits")} active={drill === "commits"} />
              <Stat icon="milestone" label="Avg progress" value={s.avgProgress != null ? `${s.avgProgress}%` : "—"} sub={`${s.releases30} releases this month`} onClick={() => toggle("progress")} active={drill === "progress"} />
            </>
          )}
        </div>
      )}

      {drill && data && (
        <Drilldown
          kind={drill}
          repos={repos}
          login={data.viewer?.login ?? ""}
          onClose={() => setDrill(null)}
          onFilter={(t) => { setFilter(t); setDrill(null); }}
        />
      )}

      {data && repos.length > 0 && !filter && <Insights repos={repos} fetchedAt={data.fetchedAt} scoped={!!category} pending={pending} />}

      {!category && s && !filter && !pending && (
        <div className="panels">
          <section className="card panel">
            <h3><Icon name="alert" size={14} /> Needs attention</h3>
            {s.attention.length ? (
              <ul className="feed">
                {s.attention.slice(0, 6).map((a, i) => (
                  <li key={i}>
                    <span className={`pill ${a.kind}`}>
                      <Icon name={a.kind === "ci" ? "x" : a.kind === "overdue" ? "clock" : "pr"} size={11} />
                      {a.kind === "ci" ? "Failing" : a.kind === "overdue" ? "Overdue" : "Review"}
                    </span>
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

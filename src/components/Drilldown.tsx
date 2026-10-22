import { useEffect, useMemo, useRef, useState } from "react";
import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { ago, commits30, isOverdue, shortDate } from "../lib/format";
import { useOpenItems } from "../lib/items";
import { href, navigate } from "../lib/router";
import { useApp } from "../lib/state";
import type { Repo } from "../lib/types";
import type { WorkItem } from "../lib/workitems";
import { CIBadge, ExtLink, Progress, Sparkline, Spinner } from "./bits";
import { Icon } from "./Icon";
import { ItemList } from "./ItemList";

export type DrillKind = "repos" | "issues" | "prs" | "ci" | "commits" | "progress";

const TITLES: Record<DrillKind, string> = {
  repos: "Repositories",
  issues: "Open issues",
  prs: "Open pull requests",
  ci: "CI status",
  commits: "Commits in the last 30 days",
  progress: "Milestones & releases",
};

/** Details for one dashboard stat, shown underneath the stat tiles. */
export function Drilldown({ kind, repos, login, onClose, onFilter }: {
  kind: DrillKind;
  repos: Repo[];
  login: string;
  onClose(): void;
  onFilter(text: string): void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [kind]);
  return (
    <section className="card panel drill" ref={ref} aria-label={TITLES[kind]}>
      <header className="row between">
        <h3>{TITLES[kind]}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)"><Icon name="x" size={14} /></button>
      </header>
      {kind === "issues" && <ItemsDrill kind="issue" repos={repos} login={login} />}
      {kind === "prs" && <ItemsDrill kind="pr" repos={repos} login={login} />}
      {kind === "ci" && <CIDrill repos={repos} />}
      {kind === "commits" && <CommitsDrill repos={repos} />}
      {kind === "progress" && <ProgressDrill repos={repos} />}
      {kind === "repos" && <ReposDrill repos={repos} onFilter={onFilter} />}
    </section>
  );
}

// ---------------------------------------------------------------- PRs / issues

type Filter = { id: string; label: string; test: (it: WorkItem, login: string) => boolean };
const PR_FILTERS: Filter[] = [
  { id: "all", label: "All", test: () => true },
  { id: "review", label: "Needs review", test: (it) => !it.isDraft && it.review !== "APPROVED" && it.review !== "CHANGES_REQUESTED" },
  { id: "approved", label: "Approved", test: (it) => it.review === "APPROVED" },
  { id: "changes", label: "Changes requested", test: (it) => it.review === "CHANGES_REQUESTED" },
  { id: "failing", label: "CI failing", test: (it) => it.checks === "FAILURE" || it.checks === "ERROR" },
  { id: "draft", label: "Drafts", test: (it) => !!it.isDraft },
  { id: "mine", label: "Mine", test: (it, me) => it.author.toLowerCase() === me.toLowerCase() },
];
const ISSUE_FILTERS: Filter[] = [
  { id: "all", label: "All", test: () => true },
  { id: "me", label: "Assigned to me", test: (it, me) => it.assignees.some((a) => a.toLowerCase() === me.toLowerCase()) },
  { id: "unassigned", label: "Unassigned", test: (it) => !it.assignees.length },
  { id: "bug", label: "Bugs", test: (it) => it.labels.some((l) => /bug/i.test(l.name)) },
  { id: "recent", label: "Updated this week", test: (it) => Date.now() - +new Date(it.updatedAt) < 7 * 864e5 },
];

function ItemsDrill({ kind, repos, login }: { kind: "pr" | "issue"; repos: Repo[]; login: string }) {
  const q = useOpenItems(kind, repos, true);
  const [f, setF] = useState("all");
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [f, text]);
  const filters = kind === "pr" ? PR_FILTERS : ISSUE_FILTERS;
  const all = q.data ?? [];
  const counts = useMemo(() => Object.fromEntries(filters.map((x) => [x.id, all.filter((it) => x.test(it, login)).length])), [all, filters, login]);
  const t = text.trim().toLowerCase();
  const shown = all.filter((it) => (filters.find((x) => x.id === f) ?? filters[0]).test(it, login))
    .filter((it) => !t || `${it.title} ${it.repo} ${it.author} ${it.labels.map((l) => l.name).join(" ")}`.toLowerCase().includes(t));
  const total = repos.reduce((a, r) => a + (kind === "pr" ? r.openPRs : r.openIssues), 0);

  if (!total) return <p className="muted small">{kind === "pr" ? "No open pull requests." : "No open issues."}</p>;
  if (q.isLoading) return <div className="row gap muted small"><Spinner /> Loading {kind === "pr" ? "pull requests" : "issues"} from {repos.filter((r) => (kind === "pr" ? r.openPRs : r.openIssues) > 0).length} repos…</div>;
  if (q.error) return <p className="error small">{(q.error as Error).message} <button className="link small" onClick={() => q.refetch()}>Retry</button></p>;
  return (
    <>
      <div className="drill-tools">
        <div className="chips">
          {filters.map((x) => (
            <button key={x.id} className={`chip button${f === x.id ? " on" : ""}`} onClick={() => setF(x.id)} disabled={!counts[x.id] && x.id !== "all"}>
              {x.label} <span className="count">{counts[x.id]}</span>
            </button>
          ))}
        </div>
        <div className="search-box small">
          <Icon name="search" size={13} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Filter ${kind === "pr" ? "pull requests" : "issues"}`} aria-label="Filter" />
        </div>
      </div>
      <ItemList items={shown.slice(0, limit)} empty={<p className="muted small">Nothing matches this filter.</p>} />
      {shown.length > limit && (
        <button className="btn small ghost mt-s" onClick={() => setLimit((l) => l + 50)}>Show {Math.min(50, shown.length - limit)} more of {shown.length - limit}</button>
      )}
      {all.length < total && (
        <p className="muted small mt-s">Showing the {all.length} most recently updated of {total}. Open a repository to see all of its {kind === "pr" ? "pull requests" : "issues"}.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- CI

function CIDrill({ repos }: { repos: Repo[] }) {
  const [showOk, setShowOk] = useState(false);
  const failing = repos.filter((r) => r.ci === "FAILURE" || r.ci === "ERROR");
  const running = repos.filter((r) => r.ci === "PENDING" || r.ci === "EXPECTED");
  const ok = repos.filter((r) => r.ci === "SUCCESS");
  const none = repos.length - failing.length - running.length - ok.length;
  const row = (r: Repo) => (
    <li key={r.id}>
      <CIBadge state={r.ci} failing={r.ciFailing} />
      <a className="grow min0" href={href.repo(r.nameWithOwner, "actions")}>
        <strong>{r.name}</strong>
        <span className="muted small truncate block">
          {r.ciFailing?.length ? r.ciFailing.join(" · ") : r.lastCommit?.message ?? ""}
        </span>
      </a>
      <span className="small muted when">{r.lastCommit ? ago(r.lastCommit.date) : ""}</span>
      <ExtLink className="icon-btn" url={`${r.url}/actions`} title="Open Actions on GitHub"><Icon name="external" size={13} /></ExtLink>
    </li>
  );
  return (
    <div className="drill-cols">
      <div>
        <h4 className="bad-c">Failing · {failing.length}</h4>
        {failing.length ? <ul className="drill-list">{failing.map(row)}</ul> : <p className="muted small">Nothing failing.</p>}
        {running.length > 0 && (
          <>
            <h4 className="warn-c mt">Running · {running.length}</h4>
            <ul className="drill-list">{running.map(row)}</ul>
          </>
        )}
      </div>
      <div>
        <h4 className="ok-c">
          <button className="link" onClick={() => setShowOk((v) => !v)} aria-expanded={showOk}>
            Passing · {ok.length} <Icon name="chevron" size={11} className={showOk ? "rot90" : ""} />
          </button>
        </h4>
        {showOk && <ul className="drill-list">{ok.map(row)}</ul>}
        {none > 0 && <p className="muted small mt-s">{none} {none === 1 ? "repo has" : "repos have"} no CI on its default branch.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- commits

function CommitsDrill({ repos }: { repos: Repo[] }) {
  const rows = repos.map((r) => ({ r, n: commits30(r) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((x) => x.n));
  if (!rows.length) return <p className="muted small">No commits in the last 30 days.</p>;
  return (
    <ul className="drill-list">
      {rows.slice(0, 20).map(({ r, n }) => (
        <li key={r.id}>
          <a className="grow min0" href={href.repo(r.nameWithOwner, "commits")}>
            <strong>{r.name}</strong>
            <span className="muted small truncate block">{r.lastCommit ? `${r.lastCommit.message} · ${ago(r.lastCommit.date)}` : ""}</span>
          </a>
          <Sparkline values={r.weekly} width={72} height={20} />
          <span className="bar-num"><span className="bar" style={{ width: `${(n / max) * 100}%` }} />{n}</span>
        </li>
      ))}
      {rows.length > 20 && <li className="muted small">+{rows.length - 20} more active repos</li>}
    </ul>
  );
}

// ---------------------------------------------------------------- milestones / releases

function ProgressDrill({ repos }: { repos: Repo[] }) {
  const ms = repos
    .flatMap((r) => r.milestones.map((m) => ({ r, m, overdue: isOverdue(m.dueOn) && m.open > 0 })))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.m.dueOn ?? "9999").localeCompare(b.m.dueOn ?? "9999"));
  const month = Date.now() - 30 * 864e5;
  const releases = repos
    .filter((r) => r.latestRelease && +new Date(r.latestRelease.publishedAt) > month)
    .sort((a, b) => +new Date(b.latestRelease!.publishedAt) - +new Date(a.latestRelease!.publishedAt));
  return (
    <div className="drill-cols">
      <div>
        <h4>Open milestones · {ms.length}</h4>
        {ms.length ? (
          <ul className="drill-list">
            {ms.map(({ r, m, overdue }) => (
              <li key={r.id + m.title} className="col">
                <a className="row between small" href={href.repo(r.nameWithOwner, "milestones")}>
                  <span className="truncate"><strong>{m.title}</strong> <span className="muted">{r.name}</span></span>
                  <span className={overdue ? "bad-c" : "muted"}>{m.dueOn ? `${overdue ? "overdue · " : "due "}${shortDate(m.dueOn)}` : "no due date"} · {m.progress}%</span>
                </a>
                <Progress pct={m.progress} thin />
                <span className="small muted">{m.open} open · {m.closed} closed</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No open milestones. Milestones drive the progress bars — create one on GitHub and it shows up on the next sync.</p>
        )}
      </div>
      <div>
        <h4>Released this month · {releases.length}</h4>
        {releases.length ? (
          <ul className="drill-list">
            {releases.map((r) => (
              <li key={r.id}>
                <Icon name="tag" size={13} />
                <ExtLink className="grow min0" url={r.latestRelease!.url}>
                  <strong>{r.name}</strong> <span className="muted">{r.latestRelease!.tag}</span>
                </ExtLink>
                <span className="small muted when">{ago(r.latestRelease!.publishedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No releases in the last 30 days.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- repositories

function ReposDrill({ repos, onFilter }: { repos: Repo[]; onFilter(text: string): void }) {
  const { categories, assignments } = useApp();
  const langs = useMemo(() => {
    const m = new Map<string, { n: number; color: string }>();
    for (const r of repos) {
      const k = r.language?.name ?? "Other";
      const e = m.get(k) ?? { n: 0, color: r.language?.color ?? UNCATEGORIZED_COLOR };
      e.n++;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [repos]);
  const stale = repos.filter((r) => r.pushedAt && Date.now() - +new Date(r.pushedAt) > 180 * 864e5);
  const facts = [
    { label: "Private", n: repos.filter((r) => r.isPrivate).length },
    { label: "Public", n: repos.filter((r) => !r.isPrivate).length },
    { label: "Tracked from others", n: repos.filter((r) => r.tracked).length },
    { label: "Uncategorized", n: repos.filter((r) => categoryOf(r, categories, assignments).id === UNCATEGORIZED).length },
  ];
  return (
    <div className="drill-cols">
      <div>
        <h4>By language</h4>
        <ul className="drill-list">
          {langs.map(([name, { n, color }]) => (
            <li key={name}>
              <button className="link row gap grow" onClick={() => onFilter(name === "Other" ? "" : name)} title={`Show only ${name} repositories`}>
                <span className="dot" style={{ background: color }} />{name}
              </button>
              <span className="bar-num"><span className="bar" style={{ width: `${(n / repos.length) * 100}%`, background: color }} />{n}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Overview</h4>
        <ul className="kv">{facts.map((f) => <li key={f.label}><span>{f.label}</span><span>{f.n}</span></li>)}</ul>
        {stale.length > 0 && <h4 className="mt">Quiet for 6+ months · {stale.length}</h4>}
        <ul className="drill-list">
          {stale.slice(0, 8).map((r) => (
            <li key={r.id}>
              <a className="grow min0" onClick={(e) => { e.preventDefault(); navigate(href.repo(r.nameWithOwner)); }} href={href.repo(r.nameWithOwner)}>
                <strong>{r.name}</strong>
              </a>
              <span className="small muted when">{ago(r.pushedAt)}</span>
            </li>
          ))}
          {stale.length > 8 && <li className="muted small">+{stale.length - 8} more</li>}
        </ul>
      </div>
    </div>
  );
}

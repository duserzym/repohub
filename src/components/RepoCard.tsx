import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { ago, commits30, num, repoProgress } from "../lib/format";
import { useState } from "react";
import { useOpenItems } from "../lib/items";
import { href, navigate } from "../lib/router";
import { useApp } from "../lib/state";
import type { Repo } from "../lib/types";
import { CIBadge, ExtLink, Progress, RepoIcon, Sparkline, Spinner } from "./bits";
import { ItemList } from "./ItemList";
import { Icon } from "./Icon";

export function CategorySelect({ repo }: { repo: Repo }) {
  const { categories, assignments, update } = useApp();
  const cur = categoryOf(repo, categories, assignments);
  return (
    <select
      className="cat-select"
      value={assignments[repo.nameWithOwner] ? cur.id : ""}
      onChange={(e) => {
        const v = e.target.value;
        update("assignments", (a) => {
          const n = { ...a };
          if (v) n[repo.nameWithOwner] = v;
          else delete n[repo.nameWithOwner];
          return n;
        });
      }}
      aria-label="Category"
      title={cur.auto ? "Auto-assigned from keywords — pick to override" : "Category"}
    >
      <option value="">
        Auto{cur.auto ? ` (${categories.find((c) => c.id === cur.id)?.name ?? "Uncategorized"})` : ""}
      </option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={UNCATEGORIZED}>Uncategorized</option>
    </select>
  );
}

type Peek = "issues" | "prs" | "ci";

/** A quick look at a card's open issues / PRs / CI, underneath the metrics. */
function CardPeek({ repo, kind }: { repo: Repo; kind: Peek }) {
  const q = useOpenItems(kind === "prs" ? "pr" : "issue", [repo], kind !== "ci", 5);
  const tab = kind === "prs" ? "pulls" : kind === "issues" ? "issues" : "actions";
  const total = kind === "prs" ? repo.openPRs : repo.openIssues;
  return (
    <div className="peek" onClick={(e) => e.stopPropagation()}>
      {kind === "ci" ? (
        <div className="small">
          {repo.ciFailing?.length ? (
            <>
              <div className="bad-c strong">Failing checks</div>
              <ul className="peek-list">{repo.ciFailing.map((f) => <li key={f}><Icon name="x" size={11} className="bad-c" /> {f}</li>)}</ul>
            </>
          ) : (
            <div className="muted">{repo.ci === "SUCCESS" ? "All checks passed" : repo.ci === "PENDING" || repo.ci === "EXPECTED" ? "Checks are running" : "No checks on the latest commit"}{repo.lastCommit ? ` on “${repo.lastCommit.message}”` : ""}.</div>
          )}
          <div className="row gap mt-s">
            <a className="btn small" href={href.repo(repo.nameWithOwner, "actions")}>Workflow runs</a>
            <ExtLink className="btn small ghost" url={`${repo.url}/actions`}><Icon name="external" size={12} /> Actions on GitHub</ExtLink>
          </div>
        </div>
      ) : q.isLoading ? (
        <div className="row gap small muted"><Spinner /> Loading…</div>
      ) : q.error ? (
        <p className="error small">{(q.error as Error).message}</p>
      ) : (
        <>
          <ItemList items={q.data ?? []} showRepo={false} compact />
          {total > (q.data?.length ?? 0) && (
            <a className="link small" href={href.repo(repo.nameWithOwner, tab)}>All {total} {kind === "prs" ? "pull requests" : "issues"} →</a>
          )}
        </>
      )}
    </div>
  );
}

export function RepoCard({ repo }: { repo: Repo }) {
  const { categories, assignments, pinned, update } = useApp();
  const cat = categories.find((c) => c.id === categoryOf(repo, categories, assignments).id);
  const prog = repoProgress(repo);
  const isPinned = pinned.includes(repo.nameWithOwner);
  const [peek, setPeek] = useState<Peek | null>(null);
  const toggle = (k: Peek) => setPeek((p) => (p === k ? null : k));

  return (
    <div
      className={`card repo-card${peek ? " peeking" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={repo.nameWithOwner}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("select,button,a,.peek")) navigate(href.repo(repo.nameWithOwner));
      }}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(href.repo(repo.nameWithOwner))}
      style={{ ["--cat" as string]: cat?.color ?? UNCATEGORIZED_COLOR }}
    >
      <div className="repo-head">
        <RepoIcon repo={repo} size={40} />
        <div className="repo-title">
          <div className="repo-name">
            {repo.name}
            {repo.isPrivate && <Icon name="lock" size={12} className="muted" />}
            {repo.tracked && <span className="chip tiny">tracked</span>}
          </div>
          <div className="repo-owner">{repo.owner}</div>
        </div>
        <button
          className={`icon-btn pin${isPinned ? " on" : ""}`}
          title={isPinned ? "Unpin" : "Pin to top"}
          aria-label={isPinned ? "Unpin" : "Pin"}
          onClick={() => {
            update("pinned", (p) => (isPinned ? p.filter((x) => x !== repo.nameWithOwner) : [...p, repo.nameWithOwner]));
          }}
        >
          <Icon name="pin" size={14} />
        </button>
      </div>

      <p className="repo-desc">{repo.description || <span className="muted">No description</span>}</p>

      <div className="repo-progress">
        {repo.enriched === false ? (
          <>
            <div className="small muted">Loading progress…</div>
            <div className="progress shimmer" />
          </>
        ) : prog ? (
          <>
            <div className="row between small">
              <span className="truncate">{prog.label}</span>
              <strong>{prog.pct}%</strong>
            </div>
            <Progress pct={prog.pct} color={cat?.color} />
          </>
        ) : (
          <div className="small muted">No milestones or issues yet</div>
        )}
      </div>

      <div className="repo-metrics">
        <button type="button" className={`metric${peek === "issues" ? " on" : ""}`} title="Open issues — click to peek" aria-expanded={peek === "issues"} onClick={() => toggle("issues")} disabled={!repo.openIssues}>
          <Icon name="issue" size={13} /> {repo.openIssues}
        </button>
        <button type="button" className={`metric${peek === "prs" ? " on" : ""}`} title="Open pull requests — click to peek" aria-expanded={peek === "prs"} onClick={() => toggle("prs")} disabled={!repo.openPRs}>
          <Icon name="pr" size={13} /> {repo.openPRs}
        </button>
        <span title="Stars">
          <Icon name="star" size={13} /> {num(repo.stars)}
        </span>
        <button type="button" className={`metric${peek === "ci" ? " on" : ""}`} title="CI — click for details" aria-expanded={peek === "ci"} onClick={() => toggle("ci")} disabled={!repo.ci}>
          <CIBadge state={repo.ci} failing={repo.ciFailing} />
        </button>
        <span className="grow" />
        <span title={`${commits30(repo)} commits in the last 4 weeks`}>
          <Sparkline values={repo.weekly} width={64} height={20} />
        </span>
      </div>

      {peek && <CardPeek repo={repo} kind={peek} />}

      <div className="repo-foot">
        {repo.language && (
          <span className="lang">
            <i style={{ background: repo.language.color }} />
            {repo.language.name}
          </span>
        )}
        <span className="muted">{ago(repo.pushedAt)}</span>
        <span className="grow" />
        <CategorySelect repo={repo} />
      </div>
    </div>
  );
}

const go = (nwo: string, tab: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  navigate(href.repo(nwo, tab));
};

export function RepoRow({ repo }: { repo: Repo }) {
  const { categories, assignments } = useApp();
  const cat = categories.find((c) => c.id === categoryOf(repo, categories, assignments).id);
  const prog = repoProgress(repo);
  return (
    <a className="repo-row" href={href.repo(repo.nameWithOwner)}>
      <RepoIcon repo={repo} size={28} />
      <div className="repo-row-name">
        <strong>{repo.name}</strong>
        <span className="muted small truncate">{repo.description}</span>
      </div>
      <span className="cat-dot" style={{ background: cat?.color ?? UNCATEGORIZED_COLOR }} title={cat?.name ?? "Uncategorized"} />
      <div className="repo-row-prog">{prog ? <Progress pct={prog.pct} color={cat?.color} thin /> : <span className="muted small">—</span>}</div>
      <span className="num link-ish" title="Open issues" onClick={go(repo.nameWithOwner, "issues")}>
        <Icon name="issue" size={13} /> {repo.openIssues}
      </span>
      <span className="num link-ish" title="Open PRs" onClick={go(repo.nameWithOwner, "pulls")}>
        <Icon name="pr" size={13} /> {repo.openPRs}
      </span>
      <span className="link-ish" onClick={go(repo.nameWithOwner, "actions")}><CIBadge state={repo.ci} failing={repo.ciFailing} /></span>
      <Sparkline values={repo.weekly} width={56} height={18} />
      <span className="muted small when">{ago(repo.pushedAt)}</span>
    </a>
  );
}

import { CIBadge, Empty, Label, Progress, RepoIcon, Sparkline, Spinner, Stat } from "../components/bits";
import { Icon, type IconName } from "../components/Icon";
import { CategorySelect } from "../components/RepoCard";
import { ago, commits30, isOverdue, num, repoProgress, shortDate } from "../lib/format";
import { openUrl } from "../lib/platform";
import { useRepoDetail } from "../lib/queries";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import { useState } from "react";

function IconEditor({ nwo, current, onSave }: { nwo: string; current: string; onSave(url: string): void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current);
  if (!open) return <button className="link small" onClick={() => setOpen(true)}>Change icon</button>;
  return (
    <form className="row gap" onSubmit={(e) => { e.preventDefault(); onSave(val.trim()); setOpen(false); }}>
      <input className="input small" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Image URL (empty = auto)" aria-label={`Icon URL for ${nwo}`} />
      <button className="btn small" type="submit">Save</button>
    </form>
  );
}

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "issues", label: "Issues", icon: "issue" },
  { id: "pulls", label: "Pull requests", icon: "pr" },
  { id: "milestones", label: "Milestones", icon: "milestone" },
  { id: "commits", label: "Commits", icon: "commit" },
  { id: "actions", label: "Actions", icon: "play" },
  { id: "releases", label: "Releases", icon: "tag" },
];

function Ext({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={url}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(url);
      }}
    >
      {children}
    </a>
  );
}

export function RepoDetail({ nameWithOwner, tab }: { nameWithOwner: string; tab: string }) {
  const { tracked, update, iconOverrides } = useApp();
  const { repo, data: d, isLoading, error, loadingList } = useRepoDetail(nameWithOwner);

  if (loadingList) return <div className="center-fill"><Spinner /></div>;
  if (!repo)
    return (
      <Empty icon="folder" title="Repository not in your dashboard">
        <a className="btn" href={href.home()}>Back to dashboard</a>
      </Empty>
    );

  const prog = repoProgress(repo);
  const counts: Record<string, number | undefined> = {
    issues: repo.openIssues,
    pulls: repo.openPRs,
    milestones: d?.milestones.length,
    commits: d?.totalCommits,
    actions: d?.runs.length,
    releases: d?.releases.length,
  };

  return (
    <div className="page">
      <a className="back small" href={href.home()}>
        <Icon name="back" size={14} /> Dashboard
      </a>
      <header className="detail-head">
        <RepoIcon repo={repo} size={64} />
        <div className="grow">
          <h1 className="row gap wrap">
            {repo.name}
            {repo.isPrivate && <span className="chip"><Icon name="lock" size={12} /> private</span>}
            {repo.isArchived && <span className="chip">archived</span>}
            <CIBadge state={repo.ci} label failing={repo.ciFailing} />
          </h1>
          <div className="muted">{repo.owner}</div>
          <p>{repo.description}</p>
          <div className="row gap wrap">
            {repo.topics.map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
        </div>
        <div className="detail-actions">
          <CategorySelect repo={repo} />
          <Ext className="btn" url={repo.url}><Icon name="github" /> Open on GitHub</Ext>
          {repo.homepageUrl && <Ext className="btn ghost" url={repo.homepageUrl}><Icon name="external" /> Website</Ext>}
          {repo.tracked && (
            <button className="btn ghost" onClick={() => update("tracked", tracked.filter((t) => t.toLowerCase() !== repo.nameWithOwner.toLowerCase()))}>
              Stop tracking
            </button>
          )}
          <IconEditor nwo={repo.nameWithOwner} current={iconOverrides[repo.nameWithOwner] ?? ""} onSave={(url) =>
            update("iconOverrides", (o) => {
              const n = { ...o };
              if (url) n[repo.nameWithOwner] = url;
              else delete n[repo.nameWithOwner];
              return n;
            })
          } />
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <a key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} href={href.repo(nameWithOwner, t.id)}>
            <Icon name={t.icon} size={14} /> {t.label}
            {counts[t.id] != null && <span className="count">{num(counts[t.id]!)}</span>}
          </a>
        ))}
      </nav>

      {error && <p className="error">{(error as Error).message}</p>}

      {tab === "overview" && (
        <div className="detail-grid">
          <div className="stats">
            <Stat icon="issue" label="Open issues" value={repo.openIssues} sub={`${repo.closedIssues} closed`} />
            <Stat icon="pr" label="Open PRs" value={repo.openPRs} sub={`${repo.mergedPRs} merged`} />
            <Stat icon="activity" label="Commits · 30d" value={commits30(repo)} sub={d ? `${num(d.totalCommits)} total` : undefined} />
            <Stat icon="star" label="Stars" value={num(repo.stars)} sub={`${repo.forks} forks`} />
          </div>
          <section className="card panel">
            <h3>Progress</h3>
            {prog ? (
              <>
                <div className="row between small"><span>{prog.label}</span><strong>{prog.pct}%</strong></div>
                <Progress pct={prog.pct} />
              </>
            ) : <p className="muted small">Add a milestone or issues on GitHub to track progress.</p>}
            {repo.openIssues + repo.closedIssues > 0 && (
              <>
                <div className="row between small mt">
                  <span>Issues closed</span>
                  <span>{repo.closedIssues}/{repo.openIssues + repo.closedIssues}</span>
                </div>
                <Progress pct={(repo.closedIssues / (repo.openIssues + repo.closedIssues)) * 100} thin />
              </>
            )}
            <h3 className="mt">Weekly commits (12 weeks)</h3>
            <Sparkline values={repo.weekly} width={280} height={48} />
          </section>
          <section className="card panel">
            <h3>Latest</h3>
            <ul className="kv">
              <li><span>Last push</span><span>{ago(repo.pushedAt)}</span></li>
              <li><span>Last commit</span><span className="truncate">{repo.lastCommit?.message ?? "—"}</span></li>
              <li><span>Release</span><span>{repo.latestRelease ? <Ext url={repo.latestRelease.url}>{repo.latestRelease.tag} · {ago(repo.latestRelease.publishedAt)}</Ext> : "—"}</span></li>
              <li><span>Branch</span><span>{repo.defaultBranch ?? "—"}</span></li>
              <li><span>Created</span><span>{shortDate(repo.createdAt)}</span></li>
            </ul>
            {d && d.languages.length > 0 && (
              <>
                <h3 className="mt">Languages</h3>
                <div className="langbar">
                  {d.languages.map((l) => (
                    <i key={l.name} title={l.name} style={{ flex: l.size, background: l.color }} />
                  ))}
                </div>
                <div className="row gap wrap small mt-s">
                  {d.languages.map((l) => (
                    <span key={l.name} className="lang"><i style={{ background: l.color }} />{l.name}</span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {tab !== "overview" && isLoading && <div className="center-fill"><Spinner /></div>}

      {d && tab === "issues" && (
        d.issues.length ? (
          <ul className="card list items">
            {d.issues.map((i) => (
              <li key={i.number}>
                <Icon name="issue" className="ok-c" />
                <div className="grow">
                  <Ext url={i.url}><strong>{i.title}</strong></Ext>{" "}
                  {i.labels.map((l) => <Label key={l.name} {...l} />)}
                  <div className="small muted">#{i.number} opened {ago(i.createdAt)} by {i.author}{i.assignees.length ? ` · assigned ${i.assignees.join(", ")}` : ""}</div>
                </div>
                {i.comments > 0 && <span className="small muted row gap-s">{i.comments} comments</span>}
              </li>
            ))}
          </ul>
        ) : <Empty icon="check" title="No open issues" />
      )}

      {d && tab === "pulls" && (
        d.pulls.length ? (
          <ul className="card list items">
            {d.pulls.map((p) => (
              <li key={p.number}>
                <Icon name="pr" className={p.isDraft ? "muted" : "ok-c"} />
                <div className="grow">
                  <Ext url={p.url}><strong>{p.title}</strong></Ext> {p.isDraft && <span className="chip tiny">draft</span>}
                  <div className="small muted">
                    #{p.number} by {p.author} · {ago(p.createdAt)} · <span className="add">+{p.additions}</span> <span className="del">−{p.deletions}</span>
                    {p.review && ` · ${p.review.replace(/_/g, " ").toLowerCase()}`}
                  </div>
                </div>
                <CIBadge state={p.checks} />
              </li>
            ))}
          </ul>
        ) : <Empty icon="pr" title="No open pull requests" />
      )}

      {d && tab === "milestones" && (
        d.milestones.length ? (
          <div className="card list items">
            {d.milestones.map((m) => (
              <div key={m.title} className="milestone">
                <div className="row between">
                  <Ext url={m.url}><strong>{m.title}</strong></Ext>
                  <span className={`small ${m.state === "OPEN" && isOverdue(m.dueOn) ? "bad-c" : "muted"}`}>
                    {m.state === "CLOSED" ? "closed" : m.dueOn ? `due ${shortDate(m.dueOn)}` : "no due date"}
                  </span>
                </div>
                {m.description && <p className="small muted">{m.description}</p>}
                <Progress pct={m.progress} />
                <div className="small muted">{m.progress}% · {m.open} open · {m.closed} closed</div>
              </div>
            ))}
          </div>
        ) : <Empty icon="milestone" title="No milestones">
          <p className="muted small">Milestones drive the progress bars. Create one on GitHub and it shows up here on the next sync.</p>
        </Empty>
      )}

      {d && tab === "commits" && (
        <ul className="card list items">
          {d.commits.map((c) => (
            <li key={c.oid}>
              {c.avatar ? <img className="avatar" src={c.avatar} alt="" /> : <Icon name="commit" />}
              <div className="grow">
                <Ext url={c.url}><strong>{c.message}</strong></Ext>
                <div className="small muted">{c.author} · {ago(c.date)} · <code>{c.oid.slice(0, 7)}</code></div>
              </div>
              <CIBadge state={c.checks} />
            </li>
          ))}
        </ul>
      )}

      {d && tab === "actions" && (
        d.runs.length ? (
          <ul className="card list items">
            {d.runs.map((r) => (
              <li key={r.id}>
                <CIBadge state={r.status !== "completed" ? "PENDING" : r.conclusion === "success" ? "SUCCESS" : r.conclusion === "skipped" || r.conclusion === "cancelled" ? null : "FAILURE"} />
                <div className="grow">
                  <Ext url={r.url}><strong>{r.title}</strong></Ext>
                  <div className="small muted">{r.name} · {r.branch} · {r.event} · {ago(r.createdAt)}{r.conclusion ? ` · ${r.conclusion}` : ` · ${r.status}`}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon="play" title="No workflow runs" />
      )}

      {d && tab === "releases" && (
        d.releases.length ? (
          <ul className="card list items">
            {d.releases.map((r) => (
              <li key={r.tag}>
                <Icon name="tag" />
                <div className="grow">
                  <Ext url={r.url}><strong>{r.name}</strong></Ext> {r.isLatest && <span className="chip tiny ok">latest</span>} {r.isPrerelease && <span className="chip tiny">pre-release</span>}
                  <div className="small muted">{r.tag} · {r.publishedAt ? shortDate(r.publishedAt) : "draft"}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon="tag" title="No releases yet" />
      )}
    </div>
  );
}

import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { ago, commits30, num, repoProgress } from "../lib/format";
import { href, navigate } from "../lib/router";
import { useApp } from "../lib/state";
import type { Repo } from "../lib/types";
import { CIBadge, Progress, RepoIcon, Sparkline } from "./bits";
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

export function RepoCard({ repo }: { repo: Repo }) {
  const { categories, assignments, pinned, update } = useApp();
  const cat = categories.find((c) => c.id === categoryOf(repo, categories, assignments).id);
  const prog = repoProgress(repo);
  const isPinned = pinned.includes(repo.nameWithOwner);

  return (
    <div
      className="card repo-card"
      role="link"
      tabIndex={0}
      aria-label={repo.nameWithOwner}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("select,button,a")) navigate(href.repo(repo.nameWithOwner));
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
        <span title="Open issues">
          <Icon name="issue" size={13} /> {repo.openIssues}
        </span>
        <span title="Open pull requests">
          <Icon name="pr" size={13} /> {repo.openPRs}
        </span>
        <span title="Stars">
          <Icon name="star" size={13} /> {num(repo.stars)}
        </span>
        <CIBadge state={repo.ci} />
        <span className="grow" />
        <span title={`${commits30(repo)} commits in the last 4 weeks`}>
          <Sparkline values={repo.weekly} width={64} height={20} />
        </span>
      </div>

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
      <span className="num" title="Open issues">
        <Icon name="issue" size={13} /> {repo.openIssues}
      </span>
      <span className="num" title="Open PRs">
        <Icon name="pr" size={13} /> {repo.openPRs}
      </span>
      <CIBadge state={repo.ci} />
      <Sparkline values={repo.weekly} width={56} height={18} />
      <span className="muted small when">{ago(repo.pushedAt)}</span>
    </a>
  );
}

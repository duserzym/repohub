import { useState, type ReactNode } from "react";
import { ago } from "../lib/format";
import { href } from "../lib/router";
import type { WorkItem } from "../lib/workitems";
import { CIBadge, ExtLink, Label } from "./bits";
import { Icon } from "./Icon";

const REVIEW: Record<string, { label: string; cls: string; icon: "check" | "x" | "clock" }> = {
  APPROVED: { label: "Approved", cls: "ok", icon: "check" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "bad", icon: "x" },
  REVIEW_REQUIRED: { label: "Review required", cls: "warn", icon: "clock" },
};

/** Open pull requests / issues; click a row to see its details underneath. */
export function ItemList({ items, showRepo = true, compact = false, empty }: { items: WorkItem[]; showRepo?: boolean; compact?: boolean; empty?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return <>{empty ?? <p className="muted small">Nothing open.</p>}</>;
  return (
    <ul className={`items-x${compact ? " compact" : ""}`}>
      {items.map((it) => {
        const key = `${it.repo}#${it.number}`;
        const isOpen = open === key;
        const review = it.review ? REVIEW[it.review] : null;
        return (
          <li key={key} className={isOpen ? "open" : ""}>
            <button type="button" className="item-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
              <Icon name={it.kind === "pr" ? "pr" : "issue"} size={14} className={it.isDraft ? "muted" : "ok-c"} />
              <span className="item-main">
                <span className="item-title">
                  {it.title} <span className="muted">#{it.number}</span>
                  {it.isDraft && <span className="chip tiny">draft</span>}
                  {!compact && it.labels.slice(0, 3).map((l) => <Label key={l.name} {...l} />)}
                </span>
                <span className="item-meta small muted">
                  {showRepo && <strong className="fg2">{it.repo.split("/")[1]}</strong>}
                  <span>{it.author}</span>
                  <span>updated {ago(it.updatedAt)}</span>
                  {it.comments > 0 && <span className="row gap-s"><Icon name="comment" size={11} /> {it.comments}</span>}
                </span>
              </span>
              {review && !compact && (
                <span className={`review ${review.cls}`} title={review.label}>
                  <Icon name={review.icon} size={11} /> <span className="hide-sm">{review.label}</span>
                </span>
              )}
              {it.kind === "pr" && <CIBadge state={it.checks ?? null} />}
              <Icon name="chevron" size={13} className="item-chevron" />
            </button>
            {isOpen && (
              <div className="item-body">
                {it.body ? <p className="item-text">{it.body}</p> : <p className="muted small">No description.</p>}
                <div className="item-facts small">
                  <span>Opened {ago(it.createdAt)} by <b>{it.author}</b></span>
                  {it.assignees.length > 0 && <span>Assigned to <b>{it.assignees.join(", ")}</b></span>}
                  {it.kind === "pr" && (
                    <span>
                      <span className="add">+{it.additions}</span> <span className="del">−{it.deletions}</span>
                    </span>
                  )}
                  {review && <span className={`${review.cls}-c`}>{review.label}</span>}
                  {compact && it.labels.length > 0 && <span>{it.labels.map((l) => <Label key={l.name} {...l} />)}</span>}
                </div>
                <div className="row gap wrap">
                  <ExtLink className="btn small primary" url={it.url}><Icon name="github" size={13} /> Open on GitHub</ExtLink>
                  {showRepo && (
                    <a className="btn small ghost" href={href.repo(it.repo, it.kind === "pr" ? "pulls" : "issues")} onClick={(e) => e.stopPropagation()}>
                      All {it.kind === "pr" ? "pull requests" : "issues"} in {it.repo.split("/")[1]}
                    </a>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

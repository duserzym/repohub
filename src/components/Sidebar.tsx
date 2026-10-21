import { useState } from "react";
import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { useRepos } from "../lib/queries";
import { href, type Route } from "../lib/router";
import { useApp } from "../lib/state";
import { CategoryManager } from "./CategoryManager";
import { Icon } from "./Icon";
import { ThemeQuickMenu } from "./ThemePicker";
import { UpdateBanner, UpdateCheckLink } from "./UpdateBanner";

export function Sidebar({ route, open, onClose }: { route: Route; open: boolean; onClose(): void }) {
  const { categories, assignments, demo } = useApp();
  const { data } = useRepos();
  const [editing, setEditing] = useState(false);

  const counts = new Map<string, number>();
  for (const r of data?.repos ?? []) {
    const id = categoryOf(r, categories, assignments).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const activeCat = route.view === "dashboard" ? route.category : null;
  const is = (v: Route["view"]) => route.view === v;

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={onClose} />
      <nav className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && onClose()}>
        <div className="brand">
          <img src="/icon.svg" alt="" width={26} height={26} />
          <span>RepoHub</span>
          {demo && <span className="chip tiny">demo</span>}
        </div>

        <a className={`nav${is("dashboard") && !activeCat ? " active" : ""}`} href={href.home()}>
          <Icon name="home" /> Dashboard
          <span className="count">{data?.repos.length ?? ""}</span>
        </a>
        <a className={`nav${is("discover") ? " active" : ""}`} href={href.discover()}>
          <Icon name="search" /> Discover
        </a>
        <a className={`nav${is("ideas") ? " active" : ""}`} href={href.ideas()}>
          <Icon name="bulb" /> Idea Pad
        </a>
        <a className={`nav${is("teams") ? " active" : ""}`} href={href.teams()}>
          <Icon name="users" /> Teams
        </a>

        <div className="nav-section">
          <span>Categories</span>
          <button className="icon-btn" onClick={() => setEditing(true)} title="Edit categories" aria-label="Edit categories">
            <Icon name="edit" size={14} />
          </button>
        </div>
        {categories.map((c) => (
          <a key={c.id} className={`nav${activeCat === c.id ? " active" : ""}`} href={href.category(c.id)}>
            <span className="dot" style={{ background: c.color }} />
            {c.name}
            <span className="count">{counts.get(c.id) ?? 0}</span>
          </a>
        ))}
        <a className={`nav${activeCat === UNCATEGORIZED ? " active" : ""}`} href={href.category(UNCATEGORIZED)}>
          <span className="dot" style={{ background: UNCATEGORIZED_COLOR }} />
          Uncategorized
          <span className="count">{counts.get(UNCATEGORIZED) ?? 0}</span>
        </a>

        <div className="grow" />
        <UpdateBanner />
        <ThemeQuickMenu />
        <a className={`nav${is("settings") ? " active" : ""}`} href={href.settings()}>
          <Icon name="settings" /> Settings
        </a>
        <UpdateCheckLink />
        {data?.viewer && (
          <div className="me">
            {data.viewer.avatarUrl ? <img src={data.viewer.avatarUrl} alt="" /> : <span className="avatar-fallback">{data.viewer.login[0]}</span>}
            <div>
              <div className="small strong">{data.viewer.name ?? data.viewer.login}</div>
              <div className="small muted">@{data.viewer.login}</div>
            </div>
          </div>
        )}
      </nav>
      {editing && <CategoryManager onClose={() => setEditing(false)} />}
    </>
  );
}

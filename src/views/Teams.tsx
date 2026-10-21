import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, Spinner } from "../components/bits";
import { Icon } from "../components/Icon";
import { fetchOrgTeams } from "../lib/github";
import { openUrl } from "../lib/platform";
import { useApp } from "../lib/state";
import type { Team, TeamMember } from "../lib/types";

// Team management groundwork: local teams (name, members + roles, categories)
// and a read-only view of the user's GitHub organisations and teams.
// Planned: sync local teams with GitHub org teams and share dashboards.

export function Teams() {
  const { token, demo, teams, categories, update } = useApp();
  const orgs = useQuery({ queryKey: ["orgs", token], enabled: !!token && !demo, queryFn: () => fetchOrgTeams(token!), staleTime: 10 * 60_000 });
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    update("teams", (t) => [...t, { id: `team-${Date.now()}`, name: name.trim(), members: [], categoryIds: [], repoIds: [] }]);
    setName("");
  };
  const patch = (id: string, p: Partial<Team>) => update("teams", (t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Teams</h1>
          <div className="muted small">Group people and categories. Sharing and GitHub team sync are coming next.</div>
        </div>
      </header>

      <section className="section">
        <h2 className="section-title">Local teams</h2>
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name, e.g. Isotope Lab" />
          <button className="btn primary" type="submit"><Icon name="plus" /> Create team</button>
        </form>
        <div className="grid mt">
          {teams.map((t) => <TeamCard key={t.id} team={t} categories={categories} onChange={(p) => patch(t.id, p)} onDelete={() => update("teams", (all) => all.filter((x) => x.id !== t.id))} />)}
        </div>
        {!teams.length && <p className="muted small">No teams yet.</p>}
      </section>

      <section className="section">
        <h2 className="section-title">GitHub organizations</h2>
        {demo || !token ? <p className="muted small">Sign in to see your organizations and their teams.</p>
          : orgs.isLoading ? <Spinner />
          : orgs.error ? <p className="error">{(orgs.error as Error).message}</p>
          : orgs.data?.length ? (
            <div className="grid">
              {orgs.data.map((o) => (
                <div key={o.login} className="card panel">
                  <h3 className="row gap"><img className="avatar" src={o.avatarUrl} alt="" /> {o.login}</h3>
                  {o.teams.length ? (
                    <ul className="kv">
                      {o.teams.map((t) => (
                        <li key={t.slug}>
                          <a href={t.url} onClick={(e) => { e.preventDefault(); void openUrl(t.url); }}>{t.name}</a>
                          <span className="muted">{t.members} members · {t.repos} repos</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted small">No teams visible (needs read:org).</p>}
                </div>
              ))}
            </div>
          ) : <Empty icon="users" title="No organizations" />}
      </section>
    </div>
  );
}

function TeamCard({ team, categories, onChange, onDelete }: {
  team: Team; categories: { id: string; name: string; color: string }[]; onChange(p: Partial<Team>): void; onDelete(): void;
}) {
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<TeamMember["role"]>("member");
  return (
    <div className="card panel">
      <div className="row between">
        <h3>{team.name}</h3>
        <button className="icon-btn danger" onClick={onDelete} aria-label="Delete team"><Icon name="trash" /></button>
      </div>
      <ul className="kv">
        {team.members.map((m) => (
          <li key={m.login}>
            <span>@{m.login}</span>
            <span className="row gap-s">
              <span className="chip tiny">{m.role}</span>
              <button className="icon-btn" aria-label="Remove" onClick={() => onChange({ members: team.members.filter((x) => x.login !== m.login) })}><Icon name="x" size={12} /></button>
            </span>
          </li>
        ))}
      </ul>
      <form className="row gap mt-s" onSubmit={(e) => {
        e.preventDefault();
        const l = login.trim().replace(/^@/, "");
        if (l && !team.members.some((m) => m.login === l)) onChange({ members: [...team.members, { login: l, role }] });
        setLogin("");
      }}>
        <input className="input small grow" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="GitHub username" />
        <select className="input small" value={role} onChange={(e) => setRole(e.target.value as TeamMember["role"])}>
          <option value="owner">owner</option><option value="maintainer">maintainer</option><option value="member">member</option><option value="viewer">viewer</option>
        </select>
        <button className="btn small" type="submit">Add</button>
      </form>
      <div className="row gap wrap mt-s">
        {categories.map((c) => {
          const on = team.categoryIds.includes(c.id);
          return (
            <button key={c.id} className={`chip button${on ? " on" : ""}`} onClick={() => onChange({ categoryIds: on ? team.categoryIds.filter((x) => x !== c.id) : [...team.categoryIds, c.id] })}>
              <span className="dot" style={{ background: c.color }} /> {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

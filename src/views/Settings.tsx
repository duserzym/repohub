import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { clearIconMemory } from "../lib/icons";
import { isTauri } from "../lib/platform";
import { useRepos } from "../lib/queries";
import { DEFAULT_SETTINGS, useApp } from "../lib/state";
import { menuBarTitle } from "../lib/summary";
import type { MenuBarStat, Settings as S } from "../lib/types";

const STATS: { id: MenuBarStat; label: string }[] = [
  { id: "issues", label: "Open issues (⊙)" },
  { id: "prs", label: "Open PRs (⑂)" },
  { id: "ci", label: "CI status (✓ / ✕)" },
  { id: "commits", label: "Commits, 30 days (↑)" },
  { id: "progress", label: "Average progress (%)" },
];

export function Settings() {
  const { settings, update, setToken, demo, setDemo, token } = useApp();
  const { summary, data } = useRepos();
  const qc = useQueryClient();
  const set = (p: Partial<S>) => update("settings", (s) => ({ ...s, ...p }));
  const toggleAff = (a: S["affiliations"][number]) =>
    set({ affiliations: settings.affiliations.includes(a) ? settings.affiliations.filter((x) => x !== a) : [...settings.affiliations, a] });

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>

      <section className="card panel form">
        <h3>Sync</h3>
        <label className="field row between">
          <span>Auto-refresh every</span>
          <select className="input" value={settings.pollMinutes} onChange={(e) => set({ pollMinutes: +e.target.value })}>
            {[1, 2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="field row between">
          <span>Max repositories</span>
          <select className="input" value={settings.maxRepos} onChange={(e) => set({ maxRepos: +e.target.value })}>
            {[25, 50, 100, 200, 300].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Include repositories I…</span>
          <div className="row gap wrap">
            <label className="check"><input type="checkbox" checked={settings.affiliations.includes("OWNER")} onChange={() => toggleAff("OWNER")} /> own</label>
            <label className="check"><input type="checkbox" checked={settings.affiliations.includes("COLLABORATOR")} onChange={() => toggleAff("COLLABORATOR")} /> collaborate on</label>
            <label className="check"><input type="checkbox" checked={settings.affiliations.includes("ORGANIZATION_MEMBER")} onChange={() => toggleAff("ORGANIZATION_MEMBER")} /> access via orgs</label>
          </div>
        </div>
        <div className="row gap wrap">
          <label className="check"><input type="checkbox" checked={settings.includeForks} onChange={(e) => set({ includeForks: e.target.checked })} /> Include forks</label>
          <label className="check"><input type="checkbox" checked={settings.includeArchived} onChange={(e) => set({ includeArchived: e.target.checked })} /> Include archived</label>
        </div>
        {data && <p className="small muted">API budget: {data.rateLimit.remaining}/{data.rateLimit.limit} points, resets {new Date(data.rateLimit.resetAt).toLocaleTimeString()}.</p>}
      </section>

      <section className="card panel form">
        <h3>Menu bar / system tray</h3>
        <p className="small muted">Pick the live stats shown next to the RepoHub icon in the macOS menu bar (Windows shows them in the tray tooltip and menu).</p>
        <div className="row gap wrap">
          {STATS.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={settings.menuBarStats.includes(s.id)}
                onChange={(e) => set({ menuBarStats: e.target.checked ? STATS.map((x) => x.id).filter((id) => id === s.id || settings.menuBarStats.includes(id)) : settings.menuBarStats.filter((x) => x !== s.id) })}
              />
              {s.label}
            </label>
          ))}
        </div>
        {summary && (
          <div className="menubar-preview">
            <img src="/icon.svg" alt="" width={14} height={14} />
            <span>{menuBarTitle(summary, settings.menuBarStats) || "(icon only)"}</span>
          </div>
        )}
        {!isTauri && <p className="small muted">The tray item appears when running the desktop app.</p>}
      </section>

      <section className="card panel form">
        <h3>Appearance</h3>
        <label className="field row between">
          <span>Theme</span>
          <select className="input" value={settings.theme} onChange={(e) => set({ theme: e.target.value as S["theme"] })}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="card panel form">
        <h3>Account</h3>
        <label className="field">
          <span>GitHub OAuth App client ID</span>
          <input className="input" value={settings.clientId} onChange={(e) => set({ clientId: e.target.value.trim() })} placeholder="Ov23li…" />
        </label>
        <div className="row gap wrap">
          {token && <button className="btn" onClick={() => { void setToken(null); qc.clear(); }}><Icon name="logout" /> Sign out</button>}
          {demo && <button className="btn" onClick={() => { setDemo(false); qc.clear(); }}>Exit demo mode</button>}
          <button className="btn ghost" onClick={() => { clearIconMemory(); qc.invalidateQueries(); }}>Reload icons & data</button>
          <button className="btn ghost" onClick={() => update("settings", { ...DEFAULT_SETTINGS, clientId: settings.clientId })}>Reset settings</button>
        </div>
      </section>
      <p className="small muted center">RepoHub 0.1.0</p>
    </div>
  );
}

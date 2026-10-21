import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ModeSwitch, ThemeGrid } from "../components/ThemePicker";
import { clearIconMemory } from "../lib/icons";
import { checkForUpdates, downloadUpdate, installUpdate, updatesSupported, useUpdateStatus } from "../lib/updater";
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

      <UpdatesSection settings={settings} set={set} />

      <section className="card panel form">
        <h3>Appearance</h3>
        <div className="field row between">
          <span>Mode</span>
          <ModeSwitch />
        </div>
        <div className="field">
          <span>Color theme</span>
          <ThemeGrid />
        </div>
        <p className="small muted">Changes apply instantly. Status colors and chart category colors stay the same in every theme.</p>
      </section>

      <section className="card panel form">
        <h3>Account</h3>
        <div className="row gap wrap">
          {token && <button className="btn" onClick={() => { void setToken(null); qc.clear(); }}><Icon name="logout" /> Sign out</button>}
          {demo && <button className="btn" onClick={() => { setDemo(false); qc.clear(); }}>Exit demo mode</button>}
          <button className="btn ghost" onClick={() => { clearIconMemory(); qc.invalidateQueries(); }}>Reload icons & data</button>
          <button className="btn ghost" onClick={() => update("settings", { ...DEFAULT_SETTINGS, clientId: settings.clientId })}>Reset settings</button>
        </div>
      </section>
    </div>
  );
}

function UpdatesSection({ settings, set }: { settings: S; set(p: Partial<S>): void }) {
  const u = useUpdateStatus();
  const [version, setVersion] = useState(__APP_VERSION__);
  useEffect(() => {
    if (isTauri) import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion)).catch(() => {});
  }, []);
  const line =
    u.kind === "checking" ? "Checking for updates…"
    : u.kind === "none" ? `You're up to date · checked ${new Date(u.checkedAt).toLocaleTimeString()}`
    : u.kind === "available" ? `Version ${u.info.version} is available`
    : u.kind === "downloading" ? `Downloading ${u.info.version}${u.pct != null ? ` · ${u.pct}%` : "…"}`
    : u.kind === "ready" ? `Version ${u.info.version} is ready to install`
    : u.kind === "installing" ? "Installing and restarting…"
    : u.kind === "error" ? `Update check failed: ${u.message}`
    : "Checks run automatically in the background.";
  const info = "info" in u ? u.info : null;
  return (
    <section className="card panel form">
      <h3>Updates</h3>
      <div className="row between wrap gap">
        <div>
          <div><strong>RepoHub {version}</strong></div>
          <div className={`small ${u.kind === "error" ? "bad-c" : "muted"}`}>{updatesSupported ? line : "Updates install from the App Store on iOS, and from the desktop app on Mac and Windows."}</div>
        </div>
        {updatesSupported && (
          <div className="row gap">
            {u.kind === "available" && <button className="btn" onClick={() => downloadUpdate()}>Download</button>}
            {(u.kind === "ready" || u.kind === "installing") && <button className="btn primary" disabled={u.kind === "installing"} onClick={() => installUpdate()}>Restart to update</button>}
            <button className="btn" disabled={u.kind === "checking" || u.kind === "downloading"} onClick={() => checkForUpdates(settings.updateChannel, settings.autoUpdate)}>Check for updates</button>
          </div>
        )}
      </div>
      {u.kind === "downloading" && <div className="progress thin"><div style={{ width: `${u.pct ?? 30}%` }} /></div>}
      {info?.notes && <div className="release-notes small"><strong>What's new in {info.version}</strong><p>{info.notes}</p></div>}
      <label className="check"><input type="checkbox" checked={settings.autoUpdate} onChange={(e) => set({ autoUpdate: e.target.checked })} /> Download updates automatically</label>
      <label className="field row between">
        <span>Update channel</span>
        <select className="input" value={settings.updateChannel} onChange={(e) => set({ updateChannel: e.target.value as S["updateChannel"] })}>
          <option value="stable">Stable</option>
          <option value="beta">Beta (pre-releases)</option>
        </select>
      </label>
    </section>
  );
}

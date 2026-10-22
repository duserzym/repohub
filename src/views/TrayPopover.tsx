import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ago } from "../lib/format";
import { invoke, isTauri, listen } from "../lib/platform";
import { readyUpdateFromNative, type UpdateInfo } from "../lib/updater";
import { applyMode, applyPalette } from "../lib/themes";
import { summarize, type Summary } from "../lib/summary";
import { demoRepos } from "../lib/demo";
import { DEFAULT_CATEGORIES } from "../lib/categories";

// Rendered in the small window anchored to the menu-bar / tray icon.
// It receives data from the main window via the Rust `update_tray` command.

interface Payload {
  extra?: { summary: Summary; fetchedAt: string; login: string };
}

export function TrayPopover() {
  const [p, setP] = useState<Payload["extra"] | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("tray-mode");
    if (!isTauri && new URLSearchParams(location.search).has("demo")) {
      // Browser preview: render the popover from demo data.
      const d = demoRepos();
      setP({ summary: summarize(d.repos, DEFAULT_CATEGORIES, {}), fetchedAt: d.fetchedAt, login: d.viewer?.login ?? "" });
    }
    invoke<Payload | null>("get_tray_summary").then((s) => s?.extra && setP(s.extra));
    const offs: (() => void)[] = [];
    listen<Payload>("summary-updated", (s) => s.extra && setP(s.extra)).then((f) => offs.push(f));
    listen("popover-shown", () => tick((n) => n + 1)).then((f) => offs.push(f));
    listen<{ palette: string; theme: "system" | "light" | "dark" }>("appearance-changed", (a) => {
      applyPalette(a.palette);
      applyMode(a.theme);
    }).then((f) => offs.push(f));
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      offs.forEach((f) => f());
      clearInterval(t);
    };
  }, []);

  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    readyUpdateFromNative().then(setUpdate);
    let off = () => {};
    listen<UpdateInfo>("update-ready", setUpdate).then((f) => (off = f));
    return () => off();
  }, []);
  const restart = () => invoke("update_install");

  const open = (route?: string) => invoke("show_main_window", { route: route ?? null });
  const refresh = () => {
    if (!isTauri) return;
    import("@tauri-apps/api/event").then(({ emit }) => emit("tray-refresh"));
  };

  if (!p) {
    return (
      <div className="tray">
        <p className="muted small center">Open RepoHub and sign in to see live stats here.</p>
        <button className="btn primary" onClick={() => open()}>Open RepoHub</button>
      </div>
    );
  }
  const s = p.summary;
  return (
    <div className="tray">
      <header className="row between">
        <strong className="row gap"><img src="/icon.svg" width={18} height={18} alt="" /> RepoHub</strong>
        <span className="small muted">synced {ago(p.fetchedAt)}</span>
      </header>
      {update && (
        <button className="tray-update" onClick={restart}>
          <Icon name="refresh" size={13} />
          <span className="grow">Update ready (v{update.version}) — restart now?</span>
        </button>
      )}
      <div className="tray-stats">
        <div><b>{s.openIssues}</b><span>issues</span></div>
        <div><b>{s.openPRs}</b><span>PRs</span></div>
        <div className={s.failingCI ? "bad-c" : "ok-c"}><b>{s.failingCI || "✓"}</b><span>{s.failingCI ? "failing" : "CI green"}</span></div>
        <div><b>{s.commits30}</b><span>commits 30d</span></div>
      </div>
      {s.avgProgress != null && (
        <div className="small">
          <div className="row between"><span>Average progress</span><strong>{s.avgProgress}%</strong></div>
          <div className="progress thin"><div style={{ width: `${s.avgProgress}%` }} /></div>
        </div>
      )}
      <div className="tray-cats">
        {s.byCategory.filter((c) => c.repos).map((c) => (
          <button key={c.id} className="tray-row" onClick={() => open(`#/c/${c.id}`)}>
            <span className="dot" style={{ background: c.color }} />
            <span className="grow">{c.name}</span>
            <span className="muted small">{c.repos} · {c.openIssues} issues{c.failing ? ` · ${c.failing} failing` : ""}</span>
          </button>
        ))}
      </div>
      {s.attention.length > 0 && (
        <div className="tray-list">
          <div className="small muted">Needs attention</div>
          {s.attention.slice(0, 4).map((a, i) => (
            <button key={i} className="tray-row" onClick={() => open(`#/repo/${a.repo}`)}>
              <Icon name={a.kind === "ci" ? "x" : a.kind === "overdue" ? "clock" : "pr"} size={13} className={a.kind === "ci" ? "bad-c" : "warn-c"} />
              <span className="grow truncate"><b>{a.repo.split("/")[1]}</b> {a.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="tray-list">
        <div className="small muted">Latest commits</div>
        {s.recent.slice(0, 4).map((r) => (
          <button key={r.repo} className="tray-row" onClick={() => open(`#/repo/${r.repo}/commits`)}>
            <span className="grow truncate"><b>{r.repo.split("/")[1]}</b> <span className="muted">{r.message}</span></span>
            <span className="small muted">{ago(r.when)}</span>
          </button>
        ))}
      </div>
      <footer className="row gap">
        <button className="btn grow" onClick={refresh}><Icon name="refresh" /> Refresh</button>
        <button className="btn primary grow" onClick={() => open()}>Open dashboard</button>
      </footer>
    </div>
  );
}

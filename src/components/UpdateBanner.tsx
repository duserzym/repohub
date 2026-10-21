import { useEffect, useState } from "react";
import { useApp } from "../lib/state";
import { checkForUpdates, downloadUpdate, installUpdate, updatesSupported, useUpdateStatus } from "../lib/updater";
import { Icon } from "./Icon";

/** Inline update card in the sidebar — appears only when there is something to do. */
export function UpdateBanner() {
  const s = useUpdateStatus();
  if (s.kind === "available")
    return (
      <div className="update-card">
        <div className="row gap"><Icon name="refresh" size={13} /><strong>RepoHub {s.info.version}</strong></div>
        <div className="small muted">is available.</div>
        <button className="btn small primary" onClick={() => downloadUpdate()}>Download</button>
      </div>
    );
  if (s.kind === "downloading")
    return (
      <div className="update-card">
        <div className="row gap small"><span className="spinner" /> Downloading {s.info.version}…</div>
        <div className="progress thin"><div style={{ width: `${s.pct ?? 30}%` }} /></div>
      </div>
    );
  if (s.kind === "ready" || s.kind === "installing")
    return (
      <div className="update-card ready">
        <div className="row gap"><span className="ci ok"><span className="ci-dot"><Icon name="check" size={10} /></span></span><strong>Update ready</strong></div>
        <div className="small muted">Version {s.info.version} is downloaded.</div>
        <button className="btn small primary" disabled={s.kind === "installing"} onClick={() => installUpdate()}>
          {s.kind === "installing" ? "Restarting…" : "Restart now"}
        </button>
      </div>
    );
  return null;
}

/** Small "Check for updates" control at the bottom of the sidebar. */
export function UpdateCheckLink() {
  const s = useUpdateStatus();
  const { settings } = useApp();
  const [version, setVersion] = useState(__APP_VERSION__);
  const [justChecked, setJustChecked] = useState(false);
  useEffect(() => {
    import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion)).catch(() => {});
  }, []);
  useEffect(() => {
    if (s.kind !== "none") return;
    setJustChecked(true);
    const t = setTimeout(() => setJustChecked(false), 5000);
    return () => clearTimeout(t);
  }, [s]);
  if (!updatesSupported) return null;
  return (
    <div className="update-link small muted">
      <span>RepoHub {version}</span>
      {s.kind === "checking" ? (
        <span className="row gap-s"><span className="spinner" /> Checking…</span>
      ) : justChecked ? (
        <span className="ok-c row gap-s"><Icon name="check" size={11} /> Up to date</span>
      ) : s.kind === "error" ? (
        <button className="link small" title={s.message} onClick={() => checkForUpdates(settings.updateChannel, settings.autoUpdate, true)}>Check failed · retry</button>
      ) : s.kind === "available" || s.kind === "downloading" || s.kind === "ready" || s.kind === "installing" ? null : (
        <button className="link small" onClick={() => checkForUpdates(settings.updateChannel, settings.autoUpdate, true)}>Check for updates</button>
      )}
    </div>
  );
}

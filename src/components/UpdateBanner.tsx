import { downloadUpdate, installUpdate, useUpdateStatus } from "../lib/updater";
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

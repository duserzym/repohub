import { useEffect, useState } from "react";
import { cachedIcon, resolveIcon } from "../lib/icons";
import { useApp } from "../lib/state";
import { useRepos } from "../lib/queries";
import type { CheckState, Repo } from "../lib/types";
import { Icon, type IconName } from "./Icon";

export function RepoIcon({ repo, size = 40 }: { repo: Repo; size?: number }) {
  const { token, iconOverrides } = useApp();
  const override = iconOverrides[repo.nameWithOwner];
  const viewer = useRepos().data?.viewer?.login;
  const [src, setSrc] = useState<string | null | undefined>(() => override ?? cachedIcon(repo));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (override) return setSrc(override);
    let alive = true;
    if (cachedIcon(repo) === undefined) resolveIcon(repo, token, viewer).then((u) => alive && setSrc(u));
    else setSrc(cachedIcon(repo));
    return () => {
      alive = false;
    };
  }, [repo.nameWithOwner, repo.iconPaths[0], override, token, viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = { width: size, height: size, borderRadius: size * 0.24 };
  // No icon in the repo: use the organisation's avatar for org repos (not your own face).
  if (src === null && !failed && repo.ownerAvatar && viewer && repo.owner.toLowerCase() !== viewer.toLowerCase())
    return <img className="repo-icon" style={style} src={repo.ownerAvatar} alt="" loading="lazy" onError={() => setFailed(true)} />;
  if (src && !failed) {
    const wide = !!repo.socialImage && src === repo.socialImage && !override;
    return (
      <img
        className={`repo-icon${wide ? " cover" : ""}`}
        style={style}
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="repo-icon mono"
      style={{ ...style, background: repo.language?.color ?? "#64748b", fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {monogram(repo.name)}
    </div>
  );
}

function monogram(name: string) {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Progress({ pct, color, thin }: { pct: number; color?: string; thin?: boolean }) {
  return (
    <div className={`progress${thin ? " thin" : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const bw = width / values.length;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weekly commits: ${values.join(", ")}`}>
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * (height - 2)) : 1;
        return <rect key={i} x={i * bw + 1} y={height - h} width={bw - 2} height={h} rx={1.5} opacity={v ? 1 : 0.35} />;
      })}
    </svg>
  );
}

// Familiar status language everywhere: ✓ green = passing, ◷ amber = running,
// ✕ red = failing, – gray = no CI. Color is never the only signal.
const CI: Record<string, { icon: IconName; cls: string; label: string }> = {
  SUCCESS: { icon: "check", cls: "ok", label: "Passing" },
  FAILURE: { icon: "x", cls: "bad", label: "Failing" },
  ERROR: { icon: "x", cls: "bad", label: "Error" },
  PENDING: { icon: "clock", cls: "warn", label: "Running" },
  EXPECTED: { icon: "clock", cls: "warn", label: "Waiting" },
};
const NONE = { icon: "minus" as IconName, cls: "none", label: "No CI" };

export function CIBadge({ state, label, failing }: { state: CheckState | string | null; label?: boolean; failing?: string[] }) {
  const s = (state && CI[String(state).toUpperCase()]) || NONE;
  const title = failing?.length ? `CI failing: ${failing.join(", ")}` : `CI: ${s.label}`;
  return (
    <span className={`ci ${s.cls}`} title={title} aria-label={title}>
      <span className="ci-dot"><Icon name={s.icon} size={10} /></span>
      {label && <span>{s.label}</span>}
    </span>
  );
}

export function Stat({ label, value, icon, tone, sub }: { label: string; value: string | number; icon: IconName; tone?: string; sub?: string }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`}>
      <div className="stat-label">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Label({ name, color }: { name: string; color: string }) {
  return (
    <span className="label" style={{ background: `#${color}2e`, borderColor: `#${color}80` }}>
      {name}
    </span>
  );
}

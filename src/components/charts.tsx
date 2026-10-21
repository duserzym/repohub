// Dashboard charts — plain SVG, no chart library.
// Every chart: hover/focus tooltip, click-through navigation, and a table twin.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { navigate } from "../lib/router";
import { Icon } from "./Icon";

/* ------------------------------------------------------------------ utils */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Show every k-th tick plus the last one, without crowding the last. */
function showTick(i: number, n: number, space: number, minGap: number) {
  const k = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(space / minGap))));
  if (i === n - 1) return true;
  return i % k === 0 && n - 1 - i >= k;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Column/bar path: 4px rounded data-end, square at the baseline. */
function colPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (w <= 0) return "";
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

/* ---------------------------------------------------------------- tooltip */

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}
interface Tip {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const show = (e: { clientX: number; clientY: number } | DOMRect, title: string, rows: TipRow[]) => {
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    const cx = "clientX" in e ? e.clientX : e.left + e.width / 2;
    const cy = "clientY" in e ? e.clientY : e.top;
    setTip({ x: cx - box.left, y: cy - box.top, title, rows });
  };
  const node = tip ? (
    <div
      className="viz-tip"
      role="status"
      style={{ left: Math.min(tip.x + 12, (host.current?.clientWidth ?? 0) - 190), top: Math.max(0, tip.y - 12) }}
    >
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="viz-tip-row" key={r.label}>
          {r.color && <i style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  ) : null;
  return { host, show, hide: () => setTip(null), node };
}

/* ------------------------------------------------------------- chart card */

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string; shape?: "rect" | "line" | "dot"; icon?: ReactNode }[];
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card viz-card${className ? ` ${className}` : ""}`}>
      <header className="viz-head">
        <div className="grow">
          <h3>{title}</h3>
          {subtitle && <div className="small muted">{subtitle}</div>}
        </div>
        <button className="icon-btn" onClick={() => setAsTable((v) => !v)} title={asTable ? "Show chart" : "Show table"} aria-label={asTable ? "Show chart" : "Show table"}>
          <Icon name={asTable ? "activity" : "list"} size={14} />
        </button>
      </header>
      {legend && legend.length > 1 && !asTable && (
        <div className="viz-legend">
          {legend.map((l) => (
            <span key={l.label}>
              {l.icon ?? <i className={`key ${l.shape ?? "rect"}`} style={{ background: l.color }} />}
              {l.label}
            </span>
          ))}
        </div>
      )}
      {asTable ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/* ------------------------------------------------- stacked weekly columns */

export interface Series {
  id: string;
  name: string;
  color: string;
  values: number[];
  href?: string;
}

export function StackedColumns({ series, labels, height = 230 }: { series: Series[]; labels: string[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const pad = { l: 30, r: 4, t: 8, b: 22 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const band = iw / n;
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];

  return (
    <div ref={ref} className="viz-plot" onPointerLeave={() => { setHover(null); tip.hide(); }}>
      <div ref={tip.host} className="viz-host">
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label="Weekly commits by category">
            {ticks.map((t) => (
              <g key={t}>
                <line className="viz-grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
                <text className="viz-tick" x={pad.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
              </g>
            ))}
            {labels.map((lab, i) => {
              const x = pad.l + i * band + (band - bw) / 2;
              let acc = 0;
              const segs = series.map((s) => {
                const v = s.values[i] ?? 0;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                return { s, v, y0, y1 };
              });
              const topIdx = segs.map((sg) => sg.v > 0).lastIndexOf(true);
              return (
                <g
                  key={lab}
                  className={hover === i ? "viz-hover" : undefined}
                  tabIndex={0}
                  onPointerMove={(e) => {
                    setHover(i);
                    tip.show(e, `Week of ${lab}`, [
                      { label: "total commits", value: String(totals[i]) },
                      ...series.map((s) => ({ label: s.name, value: String(s.values[i] ?? 0), color: s.color })),
                    ]);
                  }}
                  onFocus={(e) => {
                    setHover(i);
                    tip.show((e.target as SVGGElement).getBoundingClientRect(), `Week of ${lab}`, series.map((s) => ({ label: s.name, value: String(s.values[i] ?? 0), color: s.color })));
                  }}
                  onBlur={() => tip.hide()}
                >
                  <rect className="viz-hit" x={pad.l + i * band} y={pad.t} width={band} height={ih} />
                  {segs.map(({ s, v, y0, y1 }, k) =>
                    v > 0 ? (
                      <path
                        key={s.id}
                        d={k === topIdx ? colPath(x, y1, bw, Math.max(0, y0 - y1 - (k ? 2 : 0))) : `M${x},${y1}h${bw}V${y0 - (k ? 2 : 0)}h${-bw}Z`}
                        fill={s.color}
                      />
                    ) : null,
                  )}
                  {showTick(i, n, iw, 48) && (
                    <text className="viz-tick" x={x + bw / 2} y={height - 6} textAnchor="middle">{lab}</text>
                  )}
                </g>
              );
            })}
            <line className="viz-axis" x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} />
            {/* direct label: latest week total */}
            <text className="viz-label" x={pad.l + (n - 1) * band + band / 2} y={y(totals[n - 1]) - 6} textAnchor="middle">{totals[n - 1]}</text>
          </svg>
        )}
        {tip.node}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- activity heatmap */

const SEQ = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)"];

export function Heatmap({
  rows,
  labels,
}: {
  rows: { id: string; name: string; color: string; values: number[]; href: string }[];
  labels: string[];
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const all = rows.flatMap((r) => r.values).filter((v) => v > 0).sort((a, b) => a - b);
  // Quantile bins so a single very busy repo doesn't wash out everything else.
  const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))] ?? 1;
  const edges = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const bin = (v: number) => (v <= 0 ? 0 : 1 + edges.filter((e) => v > e).length);
  const nameW = Math.min(180, Math.max(120, w * 0.32));
  const maxChars = Math.floor((nameW - 22) / 6.8);
  const cols = labels.length;
  const cell = Math.max(10, Math.min(30, (w - nameW - 8) / cols));
  const gap = 2;
  const rowH = Math.min(22, cell);
  const height = rows.length * rowH + 22;

  return (
    <div ref={ref} className="viz-plot" onPointerLeave={tip.hide}>
      <div ref={tip.host} className="viz-host">
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label="Commit activity per repository and week">
            {rows.map((r, ri) => (
              <g key={r.id} transform={`translate(0 ${ri * rowH})`}>
                <a href={r.href} onClick={(e) => { e.preventDefault(); navigate(r.href); }}>
                  <circle cx={5} cy={rowH / 2} r={4} fill={r.color} />
                  <text className="viz-rowlabel" x={14} y={rowH / 2 + 4}>
                    {r.name.length > maxChars ? `${r.name.slice(0, maxChars - 1)}…` : r.name}
                  </text>
                </a>
                {r.values.map((v, ci) => (
                  <rect
                    key={ci}
                    className="viz-cell"
                    tabIndex={0}
                    x={nameW + ci * cell}
                    y={gap / 2}
                    width={cell - gap}
                    height={rowH - gap}
                    rx={3}
                    fill={SEQ[bin(v)]}
                    onPointerMove={(e) => tip.show(e, r.name, [{ label: `commits · week of ${labels[ci]}`, value: String(v) }])}
                    onFocus={(e) => tip.show((e.target as SVGRectElement).getBoundingClientRect(), r.name, [{ label: `commits · week of ${labels[ci]}`, value: String(v) }])}
                    onBlur={tip.hide}
                    onClick={() => navigate(r.href)}
                  />
                ))}
              </g>
            ))}
            {labels.map((l, i) =>
              showTick(i, cols, cols * cell, 52) ? (
                <text key={l} className="viz-tick" x={nameW + i * cell + (cell - gap) / 2} y={height - 6} textAnchor="middle">{l}</text>
              ) : null,
            )}
          </svg>
        )}
        {tip.node}
      </div>
      <div className="viz-scale small muted">
        <span>Fewer</span>
        {SEQ.map((c, i) => <i key={i} style={{ background: c }} />)}
        <span>More commits</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------- horizontal progress bars */

export function ProgressBars({
  items,
}: {
  items: { id: string; name: string; sub: string; pct: number; color: string; href: string; detail: string }[];
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const rowH = 30;
  const nameW = Math.min(180, Math.max(110, w * 0.36));
  const valW = 40;
  const iw = Math.max(0, w - nameW - valW);
  const height = items.length * rowH + 4;
  return (
    <div ref={ref} className="viz-plot" onPointerLeave={tip.hide}>
      <div ref={tip.host} className="viz-host">
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label="Progress by repository">
            {[0, 50, 100].map((t) => (
              <line key={t} className="viz-grid" x1={nameW + (t / 100) * iw} x2={nameW + (t / 100) * iw} y1={0} y2={height - 4} />
            ))}
            {items.map((it, i) => (
              <g
                key={it.id}
                className="viz-row"
                tabIndex={0}
                transform={`translate(0 ${i * rowH})`}
                onPointerMove={(e) => tip.show(e, it.name, [{ label: it.sub, value: `${it.pct}%` }, { label: "", value: it.detail }])}
                onFocus={(e) => tip.show((e.target as SVGGElement).getBoundingClientRect(), it.name, [{ label: it.sub, value: `${it.pct}%` }])}
                onBlur={tip.hide}
                onClick={() => navigate(it.href)}
              >
                <rect className="viz-hit" x={0} y={0} width={w} height={rowH} />
                <circle cx={5} cy={rowH / 2} r={4} fill={it.color} />
                <text className="viz-rowlabel" x={14} y={rowH / 2 - 1}>{it.name.length > nameW / 7.5 ? `${it.name.slice(0, Math.floor(nameW / 7.5) - 1)}…` : it.name}</text>
                <text className="viz-sublabel" x={14} y={rowH / 2 + 11}>{it.sub.length > nameW / 6.5 ? `${it.sub.slice(0, Math.floor(nameW / 6.5) - 1)}…` : it.sub}</text>
                <rect className="viz-track" x={nameW} y={rowH / 2 - 6} width={iw} height={12} rx={4} />
                <path d={barPath(nameW, rowH / 2 - 6, (it.pct / 100) * iw, 12)} fill="var(--series-1)" />
                <text className="viz-label" x={w - 2} y={rowH / 2 + 4} textAnchor="end">{it.pct}%</text>
              </g>
            ))}
          </svg>
        )}
        {tip.node}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ donut */

export function Donut({
  segments,
  center,
  centerLabel,
}: {
  segments: { id: string; label: string; value: number; color: string; href?: string; detail?: string }[];
  center: string;
  centerLabel: string;
}) {
  const tip = useTip();
  const size = 168;
  const R = size / 2;
  const r = R - 22;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const gapA = segments.filter((s) => s.value > 0).length > 1 ? 0.03 : 0;
  let a0 = -Math.PI / 2;
  const arcs = segments.filter((s) => s.value > 0).map((s) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const start = a0 + gapA / 2;
    const end = Math.max(start + 0.001, a1 - gapA / 2);
    a0 = a1;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${R + rad * Math.cos(ang)},${R + rad * Math.sin(ang)}`;
    return {
      s,
      d: `M${p(start, R)}A${R},${R} 0 ${large} 1 ${p(end, R)}L${p(end, r)}A${r},${r} 0 ${large} 0 ${p(start, r)}Z`,
    };
  });
  return (
    <div className="donut-wrap" onPointerLeave={tip.hide}>
      <div ref={tip.host} className="viz-host donut-host">
        <svg width={size} height={size} role="img" aria-label={`${centerLabel}: ${center}`}>
          {arcs.map(({ s, d }) => (
            <path
              key={s.id}
              d={d}
              fill={s.color}
              className="viz-arc"
              tabIndex={0}
              onPointerMove={(e) => tip.show(e, s.label, [{ label: s.detail ?? "", value: `${s.value} (${Math.round((s.value / total) * 100)}%)` }])}
              onFocus={(e) => tip.show((e.target as SVGPathElement).getBoundingClientRect(), s.label, [{ label: s.detail ?? "", value: String(s.value) }])}
              onBlur={tip.hide}
              onClick={() => s.href && navigate(s.href)}
            />
          ))}
          <text className="donut-value" x={R} y={R + 4} textAnchor="middle">{center}</text>
          <text className="viz-tick" x={R} y={R + 22} textAnchor="middle">{centerLabel}</text>
        </svg>
        {tip.node}
      </div>
      <ul className="donut-list">
        {segments.map((s) => (
          <li key={s.id}>
            <a href={s.href} onClick={(e) => { if (s.href) { e.preventDefault(); navigate(s.href); } }}>
              <i style={{ background: s.color }} />
              <span className="grow">{s.label}</span>
              <b>{s.value}</b>
              <span className="muted">{Math.round((s.value / total) * 100)}%</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------ milestone timeline */

export function Timeline({
  items,
  pastDays = 30,
  futureDays = 120,
}: {
  items: { id: string; repo: string; title: string; due: string; pct: number; open: number; overdue: boolean; color: string; href: string }[];
  pastDays?: number;
  futureDays?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const now = Date.now();
  const t0 = now - pastDays * 864e5;
  const t1 = now + futureDays * 864e5;
  const pad = { l: 8, r: 8 };
  const x = (t: number) => pad.l + ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const sorted = [...items].sort((a, b) => +new Date(a.due) - +new Date(b.due));
  // Lay out in lanes so labels never overlap; past MAX_LANES, extra items
  // keep their dot (and tooltip/table) but drop the inline label.
  const MAX_LANES = 5;
  const lanes: number[] = [];
  const placed = sorted.map((it) => {
    const cx = x(+new Date(it.due));
    const name = (it.overdue ? "! " : "") + it.repo;
    const labelW = 20 + Math.max(name.length, Math.min(it.title.length + 6, name.length + 4)) * 6.8;
    let lane = lanes.findIndex((end) => end < cx - 8);
    let showLabel = true;
    if (lane === -1 && lanes.length < MAX_LANES) {
      lane = lanes.length;
      lanes.push(0);
    } else if (lane === -1) {
      lane = lanes.indexOf(Math.min(...lanes));
      showLabel = false;
    }
    if (showLabel) lanes[lane] = cx + labelW;
    const sub = `${it.title} · ${it.pct}%`;
    const maxSub = Math.max(8, Math.floor((labelW - 20) / 6));
    return { it, cx, lane, labelW, showLabel, name, sub: sub.length > maxSub ? `${it.title.slice(0, maxSub - 7)}… · ${it.pct}%` : sub };
  });
  const laneH = 34;
  const top = 14;
  const axisY = top + Math.max(1, lanes.length) * laneH + (placed.some((p) => !p.showLabel) ? 22 : 6);
  const height = axisY + 22;
  const months: number[] = [];
  const d = new Date(t0);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  for (d.setMonth(d.getMonth() + 1); +d < t1; d.setMonth(d.getMonth() + 1)) months.push(+d);

  return (
    <div ref={ref} className="viz-plot" onPointerLeave={tip.hide}>
      <div ref={tip.host} className="viz-host">
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label="Milestone due dates">
            {months.map((m) => (
              <g key={m}>
                <line className="viz-grid" x1={x(m)} x2={x(m)} y1={top} y2={axisY} />
                <text className="viz-tick" x={x(m) + 3} y={height - 6}>{new Date(m).toLocaleDateString(undefined, { month: "short" })}</text>
              </g>
            ))}
            <line className="viz-axis" x1={pad.l} x2={w - pad.r} y1={axisY} y2={axisY} />
            <line className="viz-today" x1={x(now)} x2={x(now)} y1={top - 4} y2={axisY} />
            <text className="viz-tick strong-tick" x={x(now)} y={top + 2} textAnchor="middle" dy={-4}>today</text>
            {placed.map(({ it, cx, lane, labelW, showLabel, name, sub }) => {
              // Unlabelled overflow items sit on a rug row just above the axis.
              const cy = showLabel ? top + lane * laneH + 10 : axisY - 9;
              const fitsRight = cx + labelW < w;
              return (
                <g
                  key={it.id}
                  className="viz-row"
                  tabIndex={0}
                  onPointerMove={(e) => tip.show(e, `${it.repo} · ${it.title}`, [
                    { label: it.overdue ? "overdue" : "due", value: new Date(it.due).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) },
                    { label: `complete · ${it.open} open`, value: `${it.pct}%` },
                  ])}
                  onFocus={(e) => tip.show((e.target as SVGGElement).getBoundingClientRect(), `${it.repo} · ${it.title}`, [{ label: "complete", value: `${it.pct}%` }])}
                  onBlur={tip.hide}
                  onClick={() => navigate(it.href)}
                >
                  <rect className="viz-hit" x={cx - 12} y={cy - 12} width={showLabel ? labelW + 24 : 24} height={laneH} />
                  <line className="viz-stem" x1={cx} x2={cx} y1={cy} y2={axisY} />
                  <circle cx={cx} cy={cy} r={6} className="viz-ring" />
                  <circle cx={cx} cy={cy} r={5} fill={it.overdue ? "var(--status-critical)" : it.color} />
                  {showLabel && (
                    <>
                      <text className="viz-rowlabel" x={fitsRight ? cx + 10 : cx - 10} y={cy + 1} textAnchor={fitsRight ? "start" : "end"}>{name}</text>
                      <text className="viz-sublabel" x={fitsRight ? cx + 10 : cx - 10} y={cy + 13} textAnchor={fitsRight ? "start" : "end"}>{sub}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- status meter */

export function StatusMeter({ parts }: { parts: { id: string; label: string; value: number; color: string; icon: ReactNode; href?: string }[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let x = 0;
  const live = parts.filter((p) => p.value > 0);
  const gaps = Math.max(0, live.length - 1) * 2;
  return (
    <div ref={ref} className="viz-plot" onPointerLeave={tip.hide}>
      <div ref={tip.host} className="viz-host">
        {w > 0 && (
          <svg width={w} height={18} role="img" aria-label="CI status across repositories">
            {live.map((p, i) => {
              const pw = (p.value / total) * (w - gaps);
              const px = x;
              x += pw + 2;
              const first = i === 0;
              const last = i === live.length - 1;
              const r = 4;
              const d = `M${px + (first ? r : 0)},0H${px + pw - (last ? r : 0)}${last ? `Q${px + pw},0 ${px + pw},${r}V${18 - r}Q${px + pw},18 ${px + pw - r},18` : `V18`}H${px + (first ? r : 0)}${first ? `Q${px},18 ${px},${18 - r}V${r}Q${px},0 ${px + r},0` : `V0`}Z`;
              return (
                <path
                  key={p.id}
                  d={d}
                  fill={p.color}
                  tabIndex={0}
                  className="viz-arc"
                  onPointerMove={(e) => tip.show(e, p.label, [{ label: "repositories", value: String(p.value) }])}
                  onFocus={(e) => tip.show((e.target as SVGPathElement).getBoundingClientRect(), p.label, [{ label: "repositories", value: String(p.value) }])}
                  onBlur={tip.hide}
                  onClick={() => p.href && navigate(p.href)}
                />
              );
            })}
          </svg>
        )}
        {tip.node}
      </div>
      <div className="meter-legend">
        {parts.map((p) => (
          <span key={p.id}>
            {p.icon}
            <b>{p.value}</b> {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

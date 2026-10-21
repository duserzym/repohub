import { useMemo, useState } from "react";
import { categoryOf, UNCATEGORIZED, UNCATEGORIZED_COLOR } from "../lib/categories";
import { isOverdue, repoProgress } from "../lib/format";
import { href } from "../lib/router";
import { useApp } from "../lib/state";
import type { Repo } from "../lib/types";
import { ChartCard, Donut, Heatmap, ProgressBars, StackedColumns, StatusMeter, Timeline } from "./charts";
import { Icon } from "./Icon";

const RANGES = [4, 8, 12] as const;

function pref<T extends string>(k: string, d: T): T {
  try {
    return (localStorage.getItem(k) as T) ?? d;
  } catch {
    return d;
  }
}
function save(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Charts for the dashboard (all repos) or one category. Every mark links to its repo or category. */
export function Insights({ repos, fetchedAt, scoped }: { repos: Repo[]; fetchedAt: string; scoped: boolean }) {
  const { categories, assignments } = useApp();
  const [weeks, setWeeks] = useState<number>(() => +pref("viz-weeks", "12") || 12);
  const [open, setOpen] = useState(() => pref("viz-open", "1") === "1");

  const cats = useMemo(
    () => [...categories, { id: UNCATEGORIZED, name: "Uncategorized", color: UNCATEGORIZED_COLOR, keywords: [] }],
    [categories],
  );
  const catOf = (r: Repo) => cats.find((c) => c.id === categoryOf(r, categories, assignments).id)!;

  const data = useMemo(() => {
    const total = repos[0]?.weekly.length ?? 12;
    const from = total - weeks;
    const end = new Date(fetchedAt).getTime();
    const labels = Array.from({ length: weeks }, (_, i) =>
      new Date(end - (weeks - i) * 7 * 864e5).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    const slice = (r: Repo) => r.weekly.slice(from);

    const series = cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        href: href.category(c.id),
        values: labels.map((_, i) => repos.filter((r) => catOf(r).id === c.id).reduce((a, r) => a + (slice(r)[i] ?? 0), 0)),
      }))
      .filter((s) => s.values.some((v) => v > 0));

    const heat = [...repos]
      .map((r) => ({ r, sum: slice(r).reduce((a, b) => a + b, 0) }))
      .filter((x) => x.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 10)
      .map(({ r }) => ({ id: r.id, name: r.name, color: catOf(r).color, values: slice(r), href: href.repo(r.nameWithOwner, "commits") }));

    const work = cats
      .map((c) => {
        const rs = repos.filter((r) => catOf(r).id === c.id);
        const issues = rs.reduce((a, r) => a + r.openIssues, 0);
        const prs = rs.reduce((a, r) => a + r.openPRs, 0);
        return { id: c.id, label: c.name, value: issues + prs, color: c.color, href: href.category(c.id), detail: `${issues} issues · ${prs} PRs` };
      })
      .filter((s) => s.value > 0);

    const byRepo = scoped
      ? repos.map((r) => ({ id: r.id, label: r.name, value: r.openIssues + r.openPRs, color: catOf(r).color, href: href.repo(r.nameWithOwner, "issues"), detail: `${r.openIssues} issues · ${r.openPRs} PRs` }))
          .filter((s) => s.value > 0)
          .sort((a, b) => b.value - a.value)
      : [];
    // Donut: ≤ 6 segments; fold the tail into "Other".
    const donutSrc = scoped ? byRepo : work;
    const donut = donutSrc.length > 6
      ? [...donutSrc.slice(0, 5), { id: "other", label: `Other (${donutSrc.length - 5})`, value: donutSrc.slice(5).reduce((a, s) => a + s.value, 0), color: UNCATEGORIZED_COLOR, href: undefined as string | undefined, detail: "" }]
      : donutSrc;

    const progress = repos
      .map((r) => ({ r, p: repoProgress(r) }))
      .filter((x) => x.p)
      .sort((a, b) => b.p!.pct - a.p!.pct)
      .slice(0, 8)
      .map(({ r, p }) => ({
        id: r.id,
        name: r.name,
        sub: p!.label,
        pct: p!.pct,
        color: catOf(r).color,
        href: href.repo(r.nameWithOwner, r.milestones.length ? "milestones" : "issues"),
        detail: r.milestones[0] ? `${r.milestones[0].closed}/${r.milestones[0].open + r.milestones[0].closed} milestone issues` : `${r.closedIssues}/${r.openIssues + r.closedIssues} issues closed`,
      }));

    const milestones = repos.flatMap((r) =>
      r.milestones
        .filter((m) => m.dueOn)
        .map((m) => ({
          id: `${r.id}:${m.title}`,
          repo: r.name,
          title: m.title,
          due: m.dueOn!,
          pct: m.progress,
          open: m.open,
          overdue: isOverdue(m.dueOn) && m.open > 0,
          color: catOf(r).color,
          href: href.repo(r.nameWithOwner, "milestones"),
        })),
    );
    const undated = repos.reduce((a, r) => a + r.milestones.filter((m) => !m.dueOn).length, 0);

    const ci = [
      { id: "ok", label: "passing", value: repos.filter((r) => r.ci === "SUCCESS").length, color: "var(--status-good)", icon: <Icon name="check" size={12} className="ok-c" /> },
      { id: "run", label: "running", value: repos.filter((r) => r.ci === "PENDING" || r.ci === "EXPECTED").length, color: "var(--status-warning)", icon: <Icon name="clock" size={12} className="warn-c" /> },
      { id: "bad", label: "failing", value: repos.filter((r) => r.ci === "FAILURE" || r.ci === "ERROR").length, color: "var(--status-critical)", icon: <Icon name="x" size={12} className="bad-c" /> },
      { id: "none", label: "no CI", value: repos.filter((r) => !r.ci).length, color: "var(--viz-none)", icon: <Icon name="play" size={12} className="muted" /> },
    ];
    return { labels, series, heat, donut, progress, milestones, undated, ci };
  }, [repos, weeks, fetchedAt, cats, categories, assignments, scoped]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    setOpen((o) => {
      save("viz-open", o ? "0" : "1");
      return !o;
    });
  };

  return (
    <section className="section insights">
      <div className="insights-bar">
        <h2 className="section-title"><Icon name="activity" size={14} /> Insights</h2>
        {open && (
          <div className="seg text" role="group" aria-label="Activity range">
            {RANGES.map((r) => (
              <button key={r} className={weeks === r ? "on" : ""} onClick={() => { setWeeks(r); save("viz-weeks", String(r)); }}>
                {r} wk
              </button>
            ))}
          </div>
        )}
        <span className="grow" />
        <button className="btn ghost small" onClick={toggle}>{open ? "Hide charts" : "Show charts"}</button>
      </div>

      {open && (
        <div className="viz-grid">
          <ChartCard
            className="span-8"
            title="Commits per week"
            subtitle={`Last ${weeks} weeks${scoped ? "" : ", stacked by category"}`}
            legend={data.series.map((s) => ({ label: s.name, color: s.color }))}
            table={{ columns: ["Week of", ...data.series.map((s) => s.name), "Total"], rows: data.labels.map((l, i) => [l, ...data.series.map((s) => s.values[i]), data.series.reduce((a, s) => a + s.values[i], 0)]) }}
          >
            {data.series.length ? <StackedColumns series={data.series} labels={data.labels} /> : <p className="muted small">No commits in this range.</p>}
          </ChartCard>

          <ChartCard
            className="span-4"
            title={scoped ? "Open work by repository" : "Open work by category"}
            subtitle="Open issues + pull requests"
            table={{ columns: [scoped ? "Repository" : "Category", "Open", "Detail"], rows: data.donut.map((s) => [s.label, s.value, s.detail ?? ""]) }}
          >
            {data.donut.length ? (
              <Donut segments={data.donut} center={String(data.donut.reduce((a, s) => a + s.value, 0))} centerLabel="open items" />
            ) : <p className="muted small">No open issues or PRs.</p>}
          </ChartCard>

          <ChartCard
            className="span-6"
            title="Activity heatmap"
            subtitle={`Most active repositories · commits per week`}
            table={{ columns: ["Repository", ...data.labels], rows: data.heat.map((h) => [h.name, ...h.values]) }}
          >
            {data.heat.length ? <Heatmap rows={data.heat} labels={data.labels} /> : <p className="muted small">No activity in this range.</p>}
          </ChartCard>

          <ChartCard
            className="span-6"
            title="Progress by project"
            subtitle="Nearest milestone, otherwise issues closed"
            table={{ columns: ["Repository", "Measure", "Progress"], rows: data.progress.map((p) => [p.name, p.sub, `${p.pct}%`]) }}
          >
            {data.progress.length ? <ProgressBars items={data.progress} /> : <p className="muted small">Add milestones or issues on GitHub to track progress.</p>}
          </ChartCard>

          <ChartCard
            className="span-8"
            title="Milestone timeline"
            subtitle={`Due dates from 30 days ago to 4 months ahead${data.undated ? ` · ${data.undated} without a due date` : ""}`}
            legend={[
              ...cats.filter((c) => data.milestones.some((m) => m.color === c.color)).map((c) => ({ label: c.name, color: c.color, shape: "dot" as const })),
              ...(data.milestones.some((m) => m.overdue) ? [{ label: "Overdue", color: "var(--status-critical)", shape: "dot" as const }] : []),
            ]}
            table={{ columns: ["Repository", "Milestone", "Due", "Progress", "Status"], rows: [...data.milestones].sort((a, b) => +new Date(a.due) - +new Date(b.due)).map((m) => [m.repo, m.title, new Date(m.due).toLocaleDateString(), `${m.pct}%`, m.overdue ? "overdue" : "on track"]) }}
          >
            {data.milestones.length ? <Timeline items={data.milestones} /> : <p className="muted small">No milestones with due dates.</p>}
          </ChartCard>

          <ChartCard
            className="span-4"
            title="CI health"
            subtitle="Latest checks on each default branch"
            table={{ columns: ["Status", "Repositories"], rows: data.ci.map((c) => [c.label, c.value]) }}
          >
            <StatusMeter parts={data.ci} />
            <CiByGroup repos={repos} groupOf={(r) => catOf(r)} />
            <CiList repos={repos} />
          </ChartCard>
        </div>
      )}
    </section>
  );
}

const isBad = (r: Repo) => r.ci === "FAILURE" || r.ci === "ERROR";

/** Per-category CI rows: ✓ passing · ◷ running · ✕ failing, each with its count. */
function CiByGroup({ repos, groupOf }: { repos: Repo[]; groupOf(r: Repo): { id: string; name: string; color: string } }) {
  const groups = new Map<string, { name: string; color: string; ok: number; run: number; bad: number; none: number }>();
  for (const r of repos) {
    const g = groupOf(r);
    const e = groups.get(g.id) ?? { name: g.name, color: g.color, ok: 0, run: 0, bad: 0, none: 0 };
    if (r.ci === "SUCCESS") e.ok++;
    else if (isBad(r)) e.bad++;
    else if (r.ci) e.run++;
    else e.none++;
    groups.set(g.id, e);
  }
  return (
    <ul className="ci-groups">
      {[...groups.entries()].map(([id, g]) => {
        const t = g.ok + g.run + g.bad + g.none || 1;
        return (
          <li key={id}>
            <a href={href.category(id)} className="row gap">
              <span className="dot" style={{ background: g.color }} />
              <span className="grow truncate">{g.name}</span>
              <span className="ci-counts">
                <span className="ok-c"><Icon name="check" size={11} />{g.ok}</span>
                <span className="warn-c"><Icon name="clock" size={11} />{g.run}</span>
                <span className="bad-c"><Icon name="x" size={11} />{g.bad}</span>
              </span>
            </a>
            <div className="ci-mini">
              <i style={{ flex: g.ok, background: "var(--status-good)" }} />
              <i style={{ flex: g.run, background: "var(--status-warning)" }} />
              <i style={{ flex: g.bad, background: "var(--status-critical)" }} />
              <i style={{ flex: g.none || (t === 1 && !g.ok && !g.run && !g.bad ? 1 : 0), background: "var(--viz-none)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CiList({ repos }: { repos: Repo[] }) {
  const failing = repos.filter(isBad);
  if (!failing.length) return <p className="small muted mt">All builds green.</p>;
  return (
    <ul className="feed mt">
      {failing.slice(0, 4).map((r) => (
        <li key={r.id}>
          <Icon name="x" size={12} className="bad-c" />
          <a href={href.repo(r.nameWithOwner, "actions")}><strong>{r.name}</strong> <span className="muted">failing on {r.defaultBranch ?? "main"}</span></a>
        </li>
      ))}
    </ul>
  );
}

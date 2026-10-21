import { useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Spinner } from "../components/bits";
import { Icon } from "../components/Icon";
import { ago } from "../lib/format";
import {
  deleteIdea, IDEAS_REPO, loadPad, refineNow, saveIdea, serialize, setupPad, sha256, slugify,
  type Idea, type IdeaPad, type IdeaStatus,
} from "../lib/ideas";
import { openUrl } from "../lib/platform";
import { useRepos } from "../lib/queries";
import { navigate } from "../lib/router";
import { useApp } from "../lib/state";

const STATUSES: { id: IdeaStatus; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "planning", label: "Planning" },
  { id: "active", label: "In development" },
  { id: "archived", label: "Archived" },
];

// ------------------------------------------------------------------ data

function demoPad(): IdeaPad {
  const mk = (slug: string, title: string, tags: string[], status: IdeaStatus, body: string, days: number): Idea => {
    const i = { slug, sha: "demo", title, tags, status, created: new Date(Date.now() - days * 864e5).toISOString(), body, raw: "" };
    return { ...i, raw: serialize(i) };
  };
  const ideas = [
    mk("zircon-image-classifier", "Zircon CL image classifier", ["geochronology", "machine-learning"], "planning",
      "Classify cathodoluminescence images of zircon grains (oscillatory zoning, cores, rims) to speed up spot selection for LA-ICP-MS.", 2),
    mk("paleomag-field-app", "Offline paleomag field notebook", ["paleomagnetism", "mobile"], "idea",
      "Phone app for logging cores in the field: GPS, sun/magnetic compass, photos, sync to MagIC format later.", 6),
    mk("tims-run-dashboard", "Live TIMS run dashboard", ["tims", "instrument"], "active",
      "Stream ratios from the Phoenix during a run and show drift, beam stability and an ETA.", 12),
  ];
  return {
    repo: `demo-user/${IDEAS_REPO}`, url: "https://github.com/", branch: "main", ideas, templateCurrent: true,
    lastRun: { status: "completed", conclusion: "success", url: "https://github.com/", createdAt: new Date(Date.now() - 5 * 3600e3).toISOString() },
    plans: {
      "zircon-image-classifier": {
        slug: "zircon-image-classifier", sourceHash: "", model: "openai/gpt-4o", refinedAt: new Date(Date.now() - 5 * 3600e3).toISOString(),
        related: ["napari/napari", "scikit-image/scikit-image", "MouseLand/cellpose"],
        body: `## Summary
A small Python tool that segments zircon grains in CL mosaics and labels internal textures so analysts can pick laser spots faster.

## Goals
- Segment grains in whole-mount CL mosaics
- Label zoning type per grain (oscillatory, sector, core–rim, homogeneous)
- Export spot suggestions as CSV for the laser software

## Reuse before you build
- **cellpose**: pretrained segmentation that handles touching grains; fine-tune on ~200 labelled grains
- **napari**: annotation UI for labels and for reviewing predictions
- **scikit-image**: texture features for a fast baseline classifier

## Proposed approach
Python package + napari plugin. Segmentation with cellpose → per-grain crops → gradient-boosted baseline on texture features, then a small CNN if needed.

## Milestones
- [ ] Label 200 grains in napari (1 week)
- [ ] Segmentation fine-tune + metrics (1 week)
- [ ] Texture classifier baseline (3 days)
- [ ] Spot-suggestion export (2 days)

## First issues to open
- Set up package skeleton with pyproject and CI
- Write mosaic loader for the lab's CL TIFF exports
- Add napari labelling workflow and label schema
- Fine-tune cellpose on labelled grains
- Baseline texture classifier with cross-validation
- CSV export of suggested spots

## Risks and open questions
- Label consistency between analysts
- CL brightness varies between sessions — normalise per mosaic?

## Next step today
Export 3 representative CL mosaics and label 30 grains in napari.

## Changes since last plan
First plan.`,
      },
    },
  };
}

function usePad() {
  const { token, demo } = useApp();
  const login = useRepos().data?.viewer.login;
  return useQuery({
    queryKey: ["pad", demo ? "demo" : login],
    enabled: demo || (!!token && !!login),
    queryFn: () => (demo ? demoPad() : loadPad(token!, login!)),
    refetchInterval: (q) => (q.state.data?.lastRun && q.state.data.lastRun.status !== "completed" ? 15_000 : 60_000),
    staleTime: 20_000,
  });
}

// ------------------------------------------------------------------ view

export function Ideas({ slug }: { slug: string | null }) {
  const { token, demo } = useApp();
  const login = useRepos().data?.viewer.login;
  const qc = useQueryClient();
  const { data: pad, isLoading, error, refetch } = usePad();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [capture, setCapture] = useState("");
  const key = ["pad", demo ? "demo" : login];

  const setPad = (fn: (p: IdeaPad) => IdeaPad) => qc.setQueryData<IdeaPad | null>(key, (p) => (p ? fn(p) : p));

  const ideas = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (pad?.ideas ?? []).filter((i) => !f || `${i.title} ${i.tags.join(" ")} ${i.body}`.toLowerCase().includes(f));
  }, [pad, filter]);
  const current = pad?.ideas.find((i) => i.slug === slug) ?? null;

  useEffect(() => {
    if (pad && !slug && pad.ideas[0] && window.innerWidth > 900) navigate(`#/ideas/${pad.ideas[0].slug}`);
  }, [pad, slug]);

  async function setup() {
    setErr(null);
    setBusy("Setting up your Idea Pad on GitHub…");
    try {
      await setupPad(token!, login!, pad ?? null);
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create(title: string) {
    if (!pad || !title.trim()) return;
    let slug = slugify(title);
    while (pad.ideas.some((i) => i.slug === slug)) slug += "-2";
    const idea: Idea = { slug, sha: null, title: title.trim(), tags: [], status: "idea", created: new Date().toISOString(), body: "", raw: "" };
    setPad((p) => ({ ...p, ideas: [{ ...idea, raw: serialize(idea) }, ...p.ideas] }));
    navigate(`#/ideas/${slug}`);
    setCapture("");
    if (demo) return;
    try {
      const saved = await saveIdea(token!, pad.repo, idea);
      setPad((p) => ({ ...p, ideas: p.ideas.map((i) => (i.slug === slug ? saved : i)) }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (isLoading || !login && !demo) return <div className="center-fill"><Spinner /> <span className="muted">Opening your Idea Pad…</span></div>;
  if (error) return <Empty icon="alert" title="Couldn't load the Idea Pad"><p className="muted small">{(error as Error).message}</p></Empty>;

  if (!pad)
    return (
      <div className="page narrow">
        <header className="page-head"><h1>Idea Pad</h1></header>
        <section className="card panel pad-setup">
          <Icon name="bulb" size={28} />
          <h2>Capture ideas. Get plans every morning.</h2>
          <p className="muted">
            RepoHub keeps your project ideas as Markdown in a private repo, <b>{login}/{IDEAS_REPO}</b>, and saves as you type. Every day, a GitHub Action in that repo finds new or changed ideas, searches GitHub for related ready-to-use projects, and writes or refines a development plan for each one: goals, what to reuse, milestones and first issues.
          </p>
          <ul className="small muted">
            <li>Runs on GitHub's servers, so your Mac can be off.</li>
            <li>Uses GitHub Models with no setup. To use Claude, add an <code>ANTHROPIC_API_KEY</code> secret to the repo.</li>
            <li>Everything is plain files you own: <code>ideas/*.md</code> and <code>plans/*.md</code>.</li>
          </ul>
          <button className="btn primary big" disabled={!!busy || demo} onClick={setup}>
            {busy ? <><Spinner /> {busy}</> : <><Icon name="plus" /> Create my Idea Pad</>}
          </button>
          {err && <p className="error">{err}</p>}
        </section>
      </div>
    );

  return (
    <div className="ideas">
      <aside className="idea-list">
        <form className="capture" onSubmit={(e) => { e.preventDefault(); void create(capture); }}>
          <Icon name="bulb" size={16} />
          <input value={capture} onChange={(e) => setCapture(e.target.value)} placeholder="Capture an idea… (Enter)" aria-label="New idea title" />
        </form>
        <div className="search-box small-box">
          <Icon name="search" size={13} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search ideas" aria-label="Search ideas" />
        </div>
        <ul>
          {ideas.map((i) => {
            const plan = pad.plans[i.slug];
            return (
              <li key={i.slug}>
                <a className={`idea-item${i.slug === slug ? " on" : ""}`} href={`#/ideas/${i.slug}`}>
                  <strong className="truncate">{i.title}</strong>
                  <span className="row gap small muted">
                    <span className={`status-dot s-${i.status}`} />
                    {STATUSES.find((s) => s.id === i.status)?.label}
                    {plan ? <span className="plan-chip">plan</span> : null}
                  </span>
                </a>
              </li>
            );
          })}
          {!ideas.length && <li className="small muted pad-empty">No ideas yet. Type one above.</li>}
        </ul>
        <div className="pad-foot small muted">
          <PlannerStatus pad={pad} />
          <a href={pad.url} onClick={(e) => { e.preventDefault(); void openUrl(pad.url); }}>{pad.repo}</a>
          {!pad.templateCurrent && !demo && (
            <button className="link small" onClick={setup} disabled={!!busy}>{busy ? "Updating…" : "Update planner"}</button>
          )}
        </div>
      </aside>
      <main className="idea-main">
        {err && <p className="error">{err}</p>}
        {current ? (
          <IdeaEditor key={current.slug} pad={pad} idea={current} setPad={setPad} onError={setErr} />
        ) : (
          <Empty icon="bulb" title="Pick or capture an idea">
            <p className="muted small">Ideas save to GitHub as you type. Plans arrive after the next daily run, or press “Refine now”.</p>
          </Empty>
        )}
      </main>
    </div>
  );
}

function PlannerStatus({ pad }: { pad: IdeaPad }) {
  const r = pad.lastRun;
  if (!r) return <span>Planner: runs daily (first run pending)</span>;
  const running = r.status !== "completed";
  const ok = r.conclusion === "success";
  return (
    <span className="row gap-s">
      <span className={`ci ${running ? "warn" : ok ? "ok" : "bad"}`}><span className="ci-dot"><Icon name={running ? "clock" : ok ? "check" : "x"} size={10} /></span></span>
      Planner {running ? "running now" : ok ? `ran ${ago(r.createdAt)}` : `failed ${ago(r.createdAt)}`}
      {!running && !ok && <a href={r.url} onClick={(e) => { e.preventDefault(); void openUrl(r.url); }}>log</a>}
    </span>
  );
}

// ---------------------------------------------------------------- editor

function IdeaEditor({ pad, idea, setPad, onError }: {
  pad: IdeaPad; idea: Idea; setPad: (fn: (p: IdeaPad) => IdeaPad) => void; onError: (m: string | null) => void;
}) {
  const { token, demo, tracked, update } = useApp();
  const [draft, setDraft] = useState(idea);
  const [save, setSave] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [planFresh, setPlanFresh] = useState<boolean | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refining, setRefining] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(draft);
  latest.current = draft;
  const plan = pad.plans[idea.slug];

  // Autosave 1.2 s after typing stops.
  const edit = (patch: Partial<Idea>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSave("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  };
  async function flush() {
    const d = latest.current;
    setSave("saving");
    try {
      const saved = demo ? { ...d, raw: serialize(d) } : await saveIdea(token!, pad.repo, d);
      setPad((p) => ({ ...p, ideas: p.ideas.map((i) => (i.slug === d.slug ? saved : i)) }));
      setDraft((cur) => ({ ...cur, sha: saved.sha, raw: saved.raw }));
      setSave("saved");
      onError(null);
    } catch (e) {
      setSave("error");
      onError((e as Error).message);
    }
  }
  useEffect(() => () => {
    // Save pending edits when switching ideas.
    if (timer.current) {
      clearTimeout(timer.current);
      void flush();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!plan) return setPlanFresh(null);
    void sha256(draft.raw || serialize(draft)).then((h) => setPlanFresh(demo ? true : h === plan.sourceHash));
  }, [plan, draft.raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(
    () => (plan ? DOMPurify.sanitize(marked.parse(plan.body, { async: false }) as string) : ""),
    [plan],
  );

  async function doRefine() {
    setRefining(true);
    try {
      if (save !== "saved") await flush();
      if (!demo) await refineNow(token!, pad, draft.slug);
      setPad((p) => ({ ...p, lastRun: { status: "queued", conclusion: null, url: p.url, createdAt: new Date().toISOString() } }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRefining(false);
    }
  }

  async function remove() {
    try {
      if (!demo) await deleteIdea(token!, pad.repo, draft);
      setPad((p) => ({ ...p, ideas: p.ideas.filter((i) => i.slug !== draft.slug) }));
      navigate("#/ideas");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="idea-grid">
      <section className="card panel idea-editor">
        <input className="idea-title" value={draft.title} onChange={(e) => edit({ title: e.target.value })} aria-label="Title" />
        <div className="row gap wrap idea-meta">
          <span className={`save-state ${save}`}>
            {save === "saving" ? <><Spinner /> Saving…</> : save === "dirty" ? "Editing…" : save === "error" ? <><Icon name="x" size={12} /> Not saved</> : <><Icon name="check" size={12} /> Saved to GitHub</>}
          </span>
          <select className="input small" value={draft.status} onChange={(e) => edit({ status: e.target.value as IdeaStatus })} aria-label="Status">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input
            className="input small grow"
            defaultValue={draft.tags.join(", ")}
            onChange={(e) => edit({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            placeholder="Tags, comma separated (e.g. geochronology, python)"
            aria-label="Tags"
          />
        </div>
        <textarea
          className="idea-body"
          value={draft.body}
          onChange={(e) => edit({ body: e.target.value })}
          placeholder={"Describe the idea in a few lines: the problem, who it's for, what it must do, any constraints.\nMarkdown works.\n\nThe daily planner turns this into a plan, so the more context, the better the plan."}
          aria-label="Idea"
        />
        <div className="row between small muted">
          <span>Created {draft.created ? ago(draft.created) : "now"} · <code>ideas/{draft.slug}.md</code></span>
          {confirmDelete ? (
            <span className="row gap">
              Delete this idea?
              <button className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn small danger-btn" onClick={remove}>Delete</button>
            </span>
          ) : (
            <button className="icon-btn danger" onClick={() => setConfirmDelete(true)} aria-label="Delete idea"><Icon name="trash" size={14} /></button>
          )}
        </div>
      </section>

      <section className="card panel idea-plan">
        <header className="row between gap wrap">
          <h3><Icon name="milestone" size={14} /> Development plan</h3>
          <button className="btn small" onClick={doRefine} disabled={refining || pad.lastRun?.status === "queued" || pad.lastRun?.status === "in_progress"}>
            <Icon name="refresh" size={13} className={refining ? "spin" : ""} /> Refine now
          </button>
        </header>
        {plan ? (
          <>
            <div className="small muted plan-meta">
              Refined {ago(plan.refinedAt)} · {plan.model}
              {planFresh === false && <span className="pill overdue"><Icon name="clock" size={11} /> Idea changed. Refines at the next daily run.</span>}
              {planFresh === true && <span className="pill okp"><Icon name="check" size={11} /> Up to date</span>}
            </div>
            {plan.related.length > 0 && (
              <div className="row gap wrap related">
                {plan.related.slice(0, 8).map((r) => {
                  const on = tracked.some((t) => t.toLowerCase() === r.toLowerCase());
                  return (
                    <span key={r} className="chip">
                      <a href={`https://github.com/${r}`} onClick={(e) => { e.preventDefault(); void openUrl(`https://github.com/${r}`); }}>{r}</a>
                      <button className="link small" title={on ? "Tracking on dashboard" : "Track on dashboard"}
                        onClick={() => update("tracked", (t) => (on ? t.filter((x) => x.toLowerCase() !== r.toLowerCase()) : [...t, r]))}>
                        <Icon name={on ? "check" : "plus"} size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest("a");
                if (a?.href) {
                  e.preventDefault();
                  void openUrl(a.href);
                }
              }}
            />
          </>
        ) : (
          <Empty icon="milestone" title="No plan yet">
            <p className="muted small">The planner runs every morning and picks up new ideas automatically. Press “Refine now” to plan this one right away (takes about a minute).</p>
          </Empty>
        )}
      </section>
    </div>
  );
}


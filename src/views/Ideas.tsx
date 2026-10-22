import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Spinner } from "../components/bits";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { MdEditor, MdToolbar, type MdEditorHandle } from "../components/MdEditor";
import { stats, stripFrontMatter, toggleTask } from "../lib/md/render";
import { kvGet, kvSet } from "../lib/storage";
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
      `Classify cathodoluminescence images of zircon grains (oscillatory zoning, cores, rims) to speed up spot selection for **LA-ICP-MS**.

## Structure

\`\`\`tree
zircon-cl/
├── README.md
├── pyproject.toml
├── src/zircon_cl/
│   ├── segment.py      # cellpose wrapper
│   ├── classify.py     # texture → zoning type
│   └── export.py       # spot list for the laser
└── tests/
\`\`\`

## Pipeline

\`\`\`mermaid
flowchart LR
  mosaic[CL mosaic] --> seg[Segment grains] --> cls[Classify zoning] --> spots[Spot CSV]
\`\`\`

## Classes

| Zoning | Typical origin | Spot? |
| --- | --- | --- |
| Oscillatory | Magmatic | ✓ |
| Sector | Fast growth | maybe |
| Core–rim | Inheritance | rim + core |

## Next steps

- [x] Export 3 CL mosaics
- [ ] Label 30 grains in napari
- [ ] Try cellpose \`cyto2\` model

Age check: $t = \\frac{1}{\\lambda}\\ln\\left(1 + \\frac{^{206}Pb^*}{^{238}U}\\right)$

\`\`\`python
from cellpose import models
model = models.Cellpose(model_type="cyto2")
masks, *_ = model.eval(img, diameter=40)
\`\`\`
`, 2),
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

const PAD_CACHE = "cache.json";

function usePad() {
  const { token, demo } = useApp();
  const login = useRepos().data?.viewer?.login;
  const qc = useQueryClient();
  const key = ["pad", demo ? "demo" : login];
  const q = useQuery({
    queryKey: key,
    enabled: demo || (!!token && !!login),
    queryFn: async () => {
      if (demo) return demoPad();
      const pad = await loadPad(token!, login!);
      void kvSet(`pad:${login}`, pad, PAD_CACHE); // opens instantly next time
      return pad;
    },
    refetchInterval: (q) => (q.state.data?.lastRun && q.state.data.lastRun.status !== "completed" ? 15_000 : 60_000),
    staleTime: 20_000,
  });
  // Show the last saved Idea Pad immediately while GitHub is asked for changes.
  useEffect(() => {
    if (demo || !login || qc.getQueryData(key)) return;
    void kvGet<IdeaPad>(`pad:${login}`, PAD_CACHE).then((c) => {
      if (c?.ideas && !qc.getQueryData(key)) qc.setQueryData(key, c, { updatedAt: 0 });
    });
  }, [login, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  return q;
}

/** Slug of a just-created idea whose editor should take focus when it mounts. */
let focusNext: string | null = null;

/** Turns a dropped/imported .md file into an idea (title from front matter, first heading or file name). */
function fromMarkdownFile(name: string, text: string): { title: string; body: string; tags: string[] } {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const fmTitle = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1];
  let body = stripFrontMatter(text).replace(/^\s+/, "");
  const h1 = /^#\s+(.+)\n?/.exec(body);
  const title = fmTitle ?? h1?.[1] ?? name.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ");
  if (!fmTitle && h1) body = body.slice(h1[0].length).replace(/^\s+/, "");
  const tags = /^tags:\s*\[(.*)\]/m.exec(fm)?.[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean) ?? [];
  return { title: title.trim(), body, tags };
}

// ------------------------------------------------------------------ view

export function Ideas({ slug }: { slug: string | null }) {
  const { token, demo } = useApp();
  const login = useRepos().data?.viewer?.login;
  const qc = useQueryClient();
  const { data: pad, isLoading, error, refetch } = usePad();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [capture, setCapture] = useState("");
  const [dropping, setDropping] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const key = ["pad", demo ? "demo" : login];

  // ⌘N anywhere in the Idea Pad (or "New Idea…" in the menu bar) → capture box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        captureRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (slug === "_new") setTimeout(() => captureRef.current?.focus(), 50);
  }, [slug]);

  const setPad = (fn: (p: IdeaPad) => IdeaPad) => qc.setQueryData<IdeaPad | null>(key, (p) => (p ? fn(p) : p));

  const ideas = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (pad?.ideas ?? []).filter((i) => !f || `${i.title} ${i.tags.join(" ")} ${i.body}`.toLowerCase().includes(f));
  }, [pad, filter]);
  const current = pad?.ideas.find((i) => i.slug === slug) ?? null;

  useEffect(() => {
    if (pad && !slug && pad.ideas[0] && window.innerWidth > 900) navigate(`#/ideas/${pad.ideas[0].slug}`);
  }, [pad, slug]);

  const importFiles = useCallback(async (files: FileList | File[]) => {
    for (const f of [...files].filter((f) => /\.(md|markdown|txt)$/i.test(f.name) && f.size < 1_000_000)) {
      const { title, body, tags } = fromMarkdownFile(f.name, await f.text());
      await create(title, body, tags);
    }
  }, [pad]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function create(title: string, body = "", tags: string[] = []) {
    if (!pad || !title.trim()) return;
    let slug = slugify(title) || "note";
    while (pad.ideas.some((i) => i.slug === slug) || slug === "_new") slug += "-2";
    const idea: Idea = { slug, sha: null, title: title.trim(), tags, status: "idea", created: new Date().toISOString(), body, raw: "" };
    setPad((p) => ({ ...p, ideas: [{ ...idea, raw: serialize(idea) }, ...p.ideas] }));
    focusNext = slug;
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
      <aside
        className={`idea-list${dropping ? " dropping" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => { e.preventDefault(); setDropping(false); void importFiles(e.dataTransfer.files); }}
      >
        <form className="capture" onSubmit={(e) => { e.preventDefault(); void create(capture); }}>
          <Icon name="bulb" size={16} />
          <input ref={captureRef} value={capture} onChange={(e) => setCapture(e.target.value)} placeholder="New idea… (⌘N, Enter)" aria-label="New idea title" />
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
          {!ideas.length && <li className="small muted pad-empty">{filter ? "No matches." : "No ideas yet. Type one above, or drop .md files here."}</li>}
        </ul>
        <label className="import-md small muted">
          <Icon name="plus" size={12} /> Import .md files
          <input type="file" accept=".md,.markdown,.txt,text/markdown" multiple hidden onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.target.value = ""; }} />
        </label>
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

type EditLayout = "write" | "split";
const pref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// Unsaved edits are mirrored to local storage so nothing is lost offline or on quit.
const draftKey = (repo: string, slug: string) => `idea-draft:${repo}/${slug}`;
function readDraft(repo: string, slug: string): Idea | null {
  try { return JSON.parse(localStorage.getItem(draftKey(repo, slug)) ?? "null"); } catch { return null; }
}
function writeDraft(repo: string, d: Idea | null) {
  try {
    if (d) localStorage.setItem(draftKey(repo, d.slug), JSON.stringify(d));
  } catch { /* ignore */ }
}
function clearDraft(repo: string, slug: string) {
  try { localStorage.removeItem(draftKey(repo, slug)); } catch { /* ignore */ }
}

function IdeaEditor({ pad, idea, setPad, onError }: {
  pad: IdeaPad; idea: Idea; setPad: (fn: (p: IdeaPad) => IdeaPad) => void; onError: (m: string | null) => void;
}) {
  const { token, demo, tracked, update } = useApp();
  const [draft, setDraft] = useState<Idea>(() => {
    const local = readDraft(pad.repo, idea.slug);
    return local && (local.body !== idea.body || local.title !== idea.title || local.status !== idea.status || local.tags.join() !== idea.tags.join())
      ? { ...local, sha: idea.sha }
      : idea;
  });
  const [save, setSave] = useState<"saved" | "saving" | "dirty" | "offline" | "error">(() => (draft !== idea ? "dirty" : "saved"));
  const [tab, setTab] = useState<"note" | "plan">("note");
  // Notes open rendered, like a .md file on GitHub; Edit (or double-click) shows the source.
  const [editing, setEditing] = useState(() => focusNext === idea.slug || !idea.body.trim());
  const [layout, setLayoutS] = useState<EditLayout>(() => pref("idea-edit-layout", window.innerWidth > 1180 ? "split" : "write") as EditLayout);
  const setLayout = (l: EditLayout) => { setLayoutS(l); setPref("idea-edit-layout", l); };
  const mode = !editing ? "preview" : layout;
  const caretFor = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncScroll = useCallback((r: number) => {
    const p = previewRef.current;
    if (p) p.scrollTop = r * (p.scrollHeight - p.clientHeight);
  }, []);
  const [planFresh, setPlanFresh] = useState<boolean | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refining, setRefining] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const editor = useRef<MdEditorHandle>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const plan = pad.plans[idea.slug];

  // Autosave 1.2 s after typing stops; retries on its own when offline.
  const schedule = (ms = 1200) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), ms);
  };
  const edit = (patch: Partial<Idea>) => {
    setDraft((d) => {
      const n = { ...d, ...patch };
      writeDraft(pad.repo, n);
      return n;
    });
    setSave("dirty");
    schedule();
  };
  async function flush() {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = latest.current;
    setSave("saving");
    try {
      const saved = demo ? { ...d, raw: serialize(d) } : await saveIdea(token!, pad.repo, d);
      setPad((p) => ({ ...p, ideas: p.ideas.map((i) => (i.slug === d.slug ? saved : i)) }));
      setDraft((cur) => ({ ...cur, sha: saved.sha, raw: saved.raw }));
      if (latest.current.body === d.body && latest.current.title === d.title) {
        clearDraft(pad.repo, d.slug);
        setSave("saved");
      } else setSave("dirty");
      onError(null);
    } catch (e) {
      const msg = (e as Error).message;
      const offline = /fetch|network|load failed|offline|timed out|GitHub 5\d\d/i.test(msg);
      setSave(offline ? "offline" : "error");
      if (!offline) onError(msg);
      schedule(offline ? 15_000 : 60_000);
    }
  }
  useEffect(() => {
    if (draft !== idea) schedule(300); // a restored local draft: sync it
    if (focusNext === idea.slug) {
      focusNext = null;
      setTimeout(() => editor.current?.focus(), 30);
    }
    const onHide = () => { if (timer.current) void flush(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) void flush(); // save pending edits when switching ideas
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘/ or ⌘E-outside-the-editor toggles Read ⇄ Edit; Esc in the editor goes back to Read.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inEditor = (e.target as HTMLElement).classList?.contains("md-input");
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setEditing((v) => !v);
      } else if (e.key === "Escape" && inEditor && draft.body.trim()) {
        setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.body]);

  // Entering Edit from a double-click puts the caret at the text that was clicked.
  useEffect(() => {
    if (!editing) return;
    const want = caretFor.current;
    caretFor.current = null;
    setTimeout(() => editor.current?.focusAt(want ? latest.current.body.indexOf(want) : -1), 20);
  }, [editing]);

  useEffect(() => {
    if (!plan) return setPlanFresh(null);
    void sha256(draft.raw || serialize(draft)).then((h) => setPlanFresh(demo ? true : h === plan.sourceHash));
  }, [plan, draft.raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const onToggleTask = useCallback((n: number) => edit({ body: toggleTask(latest.current.body, n) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => stats(draft.body), [draft.body]);

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
      clearTimeout(timer.current);
      timer.current = undefined;
      if (!demo) await deleteIdea(token!, pad.repo, draft);
      clearDraft(pad.repo, draft.slug);
      setPad((p) => ({ ...p, ideas: p.ideas.filter((i) => i.slug !== draft.slug) }));
      navigate("#/ideas");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const saveLabel =
    save === "saving" ? <><Spinner /> Saving…</>
    : save === "dirty" ? "Editing…"
    : save === "offline" ? <><Icon name="clock" size={12} /> Offline · kept on this Mac, will sync</>
    : save === "error" ? <><Icon name="x" size={12} /> Not saved · retrying</>
    : <><Icon name="check" size={12} /> Saved to GitHub</>;

  return (
    <div className="idea-doc">
      <header className="idea-head">
        <input className="idea-title" value={draft.title} onChange={(e) => edit({ title: e.target.value })} aria-label="Title" placeholder="Untitled idea" />
        <div className="row gap wrap idea-meta">
          <select className="input small" value={draft.status} onChange={(e) => edit({ status: e.target.value as IdeaStatus })} aria-label="Status">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input
            className="input small grow"
            defaultValue={draft.tags.join(", ")}
            onChange={(e) => edit({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            placeholder="Tags, comma separated"
            aria-label="Tags"
          />
          <span className={`save-state ${save}`} title="⌘S saves now">{saveLabel}</span>
        </div>
        <div className="idea-tabs">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === "note"} className={tab === "note" ? "on" : ""} onClick={() => setTab("note")}><Icon name="edit" size={13} /> Note</button>
            <button role="tab" aria-selected={tab === "plan"} className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>
              <Icon name="milestone" size={13} /> Plan{plan ? (planFresh === false ? " ·" : "") : ""}
            </button>
          </div>
          {tab === "note" && (
            <>
              {editing && <MdToolbar editor={editor} />}
              <span className="grow" />
              {editing && (
                <button className={`btn small ghost${layout === "split" ? " on" : ""}`} onClick={() => setLayout(layout === "split" ? "write" : "split")} title="Show the rendered note next to the source">
                  <Icon name="eye" size={13} /> {layout === "split" ? "Hide preview" : "Side-by-side"}
                </button>
              )}
              <button className={`btn small${editing ? " primary" : ""}`} onClick={() => setEditing((v) => !v)} title="⌘/ · Esc returns to the rendered note">
                {editing ? <><Icon name="check" size={13} /> Done</> : <><Icon name="edit" size={13} /> Edit</>}
              </button>
            </>
          )}
        </div>
      </header>

      {tab === "note" ? (
        <>
          <div className={`idea-panes mode-${mode}`}>
            {mode !== "preview" && (
              <MdEditor
                ref={editor}
                value={draft.body}
                onChange={(body) => edit({ body })}
                onSave={() => void flush()}
                onScrollRatio={mode === "split" ? syncScroll : undefined}
                placeholder={"Jot it down — Markdown works.\n\n## Problem\nWhat's annoying or missing?\n\n## Idea\nWhat would the tool do?\n\n## Structure\nInsert → Project structure for a file tree.\n\n- [ ] first step"}
              />
            )}
            {mode !== "write" && (
              <div
                ref={previewRef}
                className={`md-preview${mode === "preview" ? " doc" : ""}`}
                onDoubleClick={(e) => {
                  if (mode !== "preview") return;
                  const t = (e.target as HTMLElement).closest("p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote");
                  const text = t?.textContent?.trim().split("\n")[0].slice(0, 40) ?? "";
                  caretFor.current = text || null;
                  setEditing(true);
                }}
                title={mode === "preview" ? "Double-click to edit" : undefined}
              >
                {draft.body.trim() ? <Markdown source={draft.body} onToggleTask={onToggleTask} className="doc-md" /> : <p className="muted small">Nothing to preview yet.</p>}
              </div>
            )}
          </div>
          <footer className="idea-foot small muted">
            <span>{st.words} words{st.tasks ? ` · ${st.done}/${st.tasks} tasks done` : ""}</span>
            <span className="hide-sm"><code>ideas/{draft.slug}.md</code> · created {draft.created ? ago(draft.created) : "now"}</span>
            <span className="grow" />
            <button className="link small" onClick={() => void navigator.clipboard?.writeText(serialize(draft)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>
              {copied ? "Copied" : "Copy .md"}
            </button>
            <a className="link small" href={`${pad.url}/blob/${pad.branch}/ideas/${draft.slug}.md`} onClick={(e) => { e.preventDefault(); void openUrl(`${pad.url}/blob/${pad.branch}/ideas/${draft.slug}.md`); }}>GitHub</a>
            {confirmDelete ? (
              <span className="row gap">
                Delete?
                <button className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
                <button className="btn small danger-btn" onClick={remove}>Delete</button>
              </span>
            ) : (
              <button className="icon-btn danger" onClick={() => setConfirmDelete(true)} aria-label="Delete idea"><Icon name="trash" size={14} /></button>
            )}
          </footer>
        </>
      ) : (
        <section className="idea-plan">
          <header className="row between gap wrap">
            <div className="small muted plan-meta">
              {plan ? <>Refined {ago(plan.refinedAt)} · {plan.model}</> : "No plan yet"}
              {planFresh === false && <span className="pill overdue"><Icon name="clock" size={11} /> Idea changed. Refines at the next daily run.</span>}
              {planFresh === true && <span className="pill okp"><Icon name="check" size={11} /> Up to date</span>}
            </div>
            <button className="btn small" onClick={doRefine} disabled={refining || pad.lastRun?.status === "queued" || pad.lastRun?.status === "in_progress"}>
              <Icon name="refresh" size={13} className={refining ? "spin" : ""} /> Refine now
            </button>
          </header>
          {plan ? (
            <>
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
              <div className="md-preview doc plan-doc"><Markdown source={plan.body} className="doc-md" /></div>
            </>
          ) : (
            <Empty icon="milestone" title="No plan yet">
              <p className="muted small">The planner runs every morning and picks up new ideas automatically. Press “Refine now” to plan this one right away (takes about a minute).</p>
            </Empty>
          )}
        </section>
      )}
    </div>
  );
}

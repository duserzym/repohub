import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, Spinner } from "../components/bits";
import { Icon } from "../components/Icon";
import { slug, UNCATEGORIZED } from "../lib/categories";
import { ago, num } from "../lib/format";
import { searchRepos, type SearchOptions } from "../lib/github";
import { openUrl } from "../lib/platform";
import { useApp } from "../lib/state";
import type { SearchResult } from "../lib/types";

const EXTRA_PRESETS = ["topic:paleomagnetism", "topic:seismology", "topic:geochronology", "topic:mass-spectrometry", "topic:pygmt", "topic:earth-science"];

const DEMO_RESULTS: SearchResult[] = [
  { id: 1, fullName: "example/isotope-toolkit", owner: "example", ownerAvatar: "", description: "Sample result — sign in to search GitHub live", url: "https://github.com/", stars: 312, forks: 40, language: "Python", topics: ["geochemistry", "isotopes"], license: "MIT", pushedAt: new Date().toISOString(), archived: false, isTemplate: false, openIssues: 12 },
  { id: 2, fullName: "example/seismo-notebooks", owner: "example", ownerAvatar: "", description: "Sample result — teaching notebooks for seismology", url: "https://github.com/", stars: 128, forks: 22, language: "Jupyter Notebook", topics: ["geophysics", "seismology"], license: "BSD-3-Clause", pushedAt: new Date(Date.now() - 20 * 864e5).toISOString(), archived: false, isTemplate: true, openIssues: 3 },
];

export function Discover() {
  const { token, demo, categories, tracked, update } = useApp();
  const [input, setInput] = useState("");
  const [opts, setOpts] = useState<SearchOptions>({ query: "", sort: "stars", activeOnly: true, licensed: true, minStars: 5, language: "", page: 1 });
  const [assignTo, setAssignTo] = useState<string>(categories[0]?.id ?? UNCATEGORIZED);

  const enabled = !!opts.query;
  const q = useQuery({
    queryKey: ["search", opts, demo],
    enabled,
    queryFn: () => (demo ? Promise.resolve({ total: DEMO_RESULTS.length, items: DEMO_RESULTS }) : searchRepos(token, opts)),
    staleTime: 5 * 60_000,
  });

  const run = (query: string) => {
    setInput(query);
    setOpts((o) => ({ ...o, query, page: 1 }));
  };
  const isTracked = (n: string) => tracked.some((t) => t.toLowerCase() === n.toLowerCase());
  const track = (r: SearchResult) => {
    if (isTracked(r.fullName)) {
      update("tracked", (t) => t.filter((x) => x.toLowerCase() !== r.fullName.toLowerCase()));
    } else {
      update("tracked", (t) => [...t, r.fullName]);
      if (assignTo) update("assignments", (a) => ({ ...a, [r.fullName]: assignTo }));
    }
  };

  const presets = [...categories.map((c) => `topic:${slug(c.name)}`), ...EXTRA_PRESETS];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <div className="muted small">Search GitHub for ready-to-use projects and track them alongside your own.</div>
        </div>
      </header>

      <form className="discover-bar card" onSubmit={(e) => { e.preventDefault(); run(input); }}>
        <div className="search-box big">
          <Icon name="search" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. zircon U-Pb, paleomagnetism, topic:geophysics" aria-label="Search GitHub" />
        </div>
        <button className="btn primary" type="submit">Search</button>
      </form>

      <div className="row gap wrap presets">
        {presets.map((p) => (
          <button key={p} className={`chip button${opts.query === p ? " on" : ""}`} onClick={() => run(p)}>{p.replace("topic:", "#")}</button>
        ))}
      </div>

      <div className="filters row gap wrap small">
        <label className="check"><input type="checkbox" checked={opts.activeOnly} onChange={(e) => setOpts((o) => ({ ...o, activeOnly: e.target.checked, page: 1 }))} /> Updated in last year</label>
        <label className="check"><input type="checkbox" checked={opts.licensed} onChange={(e) => setOpts((o) => ({ ...o, licensed: e.target.checked }))} /> Has open-source license</label>
        <label className="row gap-s">Min ★
          <select className="input small" value={opts.minStars} onChange={(e) => setOpts((o) => ({ ...o, minStars: +e.target.value, page: 1 }))}>
            {[0, 5, 25, 100, 500].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="row gap-s">Language
          <select className="input small" value={opts.language} onChange={(e) => setOpts((o) => ({ ...o, language: e.target.value, page: 1 }))}>
            {["", "Python", "Jupyter Notebook", "R", "Julia", "MATLAB", "JavaScript", "TypeScript", "C++", "Fortran", "Rust"].map((l) => <option key={l} value={l}>{l || "Any"}</option>)}
          </select>
        </label>
        <label className="row gap-s">Sort
          <select className="input small" value={opts.sort} onChange={(e) => setOpts((o) => ({ ...o, sort: e.target.value as SearchOptions["sort"], page: 1 }))}>
            <option value="stars">Stars</option>
            <option value="updated">Recently updated</option>
            <option value="best-match">Best match</option>
          </select>
        </label>
        <span className="grow" />
        <label className="row gap-s">Track into
          <select className="input small" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={UNCATEGORIZED}>Uncategorized</option>
          </select>
        </label>
      </div>

      {!enabled && <Empty icon="search" title="Find projects to reuse"><p className="muted small">Pick a topic above or type a search. Tracked repos appear on your dashboard with live progress.</p></Empty>}
      {q.isLoading && enabled && <div className="center-fill"><Spinner /></div>}
      {q.error && <p className="error">{(q.error as Error).message}{!token && " — sign in for higher search limits."}</p>}

      {q.data && (
        <>
          <p className="small muted">{num(q.data.total)} repositories</p>
          <ul className="results">
            {q.data.items.map((r) => (
              <li key={r.id} className="card result">
                {r.ownerAvatar ? <img className="avatar lg" src={r.ownerAvatar} alt="" /> : <span className="avatar-fallback lg">{r.owner[0]}</span>}
                <div className="grow">
                  <a href={r.url} onClick={(e) => { e.preventDefault(); void openUrl(r.url); }}><strong>{r.fullName}</strong></a>
                  {r.isTemplate && <span className="chip tiny">template</span>}
                  <p className="small">{r.description}</p>
                  <div className="row gap wrap small muted">
                    <span><Icon name="star" size={12} /> {num(r.stars)}</span>
                    <span><Icon name="fork" size={12} /> {num(r.forks)}</span>
                    {r.language && <span>{r.language}</span>}
                    {r.license && <span>{r.license}</span>}
                    <span>updated {ago(r.pushedAt)}</span>
                    {r.topics.slice(0, 4).map((t) => <span key={t} className="chip tiny">{t}</span>)}
                  </div>
                </div>
                <button className={`btn${isTracked(r.fullName) ? "" : " primary"}`} onClick={() => track(r)}>
                  {isTracked(r.fullName) ? <><Icon name="check" /> Tracking</> : <><Icon name="plus" /> Track</>}
                </button>
              </li>
            ))}
          </ul>
          <div className="row gap center">
            <button className="btn" disabled={opts.page <= 1} onClick={() => setOpts((o) => ({ ...o, page: o.page - 1 }))}>Previous</button>
            <span className="small muted">Page {opts.page}</span>
            <button className="btn" disabled={q.data.items.length < 20} onClick={() => setOpts((o) => ({ ...o, page: o.page + 1 }))}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

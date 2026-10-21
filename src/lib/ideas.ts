// Idea Pad: project ideas stored as Markdown in a private GitHub repo
// (<you>/repohub-ideas), edited in RepoHub with autosave, and refined into
// development plans by a daily GitHub Action that lives in that repo.

import refineScript from "../ideapad/refine.mjs?raw";
import refineWorkflow from "../ideapad/refine-plans.yml?raw";
import { AuthError, gql } from "./github";
import { httpFetch } from "./platform";

export const IDEAS_REPO = "repohub-ideas";
const API = "https://api.github.com";
const TEMPLATE_VERSION = "repohub-ideas planner v1";

export type IdeaStatus = "idea" | "planning" | "active" | "archived";

export interface Idea {
  slug: string;
  sha: string | null; // blob sha on GitHub (null = not saved yet)
  title: string;
  tags: string[];
  status: IdeaStatus;
  created: string;
  body: string;
  raw: string; // exact file text (the planner hashes this)
}

export interface Plan {
  slug: string;
  body: string;
  sourceHash: string;
  model: string;
  refinedAt: string;
  related: string[];
}

export interface IdeaPad {
  repo: string; // owner/name
  url: string;
  branch: string;
  ideas: Idea[];
  plans: Record<string, Plan>;
  lastRun: { status: string; conclusion: string | null; url: string; createdAt: string } | null;
  templateCurrent: boolean;
}

// ---------------------------------------------------------------- helpers

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T; headers: Headers }> {
  const res = await httpFetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401) throw new AuthError("GitHub token is invalid or expired");
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

function b64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugify(title: string) {
  return (
    title.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) ||
    `idea-${Date.now()}`
  );
}

// Minimal front matter (the planner script uses the same format).
function parse(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1]] =
      v.startsWith("[") && v.endsWith("]")
        ? v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : v.replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

export function serialize(i: Pick<Idea, "title" | "tags" | "status" | "created" | "body">) {
  const y = (v: string | string[]) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v));
  return `---\ntitle: ${y(i.title)}\ntags: ${y(i.tags)}\nstatus: ${y(i.status)}\ncreated: ${y(i.created)}\n---\n\n${i.body.trim()}\n`;
}

function toIdea(slug: string, sha: string, raw: string): Idea {
  const { meta, body } = parse(raw);
  const s = String(meta.status ?? "idea") as IdeaStatus;
  return {
    slug,
    sha,
    raw,
    title: String(meta.title ?? slug),
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [String(meta.tags)] : [],
    status: (["idea", "planning", "active", "archived"] as const).includes(s) ? s : "idea",
    created: String(meta.created ?? ""),
    body: body.replace(/^\n+/, ""),
  };
}

function toPlan(slug: string, raw: string): Plan {
  const { meta, body } = parse(raw);
  return {
    slug,
    body: body.trim(),
    sourceHash: String(meta.source_hash ?? ""),
    model: String(meta.model ?? ""),
    refinedAt: String(meta.refined_at ?? ""),
    related: Array.isArray(meta.related) ? meta.related : [],
  };
}

// ---------------------------------------------------------------- reading

const PAD_QUERY = `
query Pad($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    url defaultBranchRef { name }
    ideas: object(expression: "HEAD:ideas") { ... on Tree { entries { name oid object { ... on Blob { text } } } } }
    plans: object(expression: "HEAD:plans") { ... on Tree { entries { name object { ... on Blob { text } } } } }
    script: object(expression: "HEAD:scripts/refine.mjs") { ... on Blob { text } }
  }
}`;

export const PAD_QUERIES = { pad: PAD_QUERY };

/** Returns null when the Idea Pad repo doesn't exist yet. */
export async function loadPad(token: string, login: string): Promise<IdeaPad | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const data = await gql<any>(token, PAD_QUERY, { owner: login, name: IDEAS_REPO });
  const r = data?.repository;
  if (!r) return null;
  const ideas: Idea[] = (r.ideas?.entries ?? [])
    .filter((e: any) => e.name.endsWith(".md") && typeof e.object?.text === "string")
    .map((e: any) => toIdea(e.name.replace(/\.md$/, ""), e.oid, e.object.text));
  const plans: Record<string, Plan> = {};
  for (const e of r.plans?.entries ?? []) {
    if (e.name.endsWith(".md") && typeof e.object?.text === "string") {
      const slug = e.name.replace(/\.md$/, "");
      plans[slug] = toPlan(slug, e.object.text);
    }
  }
  const runs = await api<any>(token, `/repos/${login}/${IDEAS_REPO}/actions/workflows/refine-plans.yml/runs?per_page=1`).catch(() => null);
  const run = runs?.status === 200 ? runs.data.workflow_runs?.[0] : null;
  return {
    repo: `${login}/${IDEAS_REPO}`,
    url: r.url,
    branch: r.defaultBranchRef?.name ?? "main",
    ideas: ideas.sort((a, b) => (b.created || "").localeCompare(a.created || "")),
    plans,
    lastRun: run ? { status: run.status, conclusion: run.conclusion, url: run.html_url, createdAt: run.created_at } : null,
    templateCurrent: typeof r.script?.text === "string" && r.script.text.includes(TEMPLATE_VERSION),
  };
}

// ---------------------------------------------------------------- writing

async function putFile(token: string, repo: string, path: string, content: string, message: string, sha?: string | null) {
  const res = await api<any>(token, `/repos/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64(content), ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) {
    // Changed elsewhere (e.g. edited on GitHub): retry on top of the latest version.
    const cur = await api<any>(token, `/repos/${repo}/contents/${path}`);
    if (cur.status === 200 && cur.data.sha !== sha) return putFile(token, repo, path, content, message, cur.data.sha);
  }
  if ((res.status === 404 || res.status === 403) && path.startsWith(".github/workflows/")) throw new ScopeError();
  if (res.status >= 300) throw new Error(res.data?.message ?? `GitHub ${res.status}`);
  return res.data.content.sha as string;
}

export class ScopeError extends Error {
  constructor() {
    super("RepoHub needs one more GitHub permission (workflow) to set up the daily planner. Sign out and sign in again, then retry.");
  }
}

const WELCOME = serialize({
  title: "RepoHub: shared lab dashboards",
  tags: ["dashboard", "github", "collaboration"],
  status: "idea",
  created: new Date().toISOString(),
  body: `An example idea — edit or delete it.

Let lab members share one RepoHub dashboard: a common set of categories, pinned repos and milestones for the group's software, so everyone sees the same progress view.

- Who uses it: students and postdocs in the lab
- Must have: shared categories, read-only for viewers
- Nice to have: weekly digest email`,
});

/** Creates <login>/repohub-ideas (private) with the planner, or updates an outdated planner. */
export async function setupPad(token: string, login: string, existing: IdeaPad | null): Promise<void> {
  const repo = `${login}/${IDEAS_REPO}`;
  if (!existing) {
    const created = await api<any>(token, `/user/repos`, {
      method: "POST",
      body: JSON.stringify({
        name: IDEAS_REPO,
        private: true,
        auto_init: true,
        description: "Idea Pad for RepoHub — project ideas with auto-refined development plans",
      }),
    });
    if (created.status >= 300 && created.status !== 422) throw new Error(created.data?.message ?? `GitHub ${created.status}`);
    await new Promise((r) => setTimeout(r, 1500)); // let GitHub finish the initial commit
  }
  const shaOf = async (path: string) => {
    const r = await api<any>(token, `/repos/${repo}/contents/${path}`);
    return r.status === 200 ? (r.data.sha as string) : null;
  };
  await putFile(token, repo, "scripts/refine.mjs", refineScript, "Set up RepoHub planner", await shaOf("scripts/refine.mjs"));
  await putFile(token, repo, ".github/workflows/refine-plans.yml", refineWorkflow, "Set up daily plan refinement", await shaOf(".github/workflows/refine-plans.yml"));
  if (!existing) await putFile(token, repo, `ideas/${slugify("RepoHub shared lab dashboards")}.md`, WELCOME, "Add example idea");
}

export async function saveIdea(token: string, repo: string, idea: Idea): Promise<Idea> {
  const raw = serialize(idea);
  const sha = await putFile(token, repo, `ideas/${idea.slug}.md`, raw, `${idea.sha ? "Update" : "Add"} idea: ${idea.title}`, idea.sha);
  return { ...idea, sha, raw };
}

export async function deleteIdea(token: string, repo: string, idea: Idea) {
  if (!idea.sha) return;
  const res = await api<any>(token, `/repos/${repo}/contents/ideas/${idea.slug}.md`, {
    method: "DELETE",
    body: JSON.stringify({ message: `Remove idea: ${idea.title}`, sha: idea.sha }),
  });
  if (res.status >= 300) throw new Error(res.data?.message ?? `GitHub ${res.status}`);
}

/** Starts the planner now instead of waiting for the daily run. */
export async function refineNow(token: string, pad: IdeaPad, only?: string) {
  const res = await api<any>(token, `/repos/${pad.repo}/actions/workflows/refine-plans.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: pad.branch, inputs: { force: false, only: only ?? "" } }),
  });
  if (res.status >= 300) throw new Error(res.data?.message ?? `GitHub ${res.status}`);
}

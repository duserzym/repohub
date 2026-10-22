import { httpFetch } from "./platform";
import type { CheckState, Repo, SearchResult, Settings, Viewer } from "./types";
import { ITEM_FRAGMENTS, mapItem, type WorkItem } from "./workitems";

const API = "https://api.github.com";

export class AuthError extends Error {}

export interface RateLimit {
  remaining: number;
  limit: number;
  resetAt: string;
}

function headers(token: string | null, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Thrown when GitHub took too long or answered 502/504 — retry with a smaller request. */
export class SlowError extends Error {}

export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await httpFetch(`${API}/graphql`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal,
    });
  } catch (e) {
    if (ctl.signal.aborted) throw new SlowError("GitHub took too long to respond");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new AuthError("GitHub token is invalid or expired");
  if (res.status === 502 || res.status === 504) throw new SlowError(`GitHub ${res.status}`);
  const json = await res.json();
  if (json.errors && !json.data && json.errors.some((e: { message: string }) => /timeout|timed out|something went wrong/i.test(e.message)))
    throw new SlowError(json.errors[0].message);
  // Partial errors (e.g. one tracked repo deleted) still return usable data.
  if (json.errors && !json.data) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  if (json.errors) console.warn("GraphQL partial errors", json.errors);
  return json.data as T;
}

export async function rest<T>(token: string | null, path: string, accept?: string): Promise<T> {
  const res = await httpFetch(path.startsWith("http") ? path : `${API}${path}`, { headers: headers(token, accept) });
  if (res.status === 401) throw new AuthError("GitHub token is invalid or expired");
  if (!res.ok) {
    let msg = `GitHub ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Repository list (dashboard)
// ---------------------------------------------------------------------------

export const WEEKS = 12;
// Common places for a logo (fetched in the parallel detail phase, so cheap).
const ICON_DIRS = ["", ".github", "assets", "docs", "images", "public", "img", "static", "site"] as const;
const WEEK_MS = 7 * 864e5;
const treeAlias = (dir: string) => `tree_${dir.replace(/[^a-z]/gi, "") || "root"}`;

// Two-phase loading:
//  1. RepoLight: cheap fields for up to 100 repos per request, so the dashboard appears fast.
//  2. RepoHeavy: milestones, CI, commit history and icon lookups, fetched for small
//     batches of repos by id, several requests in parallel.
const LIGHT_FIELDS = `
fragment RepoLight on Repository {
  id nameWithOwner name description url homepageUrl isPrivate isFork isArchived
  stargazerCount forkCount pushedAt updatedAt createdAt
  owner { login avatarUrl }
  primaryLanguage { name color }
  repositoryTopics(first: 12) { nodes { topic { name } } }
  openGraphImageUrl usesCustomOpenGraphImage
  openIssues: issues(states: OPEN) { totalCount }
  closedIssues: issues(states: CLOSED) { totalCount }
  openPRs: pullRequests(states: OPEN) { totalCount }
  mergedPRs: pullRequests(states: MERGED) { totalCount }
  latestRelease { name tagName publishedAt url }
  defaultBranchRef { name }
}`;

const HEAVY_FIELDS = `
fragment RepoHeavy on Repository {
  id
  milestones(states: OPEN, first: 3, orderBy: {field: DUE_DATE, direction: ASC}) {
    nodes { title url dueOn progressPercentage
      open: issues(states: OPEN) { totalCount } closed: issues(states: CLOSED) { totalCount } }
  }
  defaultBranchRef { name target { ... on Commit {
    oid committedDate messageHeadline
    statusCheckRollup {
      state
      contexts(first: 60) { nodes {
        __typename
        ... on CheckRun { name status conclusion startedAt checkSuite { workflowRun { workflow { name } } } }
        ... on StatusContext { context state createdAt }
      } }
    }
    recent: history(first: 100, since: $since) { totalCount nodes { committedDate } }
  } } }
  ${ICON_DIRS.map((d) => `${treeAlias(d)}: object(expression: "HEAD:${d}") { ... on Tree { entries { name type } } }`).join("\n  ")}
}`;

const HEAVY_QUERY = `
query Heavy($ids: [ID!]!, $since: GitTimestamp!) {
  nodes(ids: $ids) { ... on Repository { ...RepoHeavy } }
}
${HEAVY_FIELDS}`;

function weekVars(): Record<string, string> {
  return { since: new Date(Date.now() - WEEKS * WEEK_MS).toISOString() };
}

/** Bucket recent commit dates into weekly counts, oldest → newest. */
function weeklyCounts(recent: { totalCount: number; nodes: { committedDate: string }[] } | undefined): number[] {
  const out = new Array(WEEKS).fill(0);
  if (!recent) return out;
  const now = Date.now();
  for (const n of recent.nodes) {
    const age = Math.floor((now - new Date(n.committedDate).getTime()) / WEEK_MS);
    if (age >= 0 && age < WEEKS) out[WEEKS - 1 - age]++;
  }
  // Very busy repos: only the newest 100 commits come back; scale the rest so the total matches.
  const seen = recent.nodes.length;
  if (recent.totalCount > seen && seen > 0) {
    const oldest = recent.nodes[seen - 1].committedDate;
    const covered = Math.min(WEEKS, Math.ceil((now - new Date(oldest).getTime()) / WEEK_MS));
    const missing = recent.totalCount - seen;
    const rest = WEEKS - covered;
    if (rest > 0) for (let i = 0; i < rest; i++) out[i] += Math.round(missing / rest);
  }
  return out;
}

const LIST_QUERY = `
query Repos($cursor: String, $first: Int!, $aff: [RepositoryAffiliation], $isFork: Boolean) {
  rateLimit { remaining limit resetAt }
  viewer {
    login name avatarUrl
    repositories(first: $first, after: $cursor, affiliations: $aff, ownerAffiliations: $aff, isFork: $isFork,
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...RepoLight }
    }
  }
}
${LIGHT_FIELDS}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRepo(n: any, tracked = false): Repo {
  const c = n.defaultBranchRef?.target;
  const weekly = weeklyCounts(c?.recent);
  const files: { path: string; dir: string; name: string }[] = [];
  for (const d of ICON_DIRS) {
    for (const e of n[treeAlias(d)]?.entries ?? []) {
      if (e.type === "blob") files.push({ dir: d, name: e.name, path: d ? `${d}/${e.name}` : e.name });
    }
  }
  return {
    id: n.id,
    nameWithOwner: n.nameWithOwner,
    owner: n.owner.login,
    ownerAvatar: n.owner.avatarUrl,
    name: n.name,
    description: n.description ?? "",
    url: n.url,
    homepageUrl: n.homepageUrl || null,
    isPrivate: n.isPrivate,
    isFork: n.isFork,
    isArchived: n.isArchived,
    stars: n.stargazerCount,
    forks: n.forkCount,
    pushedAt: n.pushedAt,
    createdAt: n.createdAt,
    language: n.primaryLanguage,
    topics: (n.repositoryTopics?.nodes ?? []).map((t: any) => t.topic.name),
    openIssues: n.openIssues.totalCount,
    closedIssues: n.closedIssues.totalCount,
    openPRs: n.openPRs.totalCount,
    mergedPRs: n.mergedPRs.totalCount,
    milestones: (n.milestones?.nodes ?? []).map((m: any) => ({
      title: m.title,
      url: m.url,
      dueOn: m.dueOn,
      progress: Math.round(m.progressPercentage ?? 0),
      open: m.open.totalCount,
      closed: m.closed.totalCount,
    })),
    latestRelease: n.latestRelease
      ? { name: n.latestRelease.name || n.latestRelease.tagName, tag: n.latestRelease.tagName, publishedAt: n.latestRelease.publishedAt, url: n.latestRelease.url }
      : null,
    defaultBranch: n.defaultBranchRef?.name ?? null,
    lastCommit: c ? { oid: c.oid, date: c.committedDate, message: c.messageHeadline } : null,
    ...ciFromRollup(c?.statusCheckRollup),
    weekly,
    iconPaths: rankIconFiles(files),
    socialImage: n.usesCustomOpenGraphImage ? n.openGraphImageUrl : null,
    tracked,
    enriched: !!c,
    sig: [n.pushedAt, n.updatedAt, n.openIssues.totalCount, n.closedIssues.totalCount, n.openPRs.totalCount, n.mergedPRs.totalCount].join("|"),
  };
}

/**
 * CI state from the latest run of each check, instead of GitHub's rollup.
 * GitHub's rollup turns red when an *older* run was cancelled (e.g. a deploy
 * superseded by a newer one), even though every latest run passed.
 */
export function ciFromRollup(rollup: any): { ci: CheckState; ciFailing?: string[] } {
  const nodes: any[] = rollup?.contexts?.nodes ?? [];
  if (!rollup) return { ci: null };
  if (!nodes.length) return { ci: (rollup.state ?? null) as CheckState };
  const latest = new Map<string, { at: string; state: "ok" | "bad" | "run" | "ignore"; label: string }>();
  for (const n of nodes) {
    let key: string, at: string, state: "ok" | "bad" | "run" | "ignore", label: string;
    if (n.__typename === "CheckRun") {
      const wf = n.checkSuite?.workflowRun?.workflow?.name;
      label = wf ? `${wf} / ${n.name}` : n.name;
      key = label;
      at = n.startedAt ?? "";
      if (n.status !== "COMPLETED") state = "run";
      else if (["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(n.conclusion)) state = "bad";
      else if (n.conclusion === "SUCCESS") state = "ok";
      else state = "ignore"; // CANCELLED, SKIPPED, NEUTRAL, STALE
    } else {
      label = key = n.context;
      at = n.createdAt ?? "";
      state = n.state === "SUCCESS" ? "ok" : n.state === "PENDING" || n.state === "EXPECTED" ? "run" : "bad";
    }
    const prev = latest.get(key);
    // Keep the newest run; a cancelled/skipped run never replaces a real result.
    if (!prev || (state !== "ignore" && (prev.state === "ignore" || at >= prev.at))) latest.set(key, { at, state, label });
  }
  const vals = [...latest.values()];
  const failing = vals.filter((v) => v.state === "bad").map((v) => v.label);
  if (failing.length) return { ci: "FAILURE", ciFailing: failing };
  if (vals.some((v) => v.state === "run")) return { ci: "PENDING" };
  if (vals.some((v) => v.state === "ok")) return { ci: "SUCCESS" };
  return { ci: null };
}

/** Pick likely logo/icon files from a repo's top-level folders. */
export function rankIconFiles(files: { path: string; dir: string; name: string }[]): string[] {
  const extScore: Record<string, number> = { png: 5, svg: 4, webp: 3, jpg: 2, jpeg: 2, ico: 1 };
  const dirScore: Record<string, number> = { ".github": 4, "": 3, assets: 2, public: 1, docs: 0, images: 0, img: 0, static: 0, site: 0 };
  const scored = files
    .map((f) => {
      const m = f.name.toLowerCase().match(/^(.*)\.(png|svg|webp|jpe?g|ico)$/);
      if (!m) return null;
      const base = m[1];
      let s = 0;
      if (["icon", "app-icon", "appicon", "app_icon"].includes(base)) s = 100;
      else if (base === "logo") s = 95;
      else if (/^(logo|icon)[-_.@]?(\d+|small|square|mark|light|dark|color|x\d+)/.test(base)) s = 85;
      else if (base === "favicon") s = 75;
      else if (/logo/.test(base)) s = 70;
      else if (/(^|[-_])icon($|[-_])/.test(base)) s = 65;
      else return null;
      if (/dark|white|inverse|banner|wide/.test(base)) s -= 10;
      return { path: f.path, s: s + extScore[m[2]] + (dirScore[f.dir] ?? 0) };
    })
    .filter((x): x is { path: string; s: number } => !!x)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, 3).map((x) => x.path);
}

export interface SyncStats {
  ms: number;
  /** repos whose details were unchanged and reused from the last sync */
  reused?: number;
  requests: number;
  slowRetries: number;
  pageSize: number;
}

/** Bump when the detail fields change, so cached details are re-fetched once. */
const DETAILS_SCHEMA = 2;

export interface RepoListResult {
  schema?: number;
  stats?: SyncStats;
  /** when every repo's details were last fetched (drives periodic full refresh) */
  fullDetailsAt?: string;
  viewer: Viewer;
  repos: Repo[];
  totalCount: number;
  rateLimit: RateLimit;
  fetchedAt: string;
}

export interface LoadProgress {
  phase: "list" | "details";
  done: number;
  total: number;
}

/**
 * Loads repositories in two phases (see LIGHT_FIELDS / HEAVY_FIELDS).
 * `onProgress` receives each partial result so the dashboard renders immediately
 * and fills in progress, CI and activity as the parallel detail requests finish.
 */
/** Repos whose details must be re-fetched even if nothing visible changed. */
function needsDetails(prev: Repo | undefined, sig: string, prevAge: number): boolean {
  if (!prev?.enriched || prev.sig !== sig) return true;
  if (prev.ci === "PENDING" || prev.ci === "EXPECTED") return true; // checks still running
  if (prev.pushedAt && Date.now() - new Date(prev.pushedAt).getTime() < 3600e3) return true; // recent push: CI may update
  return prevAge > 6 * 3600e3; // full detail refresh a few times a day (weekly buckets roll over)
}

export async function fetchRepos(
  token: string,
  settings: Settings,
  trackedNames: string[],
  onProgress?: (partial: RepoListResult, p: LoadProgress) => void,
  previous?: RepoListResult,
): Promise<RepoListResult> {
  const t0 = performance.now();
  const stats: SyncStats = { ms: 0, requests: 0, slowRetries: 0, pageSize: 0 };
  const raw = new Map<string, any>(); // id → merged GraphQL node
  const order: string[] = [];
  const trackedIds = new Set<string>();
  let viewer: Viewer | null = null;
  let rateLimit: RateLimit = { remaining: 0, limit: 0, resetAt: "" };
  let totalCount = 0;

  // Incremental refresh: unchanged repos keep their previous details, so a
  // refresh is usually a single cheap list request.
  const prevById = new Map((previous?.repos ?? []).map((r) => [r.id, r]));
  const prevAge =
    previous && previous.schema === DETAILS_SCHEMA ? Date.now() - new Date(previous.fullDetailsAt ?? previous.fetchedAt).getTime() : Infinity;
  const reuse = new Map<string, Repo>();
  const fresh = (r: Repo): Repo => {
    const old = reuse.get(r.id);
    return old && !r.enriched
      ? { ...r, milestones: old.milestones, lastCommit: old.lastCommit, ci: old.ci, ciFailing: old.ciFailing, weekly: old.weekly, iconPaths: old.iconPaths, defaultBranch: old.defaultBranch ?? r.defaultBranch, enriched: true }
      : r;
  };
  let fullDetailsAt = previous?.fullDetailsAt ?? previous?.fetchedAt;

  const result = (): RepoListResult => {
    const repos = order
      .map((id) => fresh(mapRepo(raw.get(id), trackedIds.has(id))))
      .filter((r) => !(r.name === "repohub-ideas" && r.owner === viewer?.login)); // the Idea Pad has its own page
    return {
      stats: { ...stats, ms: Math.round(performance.now() - t0) },
      viewer: viewer!,
      repos: settings.includeArchived ? repos : repos.filter((r) => !r.isArchived || r.tracked),
      totalCount,
      rateLimit,
      fetchedAt: new Date().toISOString(),
      fullDetailsAt,
      schema: DETAILS_SCHEMA,
    };
  };
  const add = (n: any, tracked = false) => {
    if (!n || raw.has(n.id)) return;
    raw.set(n.id, n);
    order.push(n.id);
    if (tracked) trackedIds.add(n.id);
  };

  // ---- phase 1: the list (cheap, 100 per request) ----
  let cursor: string | null = null;
  let pageSize = Math.min(100, settings.maxRepos);
  // Note: a plain do/while with `continue` would jump to the loop condition and,
  // on the first page (cursor still null), quit with no repos and no viewer.
  for (;;) {
    let data: any;
    stats.requests++;
    try {
      data = await gql(token, LIST_QUERY, {
        cursor,
        first: Math.min(pageSize, settings.maxRepos - order.length),
        aff: settings.affiliations,
        isFork: settings.includeForks ? null : false,
      });
    } catch (e) {
      if (e instanceof SlowError && pageSize > 10) {
        stats.slowRetries++;
        pageSize = Math.max(10, Math.floor(pageSize / 2));
        continue; // retry the same page, smaller
      }
      throw e;
    }
    if (!data?.viewer?.repositories) throw new Error("GitHub returned an incomplete repository list");
    viewer = { login: data.viewer.login, name: data.viewer.name, avatarUrl: data.viewer.avatarUrl };
    rateLimit = data.rateLimit ?? rateLimit;
    const conn = data.viewer.repositories;
    totalCount = Math.min(conn.totalCount, settings.maxRepos);
    conn.nodes.forEach((n: any) => add(n));
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    onProgress?.(result(), { phase: "list", done: order.length, total: totalCount });
    if (!cursor || order.length >= settings.maxRepos) break;
  }

  const own = new Set(order.map((id) => raw.get(id).nameWithOwner.toLowerCase()));
  const extra = trackedNames.filter((n) => !own.has(n.toLowerCase()));
  if (extra.length) {
    stats.requests += Math.ceil(extra.length / 20);
    (await fetchTrackedLight(token, extra)).forEach((n) => add(n, true));
  }

  // ---- phase 2: details, in parallel batches — only for repos that changed ----
  const stale: string[] = [];
  for (const id of order) {
    const light = mapRepo(raw.get(id));
    const prev = prevById.get(id);
    if (needsDetails(prev, light.sig!, prevAge)) stale.push(id);
    else reuse.set(id, prev!);
  }
  if (stale.length === order.length) fullDetailsAt = new Date().toISOString();
  stats.reused = reuse.size;
  const BATCH = 8;
  const PARALLEL = 4;
  stats.pageSize = BATCH;
  const queue: string[][] = [];
  for (let i = 0; i < stale.length; i += BATCH) queue.push(stale.slice(i, i + BATCH));
  if (stale.length) onProgress?.(result(), { phase: "details", done: 0, total: stale.length });
  const vars = weekVars();
  let done = 0;
  let lastEmit = 0;
  const worker = async () => {
    for (let ids = queue.shift(); ids; ids = queue.shift()) {
      stats.requests++;
      try {
        const data: any = await gql(token, HEAVY_QUERY, { ...vars, ids });
        for (const h of data.nodes ?? []) if (h?.id && raw.has(h.id)) raw.set(h.id, { ...raw.get(h.id), ...h });
        done += ids.length;
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (e instanceof SlowError && ids.length > 1) {
          stats.slowRetries++;
          const mid = Math.ceil(ids.length / 2);
          queue.push(ids.slice(0, mid), ids.slice(mid)); // split and try again
          continue;
        }
        console.warn("details failed for", ids, e);
        done += ids.length; // keep the light data for these repos
      }
      // Re-render at most every 400 ms while details stream in.
      if (performance.now() - lastEmit > 400 || done >= stale.length) {
        lastEmit = performance.now();
        onProgress?.(result(), { phase: "details", done, total: stale.length });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return result();
}

function trackedQuery(n: number) {
  const defs = Array.from({ length: n }, (_, j) => `$o${j}: String!, $n${j}: String!`).join(", ");
  const body = Array.from({ length: n }, (_, j) => `r${j}: repository(owner: $o${j}, name: $n${j}) { ...RepoLight }`).join("\n");
  return `query Tracked(${defs}) {\n${body}\n}\n${LIGHT_FIELDS}`;
}

async function fetchTrackedLight(token: string, names: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
    const v: Record<string, string> = {};
    chunk.forEach((full, j) => {
      const [o, n] = full.split("/");
      v[`o${j}`] = o;
      v[`n${j}`] = n;
    });
    const data: any = await gql(token, trackedQuery(chunk.length), v);
    chunk.forEach((_, j) => data[`r${j}`] && out.push(data[`r${j}`]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repository detail
// ---------------------------------------------------------------------------

export interface RepoDetail {
  languages: { name: string; color: string; size: number }[];
  issues: WorkItem[];
  pulls: WorkItem[];
  milestones: { title: string; url: string; state: string; dueOn: string | null; progress: number; open: number; closed: number; description: string }[];
  commits: { oid: string; message: string; url: string; date: string; author: string; avatar: string | null; checks: CheckState }[];
  releases: { name: string; tag: string; url: string; publishedAt: string; isPrerelease: boolean; isLatest: boolean }[];
  runs: { id: number; name: string; title: string; status: string; conclusion: string | null; url: string; branch: string; event: string; createdAt: string }[];
  totalCommits: number;
}

const DETAIL_QUERY = `
query Detail($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    languages(first: 8, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
    issues(states: OPEN, first: 40, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...IssueItem } }
    pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...PRItem } }
    milestones(first: 20, orderBy: {field: DUE_DATE, direction: ASC}) { nodes {
      title url state dueOn description progressPercentage
      open: issues(states: OPEN) { totalCount } closed: issues(states: CLOSED) { totalCount } } }
    releases(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes {
      name tagName url publishedAt isPrerelease isLatest } }
    defaultBranchRef { target { ... on Commit { history(first: 30) { totalCount nodes {
      oid messageHeadline url committedDate statusCheckRollup { state }
      author { name avatarUrl user { login } } } } } } }
  }
}
${ITEM_FRAGMENTS}`;

export async function fetchRepoDetail(token: string, nameWithOwner: string): Promise<RepoDetail> {
  const [owner, name] = nameWithOwner.split("/");
  const [data, runs] = await Promise.all([
    gql<any>(token, DETAIL_QUERY, { owner, name }),
    rest<any>(token, `/repos/${owner}/${name}/actions/runs?per_page=20`).catch(() => ({ workflow_runs: [] })),
  ]);
  const r = data.repository;
  const hist = r.defaultBranchRef?.target?.history;
  return {
    languages: (r.languages?.edges ?? []).map((e: any) => ({ name: e.node.name, color: e.node.color ?? "#888", size: e.size })),
    issues: (r.issues?.nodes ?? []).map((i: any) => mapItem(i, "issue", nameWithOwner)),
    pulls: (r.pullRequests?.nodes ?? []).map((p: any) => mapItem(p, "pr", nameWithOwner)),
    milestones: r.milestones.nodes.map((m: any) => ({
      title: m.title, url: m.url, state: m.state, dueOn: m.dueOn, description: m.description ?? "",
      progress: Math.round(m.progressPercentage ?? 0), open: m.open.totalCount, closed: m.closed.totalCount,
    })),
    releases: r.releases.nodes.map((x: any) => ({
      name: x.name || x.tagName, tag: x.tagName, url: x.url, publishedAt: x.publishedAt, isPrerelease: x.isPrerelease, isLatest: x.isLatest,
    })),
    commits: (hist?.nodes ?? []).map((c: any) => ({
      oid: c.oid, message: c.messageHeadline, url: c.url, date: c.committedDate,
      author: c.author?.user?.login ?? c.author?.name ?? "unknown", avatar: c.author?.avatarUrl ?? null,
      checks: c.statusCheckRollup?.state ?? null,
    })),
    totalCommits: hist?.totalCount ?? 0,
    runs: (runs.workflow_runs ?? []).map((w: any) => ({
      id: w.id, name: w.name, title: w.display_title, status: w.status, conclusion: w.conclusion,
      url: w.html_url, branch: w.head_branch, event: w.event, createdAt: w.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Search (Discover)
// ---------------------------------------------------------------------------

export interface SearchOptions {
  query: string;
  sort: "stars" | "updated" | "best-match";
  activeOnly: boolean;
  licensed: boolean;
  minStars: number;
  language: string;
  page: number;
}

export function buildSearchQuery(o: SearchOptions): string {
  const q = [o.query.trim() || "stars:>1", "archived:false"];
  if (o.activeOnly) {
    const d = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    q.push(`pushed:>${d}`);
  }
  if (o.minStars > 0) q.push(`stars:>=${o.minStars}`);
  if (o.language) q.push(`language:"${o.language}"`);
  return q.join(" ");
}

export async function searchRepos(token: string | null, o: SearchOptions): Promise<{ total: number; items: SearchResult[] }> {
  const params = new URLSearchParams({ q: buildSearchQuery(o), per_page: "30", page: String(o.page) });
  if (o.sort !== "best-match") {
    params.set("sort", o.sort);
    params.set("order", "desc");
  }
  const data = await rest<any>(token, `/search/repositories?${params}`, "application/vnd.github+json");
  const items: SearchResult[] = data.items.map((i: any) => ({
      id: i.id, fullName: i.full_name, owner: i.owner.login, ownerAvatar: i.owner.avatar_url,
      description: i.description ?? "", url: i.html_url, stars: i.stargazers_count, forks: i.forks_count,
      language: i.language, topics: i.topics ?? [], license: i.license?.spdx_id ?? null, pushedAt: i.pushed_at,
      archived: i.archived, isTemplate: i.is_template, openIssues: i.open_issues_count,
  }));
  // "Has a license" is filtered client-side (search qualifiers can't OR licenses).
  return { total: data.total_count, items: o.licensed ? items.filter((i) => i.license && i.license !== "NOASSERTION") : items };
}

// ---------------------------------------------------------------------------
// Orgs & teams (groundwork for team management)
// ---------------------------------------------------------------------------

export interface OrgTeams {
  login: string;
  avatarUrl: string;
  teams: { name: string; slug: string; url: string; members: number; repos: number }[];
}

const ORGS_QUERY = `query Orgs { viewer { organizations(first: 20) { nodes {
  login avatarUrl teams(first: 30) { nodes { name slug url members { totalCount } repositories { totalCount } } } } } } }`;

export async function fetchOrgTeams(token: string): Promise<OrgTeams[]> {
  const data = await gql<any>(token, ORGS_QUERY);
  return data.viewer.organizations.nodes.map((o: any) => ({
    login: o.login,
    avatarUrl: o.avatarUrl,
    teams: (o.teams?.nodes ?? []).map((t: any) => ({ name: t.name, slug: t.slug, url: t.url, members: t.members.totalCount, repos: t.repositories.totalCount })),
  }));
}

/** Exposed for schema validation in scripts/validate-graphql.mjs */
export const QUERIES = {
  list: LIST_QUERY,
  heavy: HEAVY_QUERY,
  tracked: trackedQuery(2),
  detail: DETAIL_QUERY,
  orgs: ORGS_QUERY,
};

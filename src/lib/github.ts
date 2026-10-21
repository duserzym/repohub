import { httpFetch } from "./platform";
import type { CheckState, Repo, SearchResult, Settings, Viewer } from "./types";

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

export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await httpFetch(`${API}/graphql`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new AuthError("GitHub token is invalid or expired");
  const json = await res.json();
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

const WEEKS = 8;
const ICON_DIRS = ["", ".github", "assets", "docs", "images", "public"] as const;
const treeAlias = (dir: string) => `tree_${dir.replace(/[^a-z]/gi, "") || "root"}`;

const REPO_FIELDS = `
fragment RepoFields on Repository {
  id nameWithOwner name description url homepageUrl isPrivate isFork isArchived
  stargazerCount forkCount pushedAt createdAt
  owner { login avatarUrl }
  primaryLanguage { name color }
  repositoryTopics(first: 12) { nodes { topic { name } } }
  openGraphImageUrl usesCustomOpenGraphImage
  openIssues: issues(states: OPEN) { totalCount }
  closedIssues: issues(states: CLOSED) { totalCount }
  openPRs: pullRequests(states: OPEN) { totalCount }
  mergedPRs: pullRequests(states: MERGED) { totalCount }
  milestones(states: OPEN, first: 3, orderBy: {field: DUE_DATE, direction: ASC}) {
    nodes { title url dueOn progressPercentage
      open: issues(states: OPEN) { totalCount } closed: issues(states: CLOSED) { totalCount } }
  }
  latestRelease { name tagName publishedAt url }
  defaultBranchRef { name target { ... on Commit {
    oid committedDate messageHeadline
    statusCheckRollup { state }
    ${Array.from({ length: WEEKS }, (_, i) => `w${i}: history(first: 1, since: $w${i}, until: $w${i + 1}) { totalCount }`).join("\n    ")}
  } } }
  ${ICON_DIRS.map((d) => `${treeAlias(d)}: object(expression: "HEAD:${d}") { ... on Tree { entries { name type } } }`).join("\n  ")}
}`;

const weekVarDefs = Array.from({ length: WEEKS + 1 }, (_, i) => `$w${i}: GitTimestamp!`).join(", ");

function weekVars(): Record<string, string> {
  const now = Date.now();
  const week = 7 * 864e5;
  const v: Record<string, string> = {};
  for (let i = 0; i <= WEEKS; i++) v[`w${i}`] = new Date(now - (WEEKS - i) * week).toISOString();
  return v;
}

const LIST_QUERY = `
query Repos($cursor: String, $first: Int!, $aff: [RepositoryAffiliation], $isFork: Boolean, ${weekVarDefs}) {
  rateLimit { remaining limit resetAt }
  viewer {
    login name avatarUrl
    repositories(first: $first, after: $cursor, affiliations: $aff, ownerAffiliations: $aff, isFork: $isFork,
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...RepoFields }
    }
  }
}
${REPO_FIELDS}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRepo(n: any, tracked = false): Repo {
  const c = n.defaultBranchRef?.target;
  const weekly = c ? Array.from({ length: WEEKS }, (_, i) => c[`w${i}`]?.totalCount ?? 0) : new Array(WEEKS).fill(0);
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
    ci: (c?.statusCheckRollup?.state ?? null) as CheckState,
    weekly,
    iconPaths: rankIconFiles(files),
    socialImage: n.usesCustomOpenGraphImage ? n.openGraphImageUrl : null,
    tracked,
  };
}

/** Pick likely logo/icon files from a repo's top-level folders. */
export function rankIconFiles(files: { path: string; dir: string; name: string }[]): string[] {
  const extScore: Record<string, number> = { png: 5, svg: 4, webp: 3, jpg: 2, jpeg: 2, ico: 1 };
  const dirScore: Record<string, number> = { ".github": 4, "": 3, assets: 2, public: 1, docs: 0, images: 0 };
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

export interface RepoListResult {
  viewer: Viewer;
  repos: Repo[];
  totalCount: number;
  rateLimit: RateLimit;
  fetchedAt: string;
}

export async function fetchRepos(token: string, settings: Settings, trackedNames: string[]): Promise<RepoListResult> {
  const repos: Repo[] = [];
  let cursor: string | null = null;
  let viewer: Viewer | null = null;
  let rateLimit: RateLimit = { remaining: 0, limit: 0, resetAt: "" };
  let totalCount = 0;
  const vars = weekVars();
  const pageSize = 25; // keeps each GraphQL request well under GitHub's timeout
  do {
    const data: any = await gql(token, LIST_QUERY, {
      ...vars,
      cursor,
      first: Math.min(pageSize, settings.maxRepos - repos.length),
      aff: settings.affiliations,
      isFork: settings.includeForks ? null : false,
    });
    viewer = { login: data.viewer.login, name: data.viewer.name, avatarUrl: data.viewer.avatarUrl };
    rateLimit = data.rateLimit;
    const conn = data.viewer.repositories;
    totalCount = conn.totalCount;
    repos.push(...conn.nodes.map((n: any) => mapRepo(n)));
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor && repos.length < settings.maxRepos);

  const own = new Set(repos.map((r) => r.nameWithOwner.toLowerCase()));
  const extra = trackedNames.filter((n) => !own.has(n.toLowerCase()));
  if (extra.length) repos.push(...(await fetchTracked(token, extra, vars)));

  return {
    viewer: viewer!,
    repos: settings.includeArchived ? repos : repos.filter((r) => !r.isArchived || r.tracked),
    totalCount,
    rateLimit,
    fetchedAt: new Date().toISOString(),
  };
}

function trackedQuery(n: number) {
  const defs = Array.from({ length: n }, (_, j) => `$o${j}: String!, $n${j}: String!`).join(", ");
  const body = Array.from({ length: n }, (_, j) => `r${j}: repository(owner: $o${j}, name: $n${j}) { ...RepoFields }`).join("\n");
  return `query Tracked(${defs}, ${weekVarDefs}) {\n${body}\n}\n${REPO_FIELDS}`;
}

async function fetchTracked(token: string, names: string[], vars: Record<string, string>): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let i = 0; i < names.length; i += 15) {
    const chunk = names.slice(i, i + 15);
    const v: Record<string, string> = { ...vars };
    chunk.forEach((full, j) => {
      const [o, n] = full.split("/");
      v[`o${j}`] = o;
      v[`n${j}`] = n;
    });
    const data: any = await gql(token, trackedQuery(chunk.length), v);
    chunk.forEach((_, j) => data[`r${j}`] && out.push(mapRepo(data[`r${j}`], true)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repository detail
// ---------------------------------------------------------------------------

export interface RepoDetail {
  languages: { name: string; color: string; size: number }[];
  issues: { number: number; title: string; url: string; createdAt: string; author: string; comments: number; labels: { name: string; color: string }[]; assignees: string[] }[];
  pulls: { number: number; title: string; url: string; createdAt: string; author: string; isDraft: boolean; review: string | null; checks: CheckState; additions: number; deletions: number }[];
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
    issues(states: OPEN, first: 40, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
      number title url createdAt author { login } comments { totalCount }
      labels(first: 5) { nodes { name color } } assignees(first: 3) { nodes { login } } } }
    pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
      number title url createdAt isDraft reviewDecision additions deletions author { login }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }
    milestones(first: 20, orderBy: {field: DUE_DATE, direction: ASC}) { nodes {
      title url state dueOn description progressPercentage
      open: issues(states: OPEN) { totalCount } closed: issues(states: CLOSED) { totalCount } } }
    releases(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes {
      name tagName url publishedAt isPrerelease isLatest } }
    defaultBranchRef { target { ... on Commit { history(first: 30) { totalCount nodes {
      oid messageHeadline url committedDate statusCheckRollup { state }
      author { name avatarUrl user { login } } } } } } }
  }
}`;

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
    issues: r.issues.nodes.map((i: any) => ({
      number: i.number, title: i.title, url: i.url, createdAt: i.createdAt, author: i.author?.login ?? "ghost",
      comments: i.comments.totalCount, labels: i.labels.nodes, assignees: i.assignees.nodes.map((a: any) => a.login),
    })),
    pulls: r.pullRequests.nodes.map((p: any) => ({
      number: p.number, title: p.title, url: p.url, createdAt: p.createdAt, author: p.author?.login ?? "ghost",
      isDraft: p.isDraft, review: p.reviewDecision, additions: p.additions, deletions: p.deletions,
      checks: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    })),
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
  tracked: trackedQuery(2),
  detail: DETAIL_QUERY,
  orgs: ORGS_QUERY,
};

// Shared shape for open pull requests and issues, used by the dashboard
// drill-downs, the repo cards' quick peek and the repo detail page.

export interface WorkItem {
  kind: "pr" | "issue";
  repo: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  authorAvatar: string | null;
  /** Plain-text excerpt of the description. */
  body: string;
  labels: { name: string; color: string }[];
  comments: number;
  assignees: string[];
  // Pull requests only
  isDraft?: boolean;
  review?: string | null;
  checks?: string | null;
  additions?: number;
  deletions?: number;
}

const COMMON = `number title url createdAt updatedAt bodyText
    author { login avatarUrl } comments { totalCount }
    labels(first: 5) { nodes { name color } } assignees(first: 3) { nodes { login } }`;

const PR_FRAGMENT = `
fragment PRItem on PullRequest {
  ${COMMON}
  isDraft reviewDecision additions deletions
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;
const ISSUE_FRAGMENT = `
fragment IssueItem on Issue {
  ${COMMON}
}`;
export const ITEM_FRAGMENTS = PR_FRAGMENT + ISSUE_FRAGMENT;

export const PRS_QUERY = `
query OpenPRs($ids: [ID!]!, $n: Int!) {
  nodes(ids: $ids) { ... on Repository { nameWithOwner
    pullRequests(states: OPEN, first: $n, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...PRItem } }
  } }
}
${PR_FRAGMENT}`;

export const ISSUES_QUERY = `
query OpenIssues($ids: [ID!]!, $n: Int!) {
  nodes(ids: $ids) { ... on Repository { nameWithOwner
    issues(states: OPEN, first: $n, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...IssueItem } }
  } }
}
${ISSUE_FRAGMENT}`;

export const ITEM_QUERIES = { openPRs: PRS_QUERY, openIssues: ISSUES_QUERY };

const BODY_MAX = 600;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapItem(n: any, kind: "pr" | "issue", repo: string): WorkItem {
  const body = (n.bodyText ?? "").trim();
  return {
    kind,
    repo,
    number: n.number,
    title: n.title,
    url: n.url,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? n.createdAt,
    author: n.author?.login ?? "ghost",
    authorAvatar: n.author?.avatarUrl ?? null,
    body: body.length > BODY_MAX ? body.slice(0, BODY_MAX).trimEnd() + "…" : body,
    labels: n.labels?.nodes ?? [],
    comments: n.comments?.totalCount ?? 0,
    assignees: (n.assignees?.nodes ?? []).map((a: any) => a.login),
    ...(kind === "pr"
      ? {
          isDraft: !!n.isDraft,
          review: n.reviewDecision ?? null,
          checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
          additions: n.additions ?? 0,
          deletions: n.deletions ?? 0,
        }
      : {}),
  };
}

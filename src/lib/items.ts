import { useQuery } from "@tanstack/react-query";
import { demoDetail } from "./demo";
import { gql } from "./github";
import { useApp } from "./state";
import type { Repo } from "./types";
import { ISSUES_QUERY, mapItem, PRS_QUERY, type WorkItem } from "./workitems";

// Open pull requests / issues across many repos, loaded on demand when a
// drill-down opens. Only repos whose counts say they have open items are asked,
// in batches of 15 repos per request.


const BATCH = 15;

export async function fetchOpenItems(token: string, repos: Repo[], kind: "pr" | "issue", perRepo = 10): Promise<WorkItem[]> {
  const ids = repos.map((r) => r.id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  const results = await Promise.all(
    batches.map((b) =>
      gql<{ nodes: any[] }>(token, kind === "pr" ? PRS_QUERY : ISSUES_QUERY, { ids: b, n: perRepo }), // eslint-disable-line @typescript-eslint/no-explicit-any
    ),
  );
  const out: WorkItem[] = [];
  for (const res of results)
    for (const n of res?.nodes ?? []) {
      if (!n?.nameWithOwner) continue;
      for (const it of (kind === "pr" ? n.pullRequests : n.issues)?.nodes ?? []) out.push(mapItem(it, kind, n.nameWithOwner));
    }
  return out.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

/** Open PRs or issues for the given repos; loads only while `enabled`. */
export function useOpenItems(kind: "pr" | "issue", repos: Repo[], enabled: boolean, perRepo = 10) {
  const { token, demo } = useApp();
  const withItems = repos.filter((r) => (kind === "pr" ? r.openPRs : r.openIssues) > 0);
  // Refetch when any count changes (a new PR, an issue closed…).
  const sig = withItems.map((r) => `${r.id}:${kind === "pr" ? r.openPRs : r.openIssues}`).join(",");
  return useQuery<WorkItem[]>({
    queryKey: ["items", kind, demo ? "demo" : token, sig, perRepo],
    enabled: enabled && (demo || !!token) && withItems.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (demo)
        return withItems
          .flatMap((r) => (kind === "pr" ? demoDetail(r).pulls : demoDetail(r).issues).slice(0, perRepo))
          .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      return fetchOpenItems(token!, withItems, kind, perRepo);
    },
  });
}

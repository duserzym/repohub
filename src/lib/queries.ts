import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { demoDetail, demoRepos } from "./demo";
import { AuthError, fetchRepoDetail, fetchRepos, type RepoListResult } from "./github";
import { listen } from "./platform";
import { useApp } from "./state";
import { pushTray, summarize } from "./summary";

/** All dashboard data; auto-refreshes every `settings.pollMinutes`. */
export function useRepos() {
  const app = useApp();
  const { token, demo, settings, tracked } = app;
  const key = ["repos", demo ? "demo" : token, settings.affiliations, settings.includeForks, settings.includeArchived, settings.maxRepos, tracked];

  const q = useQuery<RepoListResult>({
    queryKey: key,
    enabled: app.ready && (demo || !!token),
    queryFn: async () => {
      if (demo) return demoRepos();
      try {
        return await fetchRepos(token!, settings, tracked);
      } catch (e) {
        if (e instanceof AuthError) await app.setToken(null);
        throw e;
      }
    },
    refetchInterval: settings.pollMinutes * 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof AuthError) && n < 2,
  });

  const summary = useMemo(
    () => (q.data ? summarize(q.data.repos, app.categories, app.assignments) : null),
    [q.data, app.categories, app.assignments],
  );

  return { ...q, summary };
}

/** Side effects that must run once (mounted in the main window only). */
export function useTraySync() {
  const { settings } = useApp();
  const { data, summary } = useRepos();
  const qc = useQueryClient();

  // "Refresh now" from the tray menu / popover.
  useEffect(() => {
    let off = () => {};
    let dead = false;
    listen("tray-refresh", () => qc.invalidateQueries({ queryKey: ["repos"] })).then((f) => (dead ? f() : (off = f)));
    return () => {
      dead = true;
      off();
    };
  }, [qc]);

  // Keep the menu-bar item in sync after every fetch.
  useEffect(() => {
    if (summary && data) void pushTray(summary, settings.menuBarStats, data.fetchedAt, data.viewer.login);
  }, [summary, data, settings.menuBarStats]);
}

export function useRepoDetail(nameWithOwner: string) {
  const { token, demo } = useApp();
  const repos = useRepos();
  const repo = repos.data?.repos.find((r) => r.nameWithOwner === nameWithOwner);
  const q = useQuery({
    queryKey: ["detail", nameWithOwner, demo],
    enabled: demo ? !!repo : !!token,
    queryFn: () => (demo ? demoDetail(repo!) : fetchRepoDetail(token!, nameWithOwner)),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return { ...q, repo, loadingList: repos.isLoading };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { demoDetail, demoRepos } from "./demo";
import { AuthError, fetchRepoDetail, fetchRepos, type LoadProgress, type RepoListResult } from "./github";
import { listen } from "./platform";
import { kvDelete, kvGet, kvSet } from "./storage";
import { useApp } from "./state";
import { pushTray, summarize } from "./summary";

// ---- load progress ("Loaded 40 of 120…") shared with the UI -------------
let progress: LoadProgress | null = null;
const progressSubs = new Set<() => void>();
function setProgress(p: typeof progress) {
  progress = p;
  progressSubs.forEach((f) => f());
}
export function useLoadProgress() {
  return useSyncExternalStore(
    (f) => (progressSubs.add(f), () => progressSubs.delete(f)),
    () => progress,
  );
}

// ---- last result cached on disk so the dashboard appears instantly on launch
const CACHE_FILE = "cache.json";
export const clearRepoCache = () => kvDelete("repos", CACHE_FILE);

/** All dashboard data; auto-refreshes every `settings.pollMinutes`. */
export function useRepos() {
  const app = useApp();
  const qc = useQueryClient();
  const { token, demo, settings, tracked } = app;
  const key = ["repos", demo ? "demo" : token, settings.affiliations, settings.includeForks, settings.includeArchived, settings.maxRepos, tracked];
  const cacheSig = JSON.stringify(key.slice(2));

  const q = useQuery<RepoListResult>({
    queryKey: key,
    enabled: app.ready && (demo || !!token),
    queryFn: async () => {
      if (demo) return demoRepos();
      let lastPartial: RepoListResult | undefined;
      // On startup the disk cache may not be in memory yet: read it here so the
      // first sync is incremental (only changed repos are re-fetched).
      let previous = qc.getQueryData<RepoListResult>(key);
      if (!previous) {
        const c = await kvGet<{ sig: string; data: RepoListResult }>("repos", CACHE_FILE).catch(() => undefined);
        if (c?.sig === cacheSig && c.data?.viewer && Array.isArray(c.data.repos)) {
          previous = c.data;
          if (!qc.getQueryData(key)) qc.setQueryData(key, c.data, { updatedAt: 0 });
        }
      }
      try {
        const result = await fetchRepos(
          token!,
          settings,
          tracked,
          (partial, p) => {
            setProgress(p);
            // Show results as they arrive. Once the list phase is done every partial
            // result is a complete list, so it is always safe to display.
            const cur = qc.getQueryData<RepoListResult>(key);
            if (!cur || cur === lastPartial || p.phase === "details") {
              lastPartial = partial;
              qc.setQueryData(key, partial);
            }
          },
          previous,
        );
        if (result.viewer) void kvSet("repos", { sig: cacheSig, data: result }, CACHE_FILE);
        return result;
      } catch (e) {
        if (e instanceof AuthError) {
          await clearRepoCache();
          await app.setToken(null);
        }
        throw e;
      } finally {
        setProgress(null);
      }
    },
    refetchInterval: settings.pollMinutes * 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: Math.min(settings.pollMinutes, 5) * 60_000,
    retry: (n, e) => !(e instanceof AuthError) && n < 2,
  });

  // Show the last saved dashboard immediately while the fresh load runs.
  useEffect(() => {
    if (demo || !token || q.data) return;
    let alive = true;
    kvGet<{ sig: string; data: RepoListResult }>("repos", CACHE_FILE).then((c) => {
      if (alive && c?.sig === cacheSig && c.data?.viewer && Array.isArray(c.data.repos) && !qc.getQueryData(key)) qc.setQueryData(key, c.data, { updatedAt: 0 });
    });
    return () => {
      alive = false;
    };
  }, [demo, token, cacheSig]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Skip partial results so the menu bar never shows half-loaded numbers.
    if (summary && data?.viewer && !data.repos.some((r) => r.enriched === false))
      void pushTray(summary, settings.menuBarStats, data.fetchedAt, data.viewer?.login ?? "");
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

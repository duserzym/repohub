import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearToken, loadToken, saveToken, DEFAULT_CLIENT_ID } from "./auth";
import { DEFAULT_CATEGORIES } from "./categories";
import { DEFAULT_PALETTE } from "./themes";
import { kvGet, kvSet } from "./storage";
import type { Category, Settings, Team } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  pollMinutes: 5,
  includeForks: false,
  includeArchived: false,
  affiliations: ["OWNER", "COLLABORATOR", "ORGANIZATION_MEMBER"],
  maxRepos: 100,
  menuBarStats: ["issues", "prs", "ci"],
  theme: "system",
  palette: DEFAULT_PALETTE,
  clientId: DEFAULT_CLIENT_ID,
  sort: "pushed",
  autoUpdate: true,
  updateChannel: "stable",
};

interface Persisted {
  settings: Settings;
  categories: Category[];
  /** nameWithOwner → category id (manual assignments override keyword rules) */
  assignments: Record<string, string>;
  /** External repos added from Discover, as nameWithOwner */
  tracked: string[];
  pinned: string[];
  teams: Team[];
  iconOverrides: Record<string, string>;
}

const DEFAULTS: Persisted = {
  settings: DEFAULT_SETTINGS,
  categories: DEFAULT_CATEGORIES,
  assignments: {},
  tracked: [],
  pinned: [],
  teams: [],
  iconOverrides: {},
};

type Updater<K extends keyof Persisted> = Persisted[K] | ((prev: Persisted[K]) => Persisted[K]);

interface AppCtx extends Persisted {
  ready: boolean;
  token: string | null;
  demo: boolean;
  setToken(t: string | null): Promise<void>;
  setDemo(d: boolean): void;
  update<K extends keyof Persisted>(key: K, value: Updater<K>): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(DEFAULTS);
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [demo, setDemoState] = useState(() => new URLSearchParams(location.search).has("demo"));

  useEffect(() => {
    (async () => {
      const keys = Object.keys(DEFAULTS) as (keyof Persisted)[];
      const vals = await Promise.all(keys.map((k) => kvGet<unknown>(k)));
      const next = { ...DEFAULTS } as Record<string, unknown>;
      keys.forEach((k, i) => {
        if (vals[i] !== undefined) next[k] = k === "settings" ? { ...DEFAULT_SETTINGS, ...(vals[i] as object) } : vals[i];
      });
      setState(next as unknown as Persisted);
      setTok(await loadToken());
      if ((await kvGet<boolean>("demo")) === true) setDemoState(true);
      setReady(true);
    })();
  }, []);

  const update = useCallback(<K extends keyof Persisted>(key: K, value: Updater<K>) => {
    setState((prev) => {
      const v = typeof value === "function" ? (value as (p: Persisted[K]) => Persisted[K])(prev[key]) : value;
      void kvSet(key, v);
      return { ...prev, [key]: v };
    });
  }, []);

  const setToken = useCallback(async (t: string | null) => {
    if (t) await saveToken(t);
    else await clearToken();
    setTok(t);
  }, []);

  const setDemo = useCallback((d: boolean) => {
    setDemoState(d);
    void kvSet("demo", d);
  }, []);

  const value = useMemo<AppCtx>(
    () => ({ ...state, ready, token, demo, setToken, setDemo, update }),
    [state, ready, token, demo, setToken, setDemo, update],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

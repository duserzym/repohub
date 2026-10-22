import { lazy, Suspense, useEffect, useState } from "react";
import { Spinner } from "./components/bits";
import { Icon } from "./components/Icon";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isTauri, listen } from "./lib/platform";
import { applyMode, applyPalette } from "./lib/themes";
import { useTraySync } from "./lib/queries";
import { useUpdateScheduler } from "./lib/updater";
import { navigate, useRoute } from "./lib/router";
import { useApp } from "./lib/state";
import { Dashboard } from "./views/Dashboard";
import { Discover } from "./views/Discover";
import { RepoDetail } from "./views/RepoDetail";
import { Settings } from "./views/Settings";
import { Teams } from "./views/Teams";
// The Idea Pad (with its Markdown renderer) loads on demand to keep startup fast.
const Ideas = lazy(() => import("./views/Ideas").then((m) => ({ default: m.Ideas })));
import { TrayPopover } from "./views/TrayPopover";

function useTheme() {
  const { settings, ready } = useApp();
  useEffect(() => {
    if (!ready) return;
    applyPalette(settings.palette);
    applyMode(settings.theme);
    // Keep the menu-bar popover window in sync.
    if (isTauri) void import("@tauri-apps/api/event").then(({ emit }) => emit("appearance-changed", { palette: settings.palette, theme: settings.theme }));
  }, [settings.palette, settings.theme, ready]);
}

function Shell() {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  useTraySync();
  useUpdateScheduler();

  // The tray popover asks the main window to show a route.
  useEffect(() => {
    let off = () => {};
    listen<string>("navigate", (h) => navigate(h)).then((f) => (off = f));
    return () => off();
  }, []);

  return (
    <div className="app">
      <Sidebar route={route} open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Menu"><Icon name="menu" size={20} /></button>
          <img src="/icon.svg" alt="" width={22} height={22} />
          <strong>RepoHub</strong>
        </div>
        <ErrorBoundary where={`view:${route.view}`} resetKey={location.hash}>
          {route.view === "dashboard" && <Dashboard category={route.category} />}
          {route.view === "repo" && <RepoDetail key={route.nameWithOwner} nameWithOwner={route.nameWithOwner} tab={route.tab} />}
          {route.view === "discover" && <Discover />}
          {route.view === "teams" && <Teams />}
          {route.view === "ideas" && (
            <Suspense fallback={<div className="center-fill"><Spinner /></div>}>
              <Ideas slug={route.slug} />
            </Suspense>
          )}
          {route.view === "settings" && <Settings />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function App() {
  const { ready, token, demo } = useApp();
  const route = useRoute();
  useTheme();

  if (route.view === "tray") return <TrayPopover />;
  if (!ready) return <div className="center-fill"><Spinner /></div>;
  if (!token && !demo) return <Login />;
  return <Shell />;
}

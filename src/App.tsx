import { useEffect, useState } from "react";
import { Spinner } from "./components/bits";
import { Icon } from "./components/Icon";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { listen } from "./lib/platform";
import { useTraySync } from "./lib/queries";
import { useUpdateScheduler } from "./lib/updater";
import { navigate, useRoute } from "./lib/router";
import { useApp } from "./lib/state";
import { Dashboard } from "./views/Dashboard";
import { Discover } from "./views/Discover";
import { RepoDetail } from "./views/RepoDetail";
import { Settings } from "./views/Settings";
import { Teams } from "./views/Teams";
import { TrayPopover } from "./views/TrayPopover";

function useTheme() {
  const { settings } = useApp();
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);
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
        {route.view === "dashboard" && <Dashboard category={route.category} />}
        {route.view === "repo" && <RepoDetail key={route.nameWithOwner} nameWithOwner={route.nameWithOwner} tab={route.tab} />}
        {route.view === "discover" && <Discover />}
        {route.view === "teams" && <Teams />}
        {route.view === "settings" && <Settings />}
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

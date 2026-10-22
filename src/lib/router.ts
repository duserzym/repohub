import { useEffect, useState } from "react";

// Tiny hash router: #/  #/c/<category>  #/repo/<owner>/<name>  #/discover  #/teams  #/settings  #/tray

export type Route =
  | { view: "dashboard"; category: string | null; drill?: string | null }
  | { view: "repo"; nameWithOwner: string; tab: string }
  | { view: "discover" }
  | { view: "teams" }
  | { view: "ideas"; slug: string | null }
  | { view: "settings" }
  | { view: "tray" };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "c":
      return { view: "dashboard", category: parts[1] ?? null };
    case "drill":
      return { view: "dashboard", category: null, drill: parts[1] ?? null };
    case "repo":
      return { view: "repo", nameWithOwner: `${parts[1]}/${parts[2]}`, tab: parts[3] ?? "overview" };
    case "discover":
      return { view: "discover" };
    case "teams":
      return { view: "teams" };
    case "ideas":
      return { view: "ideas", slug: parts[1] ?? null };
    case "settings":
      return { view: "settings" };
    case "tray":
      return { view: "tray" };
    default:
      return { view: "dashboard", category: null };
  }
}

export const href = {
  home: () => "#/",
  category: (id: string) => `#/c/${encodeURIComponent(id)}`,
  drill: (kind: string) => `#/drill/${kind}`,
  repo: (nwo: string, tab?: string) => `#/repo/${nwo}${tab && tab !== "overview" ? `/${tab}` : ""}`,
  discover: () => "#/discover",
  teams: () => "#/teams",
  ideas: (slug?: string) => (slug ? `#/ideas/${slug}` : "#/ideas"),
  settings: () => "#/settings",
};

export function navigate(h: string) {
  if (location.hash !== h) location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      document.querySelector(".main")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

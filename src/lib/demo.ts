import type { RepoDetail, RepoListResult } from "./github";
import type { Repo } from "./types";

// Sample data so the UI can be explored (and screenshotted) without signing in.

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const SPECS: [string, string, string[], string, string][] = [
  ["tims-data-reduction", "Data reduction for thermal ionization mass spectrometry runs", ["tims", "isotope", "geochronology"], "Python", "#d97706"],
  ["zircon-upb-ages", "U-Pb zircon age calculation and concordia plots", ["u-pb", "zircon", "geochronology"], "Python", "#ea580c"],
  ["icpms-trace-pipeline", "LA-ICP-MS trace element processing pipeline", ["icp-ms", "geochemistry"], "Jupyter Notebook", "#b45309"],
  ["isotope-dilution-calc", "Spike calibration and isotope dilution calculator", ["isotope", "tims"], "TypeScript", "#f59e0b"],
  ["paleomag-apwp-viewer", "Apparent polar wander path explorer", ["paleomagnetism", "apwp"], "JavaScript", "#2563eb"],
  ["seismic-tomo-notebooks", "Teaching notebooks for seismic tomography", ["seismology", "geophysics"], "Jupyter Notebook", "#1d4ed8"],
  ["gravity-anomaly-maps", "Bouguer and free-air gravity anomaly mapping", ["gravity", "geophysics"], "Python", "#3b82f6"],
  ["magnetometer-firmware", "Firmware for the lab spinner magnetometer", ["paleomag", "embedded"], "C++", "#0ea5e9"],
  ["lake-shoreline-3d", "three.js model of paleolake shorelines", ["threejs", "visualization"], "JavaScript", "#059669"],
  ["lab-website", "Group website", ["website"], "HTML", "#7c3aed"],
  ["field-notes-app", "Offline field notebook for sample logging", ["field", "mobile"], "Swift", "#db2777"],
  ["thesis-figures", "Figures and scripts for thesis chapters", [], "Python", "#475569"],
];

const COMMITS = [
  "Fix fractionation correction for Pb", "Add concordia ellipse plotting", "Update README", "Refactor loaders",
  "Bump dependencies", "Add CI workflow", "Handle missing spike values", "Speed up tile rendering",
  "Add unit tests for reducer", "New colormap for anomalies",
];

function icon(color: string, letter: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><circle cx="46" cy="18" r="7" fill="#fff" opacity=".35"/><text x="32" y="42" font-family="Helvetica,Arial" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function demoRepos(): RepoListResult {
  const r = rng(7);
  const now = Date.now();
  const repos: Repo[] = SPECS.map(([name, description, topics, lang, color], i) => {
    const open = Math.floor(r() * 25);
    const closed = Math.floor(r() * 60) + 2;
    const weekly = Array.from({ length: 12 }, () => Math.floor(r() * (i < 6 ? 14 : 5)));
    const pushed = new Date(now - r() * (i < 8 ? 9 : 120) * 864e5).toISOString();
    const hasMs = r() > 0.35;
    const msOpen = Math.floor(r() * 8);
    const msClosed = Math.floor(r() * 14) + 1;
    const ci = (["SUCCESS", "SUCCESS", "SUCCESS", "FAILURE", "PENDING", null] as const)[Math.floor(r() * 6)];
    return {
      id: `demo-${i}`,
      nameWithOwner: `demo-lab/${name}`,
      owner: "demo-lab",
      ownerAvatar: "",
      name,
      description,
      url: `https://github.com/`,
      homepageUrl: null,
      isPrivate: r() > 0.6,
      isFork: false,
      isArchived: false,
      stars: Math.floor(r() * 120),
      forks: Math.floor(r() * 20),
      pushedAt: pushed,
      createdAt: new Date(now - (400 + r() * 900) * 864e5).toISOString(),
      language: { name: lang, color },
      topics,
      openIssues: open,
      closedIssues: closed,
      openPRs: Math.floor(r() * 5),
      mergedPRs: Math.floor(r() * 40),
      milestones: hasMs
        ? [{
            title: ["v1.0", "Paper submission", "Field season", "v0.3"][i % 4],
            url: "https://github.com/",
            dueOn: new Date(now + (r() * 60 - 15) * 864e5).toISOString(),
            progress: Math.round((msClosed / (msOpen + msClosed)) * 100),
            open: msOpen,
            closed: msClosed,
          }]
        : [],
      latestRelease: r() > 0.4 ? { name: `v0.${i + 1}.0`, tag: `v0.${i + 1}.0`, publishedAt: new Date(now - r() * 90 * 864e5).toISOString(), url: "https://github.com/" } : null,
      defaultBranch: "main",
      lastCommit: { oid: "a1b2c3d", date: pushed, message: COMMITS[i % COMMITS.length] },
      ci,
      weekly,
      iconPaths: [],
      socialImage: i % 3 === 2 ? null : icon(color, name[0].toUpperCase()),
    };
  });
  return {
    viewer: { login: "demo-user", name: "Demo User", avatarUrl: "" },
    repos,
    totalCount: repos.length,
    rateLimit: { remaining: 5000, limit: 5000, resetAt: new Date(now + 3600e3).toISOString() },
    fetchedAt: new Date().toISOString(),
  };
}

export function demoDetail(repo: Repo): RepoDetail {
  const r = rng(repo.name.length * 31);
  const now = Date.now();
  const d = (days: number) => new Date(now - days * 864e5).toISOString();
  return {
    languages: [
      { name: repo.language?.name ?? "Python", color: repo.language?.color ?? "#3572A5", size: 80000 },
      { name: "Shell", color: "#89e051", size: 6000 },
      { name: "Markdown", color: "#083fa1", size: 3000 },
    ],
    issues: Array.from({ length: Math.min(repo.openIssues, 8) }, (_, i) => ({
      number: 40 - i, title: ["Support new spike file format", "Plot fails with NaN ratios", "Document calibration steps", "Add export to CSV", "Slow on large runs"][i % 5],
      url: "https://github.com/", createdAt: d(r() * 60), author: "demo-user", comments: Math.floor(r() * 6),
      labels: i % 2 ? [{ name: "bug", color: "d73a4a" }] : [{ name: "enhancement", color: "a2eeef" }], assignees: i % 3 ? ["demo-user"] : [],
    })),
    pulls: Array.from({ length: repo.openPRs }, (_, i) => ({
      number: 60 - i, title: ["Refactor reader", "Add tests", "Dark mode"][i % 3], url: "https://github.com/", createdAt: d(r() * 20),
      author: "collaborator", isDraft: i === 2, review: i === 0 ? "APPROVED" : "REVIEW_REQUIRED", checks: i === 1 ? "FAILURE" : "SUCCESS",
      additions: Math.floor(r() * 400), deletions: Math.floor(r() * 120),
    })),
    milestones: repo.milestones.map((m) => ({ ...m, state: "OPEN", description: "" })),
    commits: Array.from({ length: 12 }, (_, i) => ({
      oid: Math.floor(r() * 1e12).toString(16), message: COMMITS[(i + 3) % COMMITS.length], url: "https://github.com/",
      date: d(i * 1.7 + r()), author: i % 3 ? "demo-user" : "collaborator", avatar: null, checks: i === 0 ? repo.ci : "SUCCESS",
    })),
    releases: repo.latestRelease ? [{ ...repo.latestRelease, isPrerelease: false, isLatest: true }] : [],
    runs: Array.from({ length: 6 }, (_, i) => ({
      id: i, name: i % 2 ? "tests" : "build", title: COMMITS[i], status: "completed",
      conclusion: i === 0 && repo.ci === "FAILURE" ? "failure" : "success", url: "https://github.com/", branch: "main", event: "push", createdAt: d(i * 2),
    })),
    totalCommits: 120 + Math.floor(r() * 400),
  };
}

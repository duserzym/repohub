# RepoHub

A lightweight, fast dashboard, with a crisp "Porcelain & Sapphire" glass theme (light and dark), for keeping track of GitHub projects. It runs on **macOS, Windows and iOS** from one codebase (Tauri 2 + React) and lives in the **menu bar / system tray** with live stats.

![Dashboard](docs/screenshots/dash.png)

| Menu-bar popover | iPhone layout | Repo detail |
| --- | --- | --- |
| ![Tray](docs/screenshots/tray.png) | ![Mobile](docs/screenshots/mobile.png) | ![Detail](docs/screenshots/detail.png) |

![Dark mode](docs/screenshots/dash-dark.png)

## Features

- **GitHub login.** Click **Sign in with GitHub**. A small prompt shows a one-time code (already copied for you), GitHub opens in your browser, and RepoHub signs in by itself once you approve. It uses the OAuth device flow, so no client secret ships in the app. The token is kept in the OS keychain (macOS/iOS Keychain, Windows Credential Manager).
- **Progress that updates itself.** Polls GitHub every 1–60 minutes (configurable), when the window regains focus, and when you pick "Refresh now" from the tray. For each repo it shows:
  - milestone progress (nearest open milestone) and the share of issues closed
  - open and merged PRs, review state and checks on each PR
  - CI status from the default branch's status checks, plus recent GitHub Actions runs
  - an 8-week commit sparkline, the latest commit and the latest release
  - stars, forks and languages
- **Insights charts.** Each one answers a different question, and clicking any mark opens the repo or category behind it:
  - commits per week, stacked by category (4, 8 or 12 weeks)
  - an activity heatmap of the most active repos
  - progress bars ranking each project
  - a donut of open work by category
  - a milestone timeline with a "today" line and overdue flags
  - CI health, overall and per category
  
  Every chart has a hover tooltip and a table view. Data colors use a colorblind-validated palette.
- **Eleven color themes, switchable in the app.** Pick a theme from the sidebar's theme menu or Settings → Appearance, and choose Auto, Light or Dark. Changes apply instantly, are remembered between launches, and carry over to the menu-bar popover. The default is **Porcelain & Sapphire** (cool white and a deep, quiet blue). The others: Lagoon, Ivory & Brass, Sage & Pewter, Sandstone & Terracotta, Graphite & Platinum, Plum & Smoke, Glacier & Slate, Basalt & Copper, Linen & Olive, and Rosé Quartz & Taupe.
- **Status you can read at a glance.** Everywhere in the app: ✓ green means passing, ◷ amber means running, ✕ red means failing, and – gray means no CI. Status is never shown by color alone.
- **Clear navigation.** Overview, category and repo views. Each repo has tabs for Issues, Pull requests, Milestones, Commits, Actions and Releases. There's also a "Needs attention" feed (failing CI, overdue milestones, PR backlog).
- **Categories you can edit.** Ships with Geochemistry and Geophysics. You can add, rename, recolor, reorder and delete categories. Repos are sorted automatically by keywords in their name, description and topics, and picking a category on a card always overrides that.
- **Repo icons.** Read from the repo itself: `icon`/`logo`/`favicon` files in the root, `.github`, `assets`, `docs`, `images` or `public` folders. If none is found it falls back to the repo's custom social preview, then to a colored monogram. Icons are cached for 7 days, private repos work, and you can set a custom URL per repo.
- **Discover.** Search GitHub for ready-to-use projects, with topic presets for each category and filters for "maintained in the last year", open-source license, minimum stars and language. Click **Track** to add a repo to your dashboard with live progress.
- **Menu bar / tray.** On macOS the menu bar shows live stats next to the icon, for example `⊙ 42  ⑂ 7  ✕ 1`, and you choose which stats appear. Left-click opens a popover summary, right-click opens a menu with the numbers plus Open, Refresh and Quit. Closing the window keeps RepoHub running in the tray.
- **In-app updates, CodexBar style.** RepoHub checks for new releases in the background (shortly after launch, then every 6 hours) and downloads them quietly. When an update is ready you get an inline **Update ready — restart now?** action in the sidebar, the tray menu and the menu-bar popover. One click installs it and relaunches. You can also check by hand from Settings → Updates, turn automatic downloads off, or switch to the **Beta** channel to get pre-releases.
- **Teams (groundwork).** Local teams with member roles and category scopes, plus a read-only view of your GitHub organizations and their teams. See the [roadmap](#roadmap).
- **Demo mode** lets you explore the UI without signing in (`?demo` in the browser, or "Explore with demo data").

## Install on your Mac

Double-click **`Install RepoHub.command`** in this folder. It:

1. checks for (and offers to install) the Command Line Tools, Node.js and Rust
2. builds RepoHub and copies it to `/Applications`
3. opens the app

Run it again any time to rebuild from the latest code. If macOS blocks the file, right-click it and choose **Open**.

## Quick start

Prerequisites: [Node 20+](https://nodejs.org), [Rust](https://rustup.rs), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (Xcode for macOS/iOS, WebView2 + MSVC build tools on Windows).

```bash
npm install
npm run app:dev        # desktop app with hot reload
npm run dev            # UI only, in the browser (http://localhost:1420/?demo)
npm run app:build      # installers in src-tauri/target/release/bundle
```

### 1. GitHub OAuth App (already set up)

RepoHub's OAuth App is registered under @duserzym (Client ID `Ov23liAaqYPNVsBbVVJb`, Device Flow on, non-expiring tokens), and that ID is built into the app, so sign-in works out of the box. Only follow the steps below if you fork RepoHub and want your own app:

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: `https://duserzym.github.io/repohub/`. Callback URL: the same URL (the device flow doesn't use it).
3. After creating it, tick **Enable Device Flow** and copy the **Client ID**. Do not generate a client secret.
4. Put it in `.env` as `VITE_GITHUB_CLIENT_ID=...` (see `.env.example`) for local builds, and set it as the repository variable `GITHUB_OAUTH_CLIENT_ID` for CI builds. It gets built into the app, so end users only ever see the **Sign in with GitHub** button.

Requested scopes: `repo` (so private repos are included), `read:org`, `read:user`.

### 2. iOS

On a Mac with Xcode:

```bash
npm run ios:init       # generates src-tauri/gen/apple (commit it)
npm run ios:dev        # run in the simulator or on a connected device
npm run ios:build      # archive for TestFlight / App Store (needs a signing team)
```

The UI switches to a phone layout with a slide-in sidebar and safe-area insets. iOS has no tray, so the menu-bar code is compiled only for desktop (`#[cfg(desktop)]`).

### Releases & in-app updates

Double-click **`Release RepoHub.command`**, or run `npm run release` (add `-- 0.3.0` to pick a version). It:

1. creates the update-signing key on first run (`~/.tauri/repohub-updater.key`; back it up), puts the public key in `tauri.conf.json`, and stores the private key as the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` using `gh`
2. bumps the version (the patch number by default) and commits
3. tags `vX.Y.Z` and pushes

GitHub Actions then builds a universal macOS `.dmg` and a Windows installer. It signs the update bundles and publishes a release with `latest.json`, which takes about 10–15 minutes. Installed copies of RepoHub then show **Update ready — restart now?** on their next check. Versions like `0.4.0-beta.1` become pre-releases, which only the Beta channel receives.

**First install on macOS:** download the `.dmg` from the latest release, drag RepoHub to Applications and open it. Because the build isn't notarized by Apple, macOS blocks the first launch. Go to System Settings → Privacy & Security and click **Open Anyway**; you only do this once. Updates after that install from inside the app.

## How it works

```
src/                    React UI (Vite, TypeScript, no UI framework)
  lib/github.ts         GraphQL + REST client, all queries in one place
  lib/queries.ts        TanStack Query hooks (polling, caching, tray sync)
  lib/summary.ts        stats, "needs attention", menu-bar title
  lib/categories.ts     default categories + keyword auto-classification
  lib/icons.ts          repo icon discovery and caching
  lib/state.tsx         settings, categories, assignments, tracked repos, teams
  lib/updater.ts        update scheduler + inline update state
  lib/themes.ts         the 10 color themes and how their tokens are derived
  components/charts.tsx SVG charts (stacked columns, heatmap, bars, donut, timeline, status meter)
  views/                Dashboard, RepoDetail, Discover, Teams, Settings, TrayPopover
src-tauri/
  src/lib.rs            keychain commands, tray summary state, window behavior
  src/tray.rs           menu-bar / tray item, menu and popover window
  src/updater.rs        background update check / download / install + relaunch
scripts/validate-graphql.mjs   checks every query against GitHub's public schema
```

- **Fast.** One GraphQL request per 25 repos loads everything the dashboard needs. A full refresh of 100 repos costs a few API points out of the 5,000/hour budget, and the remaining budget is shown in the header. The JS bundle is about 85 kB gzipped and desktop installers are typically 10–15 MB.
- **Progress %.** The nearest open milestone's completion if the repo has one, otherwise closed ÷ total issues.
- **Local data.** Settings, categories, assignments and the icon cache live in the app's data folder (`repohub.json`, `icons.json`). The token is stored in the keychain only.

## Roadmap

- [ ] Team management: sync local teams with GitHub org teams, share category layouts across a team, per-member activity
- [ ] Shared team dashboards (hosted sync)
- [ ] Notifications when CI breaks or a milestone becomes overdue
- [ ] Android build (Tauri supports it, but it's untested here)
- [ ] Optional menu-bar-only mode on macOS (no Dock icon)

## License

MIT

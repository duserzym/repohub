#!/usr/bin/env node
// Publish a RepoHub release:  npm run release            (next patch version, or the current one if never released)
//                             npm run release -- 0.2.0   (explicit version)
//
// What it does, in order:
//  1. Makes sure the update-signing key exists (~/.tauri/repohub-updater.key, created on first run)
//     and that its public half is in src-tauri/tauri.conf.json.
//  2. Makes sure the GitHub secret TAURI_SIGNING_PRIVATE_KEY holds that key (via `gh`).
//  3. Sets the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
//  4. Commits everything, tags vX.Y.Z and pushes. GitHub Actions then builds the macOS .dmg and
//     Windows installer, signs the update bundles and publishes the release with latest.json, which
//     installed copies of RepoHub pick up as an in-app update.
// The private key never leaves this Mac except into the encrypted GitHub secret.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8", shell: "/bin/bash", ...opts }).trim();
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit", shell: "/bin/bash" });
const step = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const ok = (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const die = (s) => {
  console.error(`\n\x1b[31m✕ ${s}\x1b[0m`);
  process.exit(1);
};

// ---------------------------------------------------------------- preflight
try {
  sh("gh auth status");
} catch {
  die("GitHub CLI isn't signed in. Run `gh auth login` once, then try again.");
}
const repo = sh("gh repo view --json nameWithOwner -q .nameWithOwner");
ok(`GitHub repo ${repo}`);
if (sh("git rev-parse --abbrev-ref HEAD") !== "main") die("Switch to the main branch first.");
run("git pull --ff-only --quiet");
run("git fetch --tags --quiet");

// ------------------------------------------------------------- signing key
step("Update signing key");
const keyDir = join(homedir(), ".tauri");
const key = join(keyDir, "repohub-updater.key");
mkdirSync(keyDir, { recursive: true });
let newKey = false;
if (!existsSync(key)) {
  if (!existsSync(join(root, "node_modules/.bin/tauri"))) run("npm ci --no-audit --no-fund");
  run(`npx tauri signer generate -w "${key}" -p "" --ci`);
  newKey = true;
  ok(`Created ${key} — back it up (e.g. in your password manager). Without it, installed apps can't verify future updates.`);
} else ok(`Using ${key}`);

const confPath = join(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const pub = readFileSync(`${key}.pub`, "utf8").trim();
if (conf.plugins.updater.pubkey !== pub) {
  conf.plugins.updater.pubkey = pub;
  ok("Public key written to src-tauri/tauri.conf.json");
}

const secrets = sh("gh secret list --json name -q '.[].name'").split("\n");
if (newKey || !secrets.includes("TAURI_SIGNING_PRIVATE_KEY")) {
  run(`gh secret set TAURI_SIGNING_PRIVATE_KEY < "${key}"`);
  ok("GitHub secret TAURI_SIGNING_PRIVATE_KEY set");
} else ok("GitHub secret TAURI_SIGNING_PRIVATE_KEY already set");

// ----------------------------------------------------------------- version
step("Version");
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const tags = sh("git tag --list 'v*'").split("\n").filter(Boolean);
const bump = (v) => v.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, a, b, c) => `${a}.${b}.${+c + 1}`);
let version = process.argv[2]?.replace(/^v/, "");
if (!version) version = tags.includes(`v${pkg.version}`) ? bump(pkg.version) : pkg.version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) die(`"${version}" isn't a version like 1.2.3`);
if (tags.includes(`v${version}`)) die(`v${version} was already released. Pass a newer version: npm run release -- x.y.z`);

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
const cargoPath = join(root, "src-tauri/Cargo.toml");
writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
run(`npm install --package-lock-only --no-audit --no-fund --silent`);
ok(`v${version}${version.includes("-") ? " (pre-release → Beta channel only)" : ""}`);

// ---------------------------------------------------------------- publish
step("Publish");
run("git add -A");
try {
  sh(`git commit -m "Release v${version}"`);
} catch {
  /* nothing to commit */
}
run(`git tag -a v${version} -m "RepoHub v${version}"`);
run("git push --quiet && git push --quiet origin v" + version);
ok(`Pushed v${version}`);

console.log(`
GitHub is now building the installers (about 10–15 minutes):
  https://github.com/${repo}/actions

When it finishes, the release appears here with the .dmg:
  https://github.com/${repo}/releases/tag/v${version}

Installed copies of RepoHub will offer "Update ready — restart now?" on their next check.`);

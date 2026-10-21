// One-time setup for signed in-app updates. Run on your own machine:
//   npm run updater:setup
// 1. Generates a minisign key pair at ~/.tauri/repohub-updater.key (private stays on your machine)
// 2. Writes the public key into src-tauri/tauri.conf.json
// 3. Uploads the private key as the GitHub Actions secret TAURI_SIGNING_PRIVATE_KEY (if `gh` is signed in)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".tauri");
const key = join(dir, "repohub-updater.key");
mkdirSync(dir, { recursive: true });
if (!existsSync(key)) {
  execSync(`npx tauri signer generate -w "${key}" -p "" --ci`, { stdio: "inherit" });
} else {
  console.log(`Using existing key ${key}`);
}
const pub = readFileSync(`${key}.pub`, "utf8").trim();
const confPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.plugins.updater.pubkey = pub;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
console.log("✓ Public key written to src-tauri/tauri.conf.json — commit this change.");
try {
  execSync(`gh secret set TAURI_SIGNING_PRIVATE_KEY < "${key}"`, { stdio: "inherit", shell: "/bin/bash" });
  console.log("✓ GitHub secret TAURI_SIGNING_PRIVATE_KEY set.");
} catch {
  console.log(`! Couldn't set the secret automatically. Add the contents of ${key} as the repository secret TAURI_SIGNING_PRIVATE_KEY.`);
}
console.log("Keep the private key safe — losing it means existing installs can't verify future updates.");

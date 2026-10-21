// repohub-ideas planner v1
// Runs daily in GitHub Actions (see .github/workflows/refine-plans.yml).
// For every idea in ideas/*.md that is new or changed (or whose plan is over a
// week old) it:
//   1. searches GitHub for related, ready-to-use projects
//   2. asks a language model to write or refine a development plan
//   3. writes plans/<idea>.md and refreshes the README index
// Model: GitHub Models (no setup, uses the workflow's GITHUB_TOKEN) by default.
// Set the repository secret ANTHROPIC_API_KEY to use Claude instead, and the
// repository variable MODEL to pick a specific model.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.MODEL || (ANTHROPIC ? "claude-sonnet-4-6" : "openai/gpt-4o");
const FORCE = process.env.FORCE === "true";
const ONLY = (process.env.ONLY || "").trim();
const MAX_PER_RUN = 12;
const WEEK = 7 * 864e5;

// ------------------------------------------------------------- front matter
function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}
const yaml = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(String(v)));
const frontMatter = (meta) => `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${yaml(v)}`).join("\n")}\n---\n`;
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

// ------------------------------------------------------------ GitHub search
const STOP = new Set("a an and the for of to in on with using use from into by app tool tools project projects idea new build make simple based about".split(" "));
async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
  return r.json();
}
async function related(title, tags, body) {
  const words = `${title} ${body.slice(0, 300)}`.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  const keys = [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 4);
  const queries = [];
  if (tags.length) queries.push(tags.slice(0, 3).map((t) => `topic:${t.toLowerCase().replace(/\s+/g, "-")}`).join(" "));
  if (keys.length) queries.push(`${keys.join(" ")} in:name,description,readme`);
  const seen = new Map();
  for (const q of queries) {
    try {
      const d = await gh(`/search/repositories?q=${encodeURIComponent(`${q} archived:false stars:>=5`)}&sort=stars&order=desc&per_page=6`);
      for (const r of d.items ?? []) if (!seen.has(r.full_name)) seen.set(r.full_name, r);
    } catch (e) {
      console.warn("search failed:", e.message);
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 8)
    .map((r) => ({
      name: r.full_name, url: r.html_url, stars: r.stargazers_count, language: r.language,
      license: r.license?.spdx_id ?? null, pushed: r.pushed_at?.slice(0, 10), description: (r.description ?? "").slice(0, 200),
    }));
}

// -------------------------------------------------------------------- model
async function complete(system, user) {
  if (ANTHROPIC) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j.content.map((c) => c.text ?? "").join("");
  }
  const r = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`GitHub Models ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.choices[0].message.content;
}

const SYSTEM = `You are a pragmatic senior research-software engineer. You turn rough project ideas into concrete, realistic development plans for a scientist who builds open-source tools.
Write GitHub-flavored Markdown only (no front matter, no surrounding code fence). Be specific and concise; prefer reusing the existing projects listed when they fit, and say exactly how.
Use exactly these sections, in this order:
## Summary
## Goals
## Reuse before you build
## Proposed approach
## Milestones
## First issues to open
## Risks and open questions
## Next step today
## Changes since last plan
Rules: Milestones are a task-list (- [ ] …) with rough effort estimates. "First issues" is 5–8 bullet points, each a ready-to-paste issue title with one line of detail. If there is no previous plan, write "First plan." under "Changes since last plan". Keep earlier decisions unless the idea text now contradicts them.`;

// --------------------------------------------------------------------- main
mkdirSync("plans", { recursive: true });
const files = existsSync("ideas") ? readdirSync("ideas").filter((f) => f.endsWith(".md")).sort() : [];
let refined = 0;
for (const file of files) {
  const slug = file.replace(/\.md$/, "");
  if (ONLY && slug !== ONLY) continue;
  const text = readFileSync(`ideas/${file}`, "utf8");
  const { meta, body } = parse(text);
  if (meta.status === "archived") continue;
  const hash = sha(text);
  const planPath = `plans/${file}`;
  const prev = existsSync(planPath) ? parse(readFileSync(planPath, "utf8")) : null;
  const age = prev?.meta.refined_at ? Date.now() - Date.parse(prev.meta.refined_at) : Infinity;
  const changed = !prev || prev.meta.source_hash !== hash;
  if (!FORCE && !ONLY && !changed && age < WEEK) continue;
  if (refined >= MAX_PER_RUN) break;

  const title = meta.title || slug;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  console.log(`Refining "${title}" (${changed ? "idea changed" : "weekly refresh"})`);
  const repos = await related(title, tags, body);
  const user = [
    `# Idea: ${title}`,
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    meta.status ? `Status: ${meta.status}` : "",
    "",
    body.trim() || "(no description yet)",
    "",
    "## Related open-source projects found on GitHub",
    repos.length
      ? repos.map((r) => `- ${r.name} (★${r.stars}, ${r.language ?? "?"}, ${r.license ?? "no license"}, updated ${r.pushed}): ${r.description} — ${r.url}`).join("\n")
      : "(none found)",
    "",
    prev ? `## Previous plan (refine it)\n\n${prev.body.trim()}` : "## Previous plan\n\n(none)",
  ].join("\n");
  let plan;
  try {
    plan = (await complete(SYSTEM, user)).replace(/^```(?:markdown|md)?\n([\s\S]*)\n```\s*$/m, "$1").trim();
  } catch (e) {
    console.error(`  ✕ ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  const out = frontMatter({
    idea: slug,
    title,
    source_hash: hash,
    model: MODEL,
    refined_at: new Date().toISOString(),
    related: repos.map((r) => r.name),
  }) + `\n${plan}\n`;
  writeFileSync(planPath, out);
  refined++;
  console.log(`  ✓ wrote ${planPath}`);
}

// ------------------------------------------------------------ README index
const rows = files.map((file) => {
  const { meta } = parse(readFileSync(`ideas/${file}`, "utf8"));
  const p = existsSync(`plans/${file}`) ? parse(readFileSync(`plans/${file}`, "utf8")).meta : null;
  return `| [${meta.title || file}](ideas/${file}) | ${meta.status || "idea"} | ${p ? `[plan](plans/${file}) · ${String(p.refined_at).slice(0, 10)}` : "—"} |`;
});
writeFileSync(
  "README.md",
  `# Idea Pad\n\nProject ideas captured in [RepoHub](https://duserzym.github.io/repohub/). A daily GitHub Action searches for related projects and writes or refines a development plan for each new or changed idea.\n\n| Idea | Status | Plan |\n| --- | --- | --- |\n${rows.join("\n") || "| — | — | — |"}\n`,
);
console.log(`Done: ${refined} plan(s) written.`);

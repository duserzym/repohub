// Validates RepoHub's GraphQL queries against GitHub's public schema.
// Usage: npm i --no-save graphql @octokit/graphql-schema esbuild && node scripts/validate-graphql.mjs
import { build } from "esbuild";
import { buildSchema, parse, validate } from "graphql";
import { schema } from "@octokit/graphql-schema";

const out = await build({
  stdin: { contents: `export { QUERIES } from "./src/lib/github.ts"; export { PAD_QUERIES } from "./src/lib/ideas.ts";`, resolveDir: process.cwd(), loader: "ts" },
  plugins: [{
    name: "raw",
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: new URL(a.path.replace(/\?raw$/, ""), `file://${a.resolveDir}/`).pathname, namespace: "raw" }));
      b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({ contents: (await import("node:fs")).readFileSync(a.path, "utf8"), loader: "text" }));
    },
  }],
  bundle: true, write: false, format: "esm", platform: "neutral", external: ["@tauri-apps/*"],
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const s = buildSchema(schema.idl, { assumeValidSDL: true });
let bad = 0;
for (const [name, q] of Object.entries({ ...mod.QUERIES, ...mod.PAD_QUERIES })) {
  const errors = validate(s, parse(q));
  console.log(`${errors.length ? "✗" : "✓"} ${name}`);
  for (const e of errors) { bad++; console.log("   ", e.message); }
}
process.exit(bad ? 1 : 0);

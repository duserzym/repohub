import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";

// Markdown → safe HTML, fast enough to run on every keystroke (deferred).
// Heavy extras load on demand and trigger a re-render when ready:
//   code highlighting (highlight.js) · math (KaTeX) · diagrams (Mermaid, rendered after mount)

type Hl = typeof import("./hl");
type Mt = typeof import("./math");
let hl: Hl | null = null;
let mt: Mt | null = null;
let version = 0;
const subs = new Set<() => void>();
const bump = () => {
  version++;
  subs.forEach((f) => f());
};
export const libs = {
  subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
  version: () => version,
};

let hlP: Promise<void> | null = null;
let mtP: Promise<void> | null = null;
const FENCE = /^(\s*)(```|~~~)\s*([\w+#.-]+)?/m;
const MATH = /\$\$[\s\S]+?\$\$|(^|[^\\$\w])\$(?!\s)[^$\n]*?[^\s$]\$(?!\w)/;

/** Starts loading the extras this source needs (no-op once loaded). */
export function prepare(src: string) {
  if (!hl && !hlP && FENCE.test(src)) hlP = import("./hl").then((m) => { hl = m; bump(); }).catch(() => {});
  if (!mt && !mtP && MATH.test(src)) mtP = import("./math").then((m) => { mt = m; bump(); }).catch(() => {});
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function slug(text: string) {
  return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
}

const md = new Marked({ gfm: true, breaks: false });
md.use({
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (s: string) => s.indexOf("$$"),
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };
      },
      renderer: (t) => (mt ? `<div class="math-block">${mt.tex(t.text, true)}</div>` : `<pre class="math-pending">$$${esc(t.text)}$$</pre>`),
    },
    {
      name: "mathInline",
      level: "inline",
      start: (s: string) => s.indexOf("$"),
      tokenizer(src: string) {
        const m = /^\$(?!\s)([^$\n]*?[^\s$])\$(?!\w)/.exec(src);
        if (m) return { type: "mathInline", raw: m[0], text: m[1] };
      },
      renderer: (t) => (mt ? mt.tex(t.text, false) : `<code class="math-pending">$${esc(t.text)}$</code>`),
    },
  ],
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const l = (lang ?? "").trim().split(/\s+/)[0];
      if (l === "mermaid") return `<div class="mermaid-block" data-src="${encodeURIComponent(text)}"><pre><code>${esc(text)}</code></pre></div>`;
      const body = (hl && l && hl.highlight(text, l)) || esc(text);
      const tree = l === "tree" || (!l && /[├└]──/.test(text));
      return `<div class="code-block${tree ? " tree" : ""}">${l && l !== "tree" ? `<span class="code-lang">${esc(l)}</span>` : ""}<button class="code-copy" type="button" data-copy>Copy</button><pre><code class="hljs">${body}</code></pre></div>`;
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(inner)}">${inner}</h${depth}>`;
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return `<input type="checkbox" class="task"${checked ? " checked" : ""}> `;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`;
    },
  },
});

/** Strips YAML front matter (--- … ---) from the top of a document. */
export function stripFrontMatter(src: string) {
  return src.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export function renderMarkdown(src: string): string {
  prepare(src);
  const html = md.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-src", "data-copy", "data-task"] });
}

/** Toggles the n-th task checkbox (- [ ] / - [x]) in the source, ignoring code blocks. */
export function toggleTask(src: string, n: number): string {
  const lines = src.split("\n");
  let inFence = false;
  let i = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line);
    if (!m) continue;
    if (i++ === n) {
      lines[li] = m[1] + (m[2] === " " ? "[x]" : "[ ]") + line.slice(m[0].length);
      return lines.join("\n");
    }
  }
  return src;
}

/** Word count + reading time for the status bar. */
export function stats(src: string) {
  const words = (src.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const tasks = (src.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/gm) ?? []).length;
  const done = (src.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]/gm) ?? []).length;
  return { words, tasks, done };
}

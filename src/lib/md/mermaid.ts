// Mermaid diagrams: loaded only when a note has a ```mermaid block.
type M = typeof import("mermaid").default;
let mp: Promise<M> | null = null;
let theme = "";
const cache = new Map<string, string>();
let n = 0;

export async function renderDiagrams(root: HTMLElement, dark: boolean) {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block[data-src]")];
  if (!blocks.length) return;
  mp ??= import("mermaid").then((m) => m.default);
  const mermaid = await mp;
  const t = dark ? "dark" : "neutral";
  if (theme !== t) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: t, fontFamily: "inherit" });
    theme = t;
  }
  for (const el of blocks) {
    const src = decodeURIComponent(el.dataset.src ?? "");
    const key = `${t}\n${src}`;
    let svg = cache.get(key);
    if (!svg) {
      try {
        svg = (await mermaid.render(`mmd-${++n}`, src)).svg;
        if (cache.size > 60) cache.clear();
        cache.set(key, svg);
      } catch (e) {
        el.classList.add("mermaid-error");
        el.setAttribute("title", String((e as Error).message ?? e).slice(0, 300));
        continue;
      }
    }
    if (!el.isConnected) return;
    el.innerHTML = svg;
    el.classList.add("rendered");
  }
}

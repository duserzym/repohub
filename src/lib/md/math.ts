// KaTeX, loaded only when a note contains $…$ or $$…$$.
import katex from "katex";
import "katex/dist/katex.min.css";

export function tex(src: string, display: boolean): string {
  return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
}

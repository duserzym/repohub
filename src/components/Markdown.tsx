import { useDeferredValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { libs, renderMarkdown } from "../lib/md/render";
import { openUrl } from "../lib/platform";

const isDark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

/**
 * Rendered Markdown (GitHub-flavoured: tables, task lists, code, math, Mermaid).
 * Rendering is deferred so typing in the editor never waits on the preview.
 */
export function Markdown({ source, onToggleTask, className = "" }: { source: string; onToggleTask?: (index: number) => void; className?: string }) {
  const deferred = useDeferredValue(source);
  const v = useSyncExternalStore(libs.subscribe, libs.version);
  const html = useMemo(() => renderMarkdown(deferred), [deferred, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLInputElement>("input.task").forEach((c, i) => {
      c.dataset.task = String(i);
      c.disabled = !onToggleTask;
    });
    if (el.querySelector(".mermaid-block")) void import("../lib/md/mermaid").then((m) => m.renderDiagrams(el, isDark()));
  }, [html, onToggleTask]);

  return (
    <div
      ref={ref}
      className={`markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement && t.classList.contains("task")) {
          e.preventDefault();
          onToggleTask?.(Number(t.dataset.task));
          return;
        }
        const copy = t.closest<HTMLElement>("[data-copy]");
        if (copy) {
          const code = copy.parentElement?.querySelector("pre")?.textContent ?? "";
          void navigator.clipboard?.writeText(code).then(() => {
            copy.textContent = "Copied";
            setTimeout(() => (copy.textContent = "Copy"), 1200);
          });
          return;
        }
        const a = t.closest("a");
        if (a) {
          const h = a.getAttribute("href") ?? "";
          e.preventDefault();
          if (h.startsWith("#") && !h.startsWith("#/")) {
            ref.current?.querySelector(`[id="${CSS.escape(h.slice(1))}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (/^https?:|^mailto:/i.test(h)) void openUrl(h);
          else if (h.startsWith("#/")) location.hash = h;
        }
      }}
    />
  );
}

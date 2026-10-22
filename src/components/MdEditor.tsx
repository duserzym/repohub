import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Icon } from "./Icon";

// A plain <textarea> with Markdown conveniences — instant to load and type in.
//   Enter continues lists / checklists (Enter on an empty item ends the list)
//   Tab / Shift+Tab indent · ⌘B bold · ⌘I italic · ⌘K link · ⌘E code · ⌘⇧X checkbox · ⌘⇧H heading
//   Pasting a URL over selected text makes a link.

export const SNIPPETS: { id: string; label: string; text: string }[] = [
  {
    id: "tree",
    label: "Project structure",
    text: "```tree\nmy-project/\n├── README.md\n├── pyproject.toml\n├── src/\n│   └── my_project/\n│       ├── __init__.py\n│       └── core.py\n├── tests/\n│   └── test_core.py\n└── docs/\n```\n",
  },
  { id: "tasks", label: "Checklist", text: "- [ ] First step\n- [ ] Second step\n- [ ] Third step\n" },
  { id: "table", label: "Table", text: "| Item | Notes | Status |\n| --- | --- | --- |\n|  |  |  |\n" },
  { id: "mermaid", label: "Diagram (Mermaid)", text: "```mermaid\nflowchart LR\n  data[Raw data] --> clean[Clean] --> model[Model] --> plot[Figures]\n```\n" },
  { id: "code", label: "Code block", text: "```python\n\n```\n" },
  { id: "math", label: "Equation", text: "$$\n\\frac{^{206}Pb}{^{238}U} = e^{\\lambda t} - 1\n$$\n" },
];

export type MdCommand = "bold" | "italic" | "code" | "link" | "task" | "heading";
export interface MdEditorHandle {
  focus(): void;
  /** Focuses and puts the caret at `pos` (scrolling it into view); -1 = keep the current caret. */
  focusAt(pos: number): void;
  insert(text: string): void;
  run(cmd: MdCommand): void;
}

type Props = {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  onSave?(): void;
  /** Scroll position as a 0–1 fraction (for syncing a preview). */
  onScrollRatio?(r: number): void;
  className?: string;
};

export const MdEditor = forwardRef<MdEditorHandle, Props>(function MdEditor({ value, onChange, placeholder, onSave, onScrollRatio, className = "" }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    focusAt: (pos) => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      if (pos < 0) return;
      el.setSelectionRange(pos, pos);
      // Scroll the caret line into view (textarea has no API for this).
      const line = el.value.slice(0, pos).split("\n").length;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
      el.scrollTop = Math.max(0, (line - 4) * lh);
    },
    insert: (t) => insertBlock(t),
    run,
  }));

  /** Replaces the selection, keeping the browser's undo history where possible. */
  const replace = (text: string, selStart?: number, selEnd?: number) => {
    const el = ta.current!;
    el.focus();
    const ok = document.queryCommandSupported?.("insertText") && document.execCommand("insertText", false, text);
    if (!ok) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      onChange(el.value);
    }
    if (selStart != null) el.setSelectionRange(selStart, selEnd ?? selStart);
  };

  const wrap = (before: string, after = before, placeholderText = "text") => {
    const el = ta.current!;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = el.value.slice(s, e) || placeholderText;
    replace(before + sel + after, s + before.length, s + before.length + sel.length);
  };

  const lineRange = () => {
    const el = ta.current!;
    const v = el.value;
    const start = v.lastIndexOf("\n", el.selectionStart - 1) + 1;
    let end = v.indexOf("\n", el.selectionEnd - (el.selectionEnd > el.selectionStart && v[el.selectionEnd - 1] === "\n" ? 1 : 0));
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end) };
  };

  const editLines = (fn: (line: string) => string) => {
    const el = ta.current!;
    const { start, end, text } = lineRange();
    const out = text.split("\n").map(fn).join("\n");
    el.setSelectionRange(start, end);
    replace(out, start, start + out.length);
  };

  const insertBlock = (text: string) => {
    const el = ta.current!;
    const v = el.value;
    const at = el.selectionStart;
    const needNl = at > 0 && v[at - 1] !== "\n" ? "\n" : "";
    const pre = needNl + (at > 0 && v.slice(0, at).trim() && !v.slice(0, at).endsWith("\n\n") ? "\n" : "");
    replace(pre + text);
  };

  function run(cmd: MdCommand) {
    const el = ta.current!;
    el.focus();
    if (cmd === "bold") wrap("**");
    else if (cmd === "italic") wrap("*");
    else if (cmd === "code") wrap("`", "`", "code");
    else if (cmd === "link") {
      const s = el.selectionStart, sel = el.value.slice(s, el.selectionEnd) || "link";
      replace(`[${sel}](https://)`, s + sel.length + 3, s + sel.length + 11);
    } else if (cmd === "task")
      editLines((l) => {
        const m = /^(\s*)(?:[-*+]\s+)?(\[[ xX]\]\s+)?(.*)$/.exec(l)!;
        return m[2] ? `${m[1]}- ${m[3]}` : `${m[1]}- [ ] ${m[3]}`;
      });
    else if (cmd === "heading")
      editLines((l) => {
        const m = /^(#{1,6})\s/.exec(l);
        return !m ? `## ${l}` : m[1].length >= 4 ? l.replace(/^#{1,6}\s/, "") : `#${l}`;
      });
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === "s") { e.preventDefault(); onSave?.(); return; }
    const cmd: MdCommand | null = mod && !e.shiftKey
      ? ({ b: "bold", i: "italic", e: "code", k: "link" } as Record<string, MdCommand>)[k] ?? null
      : mod && e.shiftKey && k === "x" ? "task" : mod && e.shiftKey && k === "h" ? "heading" : null;
    if (cmd) { e.preventDefault(); run(cmd); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) editLines((l) => l.replace(/^( {1,2}|\t)/, ""));
      else if (el.selectionStart === el.selectionEnd && !/^\s*([-*+]|\d+[.)])\s/.test(lineRange().text)) replace("  ");
      else editLines((l) => "  " + l);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod && !e.nativeEvent.isComposing && el.selectionStart === el.selectionEnd) {
      const { start, text } = lineRange();
      const caret = el.selectionStart;
      const before = text.slice(0, caret - start);
      const m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(before);
      if (!m) return;
      e.preventDefault();
      if (before.trim() === m[0].trim() && text.slice(caret - start).trim() === "") {
        // Empty item: end the list.
        el.setSelectionRange(start, start + text.length);
        replace("");
        return;
      }
      const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
      replace(`\n${m[1]}${marker}${m[5]}${m[6] ? "[ ] " : ""}`);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const el = e.currentTarget;
    if (/^https?:\/\/\S+$/.test(text.trim()) && el.selectionStart !== el.selectionEnd) {
      e.preventDefault();
      const sel = el.value.slice(el.selectionStart, el.selectionEnd);
      replace(`[${sel}](${text.trim()})`);
    }
  };

  return (
    <textarea
      ref={ta}
      className={`md-input ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onScroll={onScrollRatio ? (e) => { const t = e.currentTarget; onScrollRatio(t.scrollTop / Math.max(1, t.scrollHeight - t.clientHeight)); } : undefined}
      placeholder={placeholder}
      spellCheck
      aria-label="Note (Markdown)"
    />
  );
});

/** Formatting buttons + snippet menu for an MdEditor. */
export function MdToolbar({ editor }: { editor: React.RefObject<MdEditorHandle> }) {
  const [open, setOpen] = useState(false);
  const run = (c: MdCommand) => editor.current?.run(c);
  // onMouseDown preventDefault keeps the editor's selection while clicking buttons.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="md-toolbar" role="toolbar" aria-label="Formatting" onMouseDown={keep}>
      <button type="button" onClick={() => run("heading")} title="Heading (⌘⇧H)">H</button>
      <button type="button" onClick={() => run("bold")} title="Bold (⌘B)"><b>B</b></button>
      <button type="button" onClick={() => run("italic")} title="Italic (⌘I)"><i>I</i></button>
      <button type="button" onClick={() => run("code")} title="Inline code (⌘E)"><code>{"<>"}</code></button>
      <button type="button" onClick={() => run("link")} title="Link (⌘K)"><Icon name="external" size={13} /></button>
      <button type="button" onClick={() => run("task")} title="Checkbox (⌘⇧X)"><Icon name="check" size={13} /></button>
      <span className="md-toolbar-sep" />
      <div className="md-insert">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Insert a template"><Icon name="plus" size={13} /> Insert</button>
        {open && (
          <div className="md-menu" onMouseLeave={() => setOpen(false)}>
            {SNIPPETS.map((s) => (
              <button key={s.id} type="button" onClick={() => { setOpen(false); editor.current?.insert(s.text); }}>{s.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

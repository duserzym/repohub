import { useState } from "react";
import { CATEGORY_COLORS, DEFAULT_CATEGORIES, slug } from "../lib/categories";
import { useApp } from "../lib/state";
import type { Category } from "../lib/types";
import { Icon } from "./Icon";

export function CategoryManager({ onClose }: { onClose(): void }) {
  const { categories, update } = useApp();
  const [draft, setDraft] = useState<Category[]>(() => categories.map((c) => ({ ...c, keywords: [...c.keywords] })));

  const set = (i: number, patch: Partial<Category>) => setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return d;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const add = () =>
    setDraft((d) => [...d, { id: `new-${Date.now()}`, name: "New category", color: CATEGORY_COLORS[d.length % CATEGORY_COLORS.length], keywords: [] }]);

  const save = () => {
    const used = new Set<string>();
    const cleaned = draft
      .filter((c) => c.name.trim())
      .map((c) => {
        let id = c.id.startsWith("new-") ? slug(c.name) : c.id;
        while (used.has(id)) id += "-2";
        used.add(id);
        return { ...c, id, name: c.name.trim(), keywords: c.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean) };
      });
    update("categories", cleaned);
    // Drop assignments pointing at deleted categories.
    update("assignments", (a) => Object.fromEntries(Object.entries(a).filter(([, v]) => used.has(v) || v === "uncategorized")));
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Edit categories" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Categories</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <p className="muted small">
          Repos are auto-sorted by keywords found in their name, description and topics. Picking a category on a repo card always wins.
        </p>
        <div className="cat-edit-list">
          {draft.map((c, i) => (
            <div className="cat-edit" key={c.id}>
              <div className="row gap">
                <input type="color" value={c.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="Color" />
                <input className="input grow" value={c.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Name" />
                <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
                  <Icon name="chevron" className="rot-up" />
                </button>
                <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === draft.length - 1}>
                  <Icon name="chevron" className="rot-down" />
                </button>
                <button className="icon-btn danger" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} aria-label="Delete">
                  <Icon name="trash" />
                </button>
              </div>
              <input
                className="input small"
                value={c.keywords.join(", ")}
                placeholder="Keywords, comma separated (e.g. isotope, zircon)"
                onChange={(e) => set(i, { keywords: e.target.value.split(",") })}
                aria-label="Keywords"
              />
            </div>
          ))}
        </div>
        <footer>
          <button className="btn ghost" onClick={add}>
            <Icon name="plus" /> Add category
          </button>
          <button className="btn ghost" onClick={() => setDraft(DEFAULT_CATEGORIES)}>
            Reset defaults
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

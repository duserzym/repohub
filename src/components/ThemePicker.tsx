import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/state";
import { PALETTES } from "../lib/themes";
import type { Settings } from "../lib/types";
import { Icon } from "./Icon";

const MODES: { id: Settings["theme"]; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Split swatch: light base + accent on the left, dark base + accent on the right. */
function Swatch({ id, size = 30 }: { id: string; size?: number }) {
  const p = PALETTES.find((x) => x.id === id)!;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" className="swatch">
      <path d="M15 1a14 14 0 0 0 0 28z" fill={p.light.bg} />
      <path d="M15 1a14 14 0 0 1 0 28z" fill={p.dark.bg} />
      <circle cx="10" cy="15" r="4.5" fill={p.light.accent} />
      <circle cx="20" cy="15" r="4.5" fill={p.dark.accent} />
      <circle cx="15" cy="15" r="14" fill="none" stroke="currentColor" strokeOpacity="0.18" />
    </svg>
  );
}

export function ModeSwitch() {
  const { settings, update } = useApp();
  return (
    <div className="seg text" role="radiogroup" aria-label="Appearance mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={settings.theme === m.id}
          className={settings.theme === m.id ? "on" : ""}
          onClick={() => update("settings", (s) => ({ ...s, theme: m.id }))}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Full grid of themes (Settings → Appearance). */
export function ThemeGrid() {
  const { settings, update } = useApp();
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Color theme">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={settings.palette === p.id}
          className={`theme-opt${settings.palette === p.id ? " on" : ""}`}
          onClick={() => update("settings", (s) => ({ ...s, palette: p.id }))}
        >
          <Swatch id={p.id} />
          <span className="grow">
            <strong>{p.name}</strong>
            <span className="small muted">{p.mood}</span>
          </span>
          {settings.palette === p.id && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
}

/** Compact switcher in the sidebar: one click to open, one click to change. */
export function ThemeQuickMenu() {
  const { settings, update } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const cur = PALETTES.find((p) => p.id === settings.palette) ?? PALETTES[0];
  return (
    <div className="theme-quick" ref={ref}>
      <button className="nav theme-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <Swatch id={cur.id} size={18} />
        <span className="grow truncate">{cur.name}</span>
        <Icon name="chevron" size={13} className={open ? "rot-up" : "rot-down"} />
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          <ModeSwitch />
          <div className="theme-pop-list">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                role="menuitemradio"
                aria-checked={settings.palette === p.id}
                className={`theme-row${settings.palette === p.id ? " on" : ""}`}
                onClick={() => update("settings", (s) => ({ ...s, palette: p.id }))}
              >
                <Swatch id={p.id} size={20} />
                <span className="grow truncate">{p.name}</span>
                {settings.palette === p.id && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

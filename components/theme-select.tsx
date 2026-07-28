"use client";

import * as React from "react";

type Theme = "light" | "warm" | "dark";

const OPTIONS: { id: Theme; label: string; desc: string; swatch: string }[] = [
  { id: "light", label: "Light", desc: "Clean white (default)", swatch: "#ffffff" },
  { id: "warm", label: "Warm", desc: "Soft tan, institutional", swatch: "#f0e7da" },
  { id: "dark", label: "Dark", desc: "Dark mode", swatch: "#12171a" },
];

function applyTheme(t: Theme) {
  if (t === "light") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function ThemeSelect() {
  const [theme, setTheme] = React.useState<Theme>("light");

  React.useEffect(() => {
    let t: Theme = "light";
    try {
      const s = localStorage.getItem("vitals-theme");
      if (s === "warm" || s === "dark") t = s;
    } catch { /* ignore */ }
    queueMicrotask(() => setTheme(t));
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    try { localStorage.setItem("vitals-theme", t); } catch { /* ignore */ }
    applyTheme(t);
  }

  return (
    <section className="role-section theme-select-card">
      <div className="section-head">
        <h2>Appearance</h2>
        <span className="section-count">Saved on this device</span>
      </div>
      <div className="theme-options" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={theme === o.id}
            className={`theme-option${theme === o.id ? " is-active" : ""}`}
            onClick={() => choose(o.id)}
          >
            <span className="theme-swatch" style={{ background: o.swatch }} aria-hidden />
            <span className="theme-option-text">
              <span className="theme-option-label">{o.label}</span>
              <span className="theme-option-desc">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

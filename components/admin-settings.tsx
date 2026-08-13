"use client";

/**
 * Platform settings.
 *
 * These were three switches in component state: they moved, nothing read them,
 * and a refresh put them back. Worse than no switches — an admin who "turned
 * off student uploads" had done nothing at all, and had no way to tell.
 *
 * The two here have real enforcement points (see lib/settings): student
 * uploads are checked in /api/upload, and the watermark fallback is applied
 * when /api/share mints a token. The old third toggle, "Enable General skills",
 * was a build-time concern with nothing to enforce, so it is gone rather than
 * kept as decoration.
 */

import * as React from "react";

interface Settings {
  allowStudentUploads: boolean;
  requireWatermark: boolean;
}

const FIELDS: { key: keyof Settings; label: string; desc: string }[] = [
  {
    key: "allowStudentUploads",
    label: "Allow student uploads",
    desc: "When off, students can't upload. Trainers, advisors and admins still can.",
  },
  {
    key: "requireWatermark",
    label: "Require watermark on shares",
    desc: "Share links with no watermark get one stamped with the sharer's identity.",
  },
];

export function AdminSettings() {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [saving, setSaving] = React.useState<keyof Settings | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't load settings.");
      return;
    }
    setSettings(await res.json());
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, [load]);

  async function toggle(key: keyof Settings) {
    if (!settings) return;
    setSaving(key);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: !settings[key] }),
    }).catch(() => null);
    setSaving(null);
    if (!res?.ok) {
      // Leave the switch where it was. Showing it flipped after a failed save
      // is the exact lie this component was built to stop telling.
      setError("Couldn't save that. Nothing changed.");
      return;
    }
    setSettings(await res.json());
  }

  return (
    <section className="role-section">
      <div className="section-head">
        <h2>Settings</h2>
        <span className="section-count">applies to everyone, saved immediately</span>
      </div>

      {error && <div className="empty-state">{error}</div>}

      {!settings ? (
        <div className="empty-state">Loading...</div>
      ) : (
        <div className="table-card">
          {FIELDS.map((f) => (
            <label key={f.key} className="member-row" style={{ cursor: "pointer" }}>
              <div className="member-id">
                <div>
                  <p className="member-name">{f.label}</p>
                  <p className="member-email">{f.desc}</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings[f.key]}
                disabled={saving === f.key}
                aria-label={f.label}
                onChange={() => void toggle(f.key)}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

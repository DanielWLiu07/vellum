"use client";

import * as React from "react";

import { initials } from "@/lib/avatar";
import { ROLES, type Role } from "@/lib/demo-data";
import { PROFILE_LIMITS, type Profile } from "@/lib/profile-types";

export function ProfileForm() {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [chapter, setChapter] = React.useState("");
  const [role, setRole] = React.useState<Role>("student");
  const [avatarImageId, setAvatarImageId] = React.useState<string | undefined>();
  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const avatarRef = React.useRef<HTMLInputElement>(null);

  // Load the current profile once, then hydrate the form fields from it.
  React.useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Profile | null) => {
        if (!live || !p) return;
        setProfile(p);
        setDisplayName(p.displayName === "You" ? "" : p.displayName);
        setHandle(p.handle);
        setBio(p.bio);
        setChapter(p.chapter);
        setRole(p.role);
        setAvatarImageId(p.avatarImageId);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function pickAvatar(f: File | null | undefined) {
    if (!f) return;
    setError(null);
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) {
        setAvatarImageId((await res.json()).id);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(
          j.error === "content_flagged"
            ? `That photo was flagged by content moderation${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Please choose another.`
            : j.error === "too_large" ? "That image is too large (5 MB max)."
            : j.error === "not_image" ? "Please choose a PNG, JPG, GIF, or WEBP image."
            : "Could not upload that photo.",
        );
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, handle, bio, chapter, role, avatarImageId: avatarImageId ?? null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(
          j.error === "content_flagged"
            ? `Content moderation flagged your name or bio${Array.isArray(j.categories) && j.categories.length ? ` (${j.categories.join(", ")})` : ""}. Please revise it.`
            : j.error === "rate_limited" ? "Too many changes - try again shortly."
            : "Could not save your profile.",
        );
        return;
      }
      const next: Profile = await res.json();
      setProfile(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <div className="dash"><p className="dash-muted">Loading your profile...</p></div>;

  const shownName = displayName.trim() || "You";
  const roleLabel = ROLES.find((r) => r.id === role)?.label ?? "Student";

  return (
    <form className="profile-card" onSubmit={save}>
      <div className="profile-hero">
        <div className="profile-banner" aria-hidden="true" />
        <button
          type="button"
          className="profile-avatar-edit"
          onClick={() => avatarRef.current?.click()}
          disabled={avatarBusy}
          aria-label={avatarImageId ? "Change your photo" : "Add a photo"}
        >
          {avatarImageId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/images/${avatarImageId}`} alt="Your profile photo" />
          ) : (
            <span className="profile-avatar-initials">{initials(shownName)}</span>
          )}
          <span className="profile-avatar-overlay">{avatarBusy ? "Uploading" : "Change"}</span>
        </button>
        <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
      </div>

      <div className="profile-body">
        <div className="profile-headline">
          <h1 className="profile-name">{shownName}</h1>
          {handle && <span className="profile-handle">@{handle}</span>}
          <div className="profile-chips">
            <span className="profile-chip">{roleLabel}</span>
            {chapter.trim() && <span className="profile-chip subtle">{chapter.trim()}</span>}
          </div>
          {avatarImageId && (
            <button type="button" className="profile-remove-photo" onClick={() => setAvatarImageId(undefined)}>Remove photo</button>
          )}
        </div>

        <div className="profile-fields">
          <div className="profile-grid">
            <label className="dash-field"><span>Display name</span>
              <input value={displayName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Jordan Chen" /></label>
            <label className="dash-field"><span>Handle (optional)</span>
              <input value={handle} maxLength={PROFILE_LIMITS.handle} onChange={(e) => setHandle(e.target.value)} placeholder="jordanchen" /></label>
          </div>

          <label className="dash-field"><span>Bio (optional)</span>
            <textarea value={bio} maxLength={PROFILE_LIMITS.bio} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="A line about you - your interests, your competitive events." /></label>

          <div className="profile-grid">
            <label className="dash-field"><span>Chapter</span>
              <input value={chapter} maxLength={PROFILE_LIMITS.chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Toronto Central" /></label>
            <label className="dash-field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select></label>
          </div>
        </div>

        {error && <p className="upload-error" role="alert">{error}</p>}
        <div className="profile-actions">
          <button type="submit" className="cta block" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
          {saved && <span className="profile-saved" role="status">Profile saved</span>}
        </div>
      </div>
    </form>
  );
}

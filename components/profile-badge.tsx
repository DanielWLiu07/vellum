"use client";

import Link from "next/link";
import * as React from "react";

import { initials } from "@/lib/avatar";
import type { Profile } from "@/lib/profile-types";

/**
 * Compact identity chip for the top nav: avatar + name, linking to the profile
 * page. When signed in via HOSA, shows the authenticated member's name;
 * otherwise the local profile name. Renders nothing until loaded to avoid a
 * "You" flash before the real name arrives.
 */
export function ProfileBadge() {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [memberName, setMemberName] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (live && p) setProfile(p); })
      .catch(() => {});
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.signedIn) setMemberName(j.name); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!profile) return null;
  const name = memberName ?? profile.displayName;

  return (
    <Link href="/profile" className="profile-badge" aria-label="Your profile">
      <span className="profile-badge-avatar">
        {profile.avatarImageId ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={`/api/images/${profile.avatarImageId}`} alt="" />
        ) : (
          <span className="profile-badge-initials">{initials(name)}</span>
        )}
      </span>
      <span className="profile-badge-name">{name}</span>
    </Link>
  );
}

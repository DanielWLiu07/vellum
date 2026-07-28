import Link from "next/link";

import { ProfileBadge } from "./profile-badge";

/**
 * The one top bar every member-facing page uses: the brand on the left, and on
 * the right whatever THIS page offers plus the profile badge.
 *
 * Deliberately carries no global navigation. Dashboard / Upload / Guidelines
 * used to live here, but the left sidebar already lists them, so the top bar
 * was a second copy of the same menu. Page-specific links still hang off
 * `children` (e.g. "← Modules", "Play this module") — those are contextual
 * actions, and on pages that own their own sidebar they're the way back out.
 */
export function AppTopnav({ children }: { children?: React.ReactNode }) {
  return (
    <nav className="dash-topnav">
      <Link href="/dashboard" className="dash-brand">HOSA Vitals</Link>
      <span className="dash-topnav-links">
        {children}
        <ProfileBadge />
      </span>
    </nav>
  );
}

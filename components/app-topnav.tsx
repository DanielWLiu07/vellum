import Link from "next/link";

import { NotificationBell } from "./notification-bell";
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
 *
 * The bell sits to the LEFT of the profile badge and on every page, because a
 * notification the member has to go looking for is the gap it exists to close
 * (spec §13.1). It renders nothing at all until it has loaded, so a page with
 * no session never shows an empty bell.
 */
export function AppTopnav({ children }: { children?: React.ReactNode }) {
  return (
    <nav className="dash-topnav">
      <Link href="/dashboard" className="dash-brand">HOSA Vitals</Link>
      <span className="dash-topnav-links">
        {children}
        <NotificationBell />
        <ProfileBadge />
      </span>
    </nav>
  );
}

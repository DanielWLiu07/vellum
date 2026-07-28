import type { Role } from "@/lib/demo-data";

import { AppTopnav } from "./app-topnav";
import { DashSidebar } from "./dash-sidebar";

/**
 * Page frame for the standalone member pages (upload, profile): the shared top
 * bar plus the dashboard's own sidebar, so the navigation is in the same place
 * no matter where you are. Pages that already own a sidebar — the module reader
 * and editor — use AppTopnav directly instead; two sidebars is worse than one.
 */
export function AppShell({ role, active, children }: {
  role: Role;
  /** Sidebar row to highlight (e.g. "upload"). */
  active: string;
  children: React.ReactNode;
}) {
  return (
    <main className="dash-page">
      <AppTopnav />
      <div className="dash-shell">
        <DashSidebar role={role} active={active} />
        <div className="dash-main">{children}</div>
      </div>
    </main>
  );
}

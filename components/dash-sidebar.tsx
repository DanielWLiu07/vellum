"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { ROLES, type Role } from "@/lib/demo-data";
import { DEFAULT_ROLE, NAV } from "@/lib/nav";

/** Carry a non-default role across pages so the menu doesn't snap back. */
function withRole(href: string, role: Role) {
  return role === DEFAULT_ROLE ? href : `${href}?role=${role}`;
}

function sectionHref(id: string, role: Role) {
  const q = role === DEFAULT_ROLE ? "" : `role=${role}&`;
  return `/dashboard?${q}section=${id}`;
}

function itemClass(active: boolean, soon?: boolean, link?: boolean) {
  return `dash-nav-item${link ? " dash-nav-link" : ""}${active ? " is-active" : ""}${soon ? " is-soon" : ""}`;
}

/**
 * The member sidebar. On the dashboard it drives state in place (`onSection` /
 * `onRole` provided); on standalone pages that render inside the same shell the
 * same rows become links back into the dashboard, so the navigation never
 * disappears mid-visit.
 */
export function DashSidebar({ role, active, onRole, onSection }: {
  role: Role;
  /** Nav item id to highlight — a dashboard section, or "upload" / "profile". */
  active: string;
  onRole?: (r: Role) => void;
  onSection?: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Standalone pages have no section state to drive, so "Preview as" reloads
  // the page you're on under the new role instead of jumping you elsewhere.
  const changeRole = (r: Role) => {
    if (onRole) onRole(r);
    else router.push(withRole(pathname, r));
  };

  return (
    <aside className="dash-sidebar">
      <div className="dash-role-select">
        <span className="role-switch-label">Preview as</span>
        <select
          className="role-select"
          value={role}
          aria-label="Preview as role"
          onChange={(e) => changeRole(e.target.value as Role)}
        >
          {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <nav className="dash-nav" aria-label="Sections">
        {NAV[role].map((item) => {
          const isActive = active === item.id;
          const testId = `nav-${item.id}`;
          if (item.href || !onSection) {
            return (
              <Link
                key={item.id}
                href={item.href ? withRole(item.href, role) : sectionHref(item.id, role)}
                className={itemClass(isActive, item.soon, true)}
                aria-current={isActive ? "page" : undefined}
                data-testid={testId}
              >
                <span className="dash-nav-label">{item.label}</span>
                {item.soon && <span className="dash-nav-soon">Soon</span>}
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              className={itemClass(isActive, item.soon)}
              aria-current={isActive}
              data-testid={testId}
              onClick={() => onSection(item.id)}
            >
              <span className="dash-nav-label">{item.label}</span>
              {item.soon && <span className="dash-nav-soon">Soon</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

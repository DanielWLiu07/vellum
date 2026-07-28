"use client";

import * as React from "react";

type Me =
  | { signedIn: true; name: string; chapter: string; role: string }
  | { signedIn: false; authConfigured: boolean };

const ROLE_LABEL: Record<string, string> = { student: "Student", trainer: "Trainer", advisor: "Advisor", admin: "Admin" };

/**
 * Account panel: shows who you're signed in as (a HOSA member, via the main
 * site's signed handoff) and lets you sign out. Signed out, it points you to
 * HOSA and - in demo mode - offers quick demo sign-ins to try the flow.
 */
export function AuthPanel() {
  const [me, setMe] = React.useState<Me | null>(null);

  React.useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setMe(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/dashboard";
  }

  if (!me) return null;

  if (me.signedIn) {
    return (
      <div className="auth-panel">
        <div>
          <p className="auth-panel-title">Signed in via HOSA Canada</p>
          <p className="auth-panel-sub">{me.name}{me.chapter ? ` · ${me.chapter}` : ""} · {ROLE_LABEL[me.role] ?? me.role}</p>
        </div>
        <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <div>
        <p className="auth-panel-title">You&apos;re browsing as a guest</p>
        <p className="auth-panel-sub">Sign in through the HOSA member platform so your resources, folders, and likes are saved under your account.</p>
      </div>
      <div className="auth-panel-actions">
        {/* Demo sign-ins stand in for the HOSA handoff so the flow is testable. */}
        <a className="btn" href="/api/auth/demo?as=student">Demo: student</a>
        <a className="btn" href="/api/auth/demo?as=advisor">Demo: advisor</a>
        <a className="btn primary" href="/api/auth/demo?as=admin">Demo: admin</a>
      </div>
    </div>
  );
}

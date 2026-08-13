/**
 * Whether the person at the keyboard may see an admin surface.
 *
 * Split out and tested because the dashboard got this wrong in the one way
 * that counts: it gated the admin console on the PREVIEWED role from the
 * sidebar switcher. Previewing is a menu-shape affordance — it lives in the
 * ?role= query string, so any member can set it to "admin". Most admin panels
 * survived that because their endpoints refuse a non-admin, but /api/roster
 * answers a student with a reduced 200 of their own chapter rather than a 403,
 * and the overview rendered those rows under "Members", "Chapters" and
 * "Active this week". Real data wearing platform-wide labels.
 *
 * The signature is the guard. This takes the signed identity and nothing else,
 * so there is no parameter a previewed role could arrive through.
 */

/** The signed identity as /api/auth/me reports it; null until it answers. */
export interface SignedIdentity {
  role: string;
}

export type AdminAccess = "checking" | "granted" | "denied";

/**
 * Three states, not two.
 *
 * Folding "we have not heard back yet" into "denied" flashes "you do not have
 * access" at every real admin for as long as /api/auth/me takes, and a page
 * that lies for 200ms is still a page that lies. Folding it into "granted"
 * would be the original bug again.
 *
 * The comparison is exact and deliberately narrow: it mirrors lib/profile's
 * `admin: p.role === "admin"`, so the client asks precisely the question the
 * server will answer. Anything else — an unknown role, a differently-cased
 * one, an empty string — is denied.
 */
export function adminAccess(me: SignedIdentity | null): AdminAccess {
  if (!me) return "checking";
  return me.role === "admin" ? "granted" : "denied";
}

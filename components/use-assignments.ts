"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client side of the assignment loop (lib/assignments + /api/assignments).
 *
 * The dashboard's "Preview as" switcher is a CLIENT-side preview; the server
 * decides what you may actually see or do from your signed session. So these
 * hooks never assume the previewed role is real — they report the API's own
 * `scope`, and turn a refusal into a sentence the member can act on instead of
 * swallowing it.
 */

export type AssignmentKind = "doc" | "deck" | "quiz" | "module";
export type AssignmentStatus = "todo" | "done";
/** What the API says it gave you, which may be narrower than the previewed role. */
export type AssignmentScope = "self" | "chapter" | "all";

export interface Assignment {
  id: string;
  kind: AssignmentKind;
  refId: string;
  title: string;
  assigneeId: string;
  assignedBy: string;
  assignedByName: string;
  chapter: string;
  dueAt: number | null;
  status: AssignmentStatus;
  createdAt: number;
  completedAt: number | null;
}

export interface RosterMember {
  id: string;
  /** Chapter ID — the scoping key. Group and filter on this, never on the name. */
  chapter: string;
  /** Display-only chapter label. Absent on legacy tokens; fall back to `chapter`. */
  chapterName?: string;
  name: string;
  role: string;
  /**
   * Completion counts, computed server-side — never derived from the assignment
   * list. Optional because a reduced roster (a student looking at their own
   * chapter) is expected to OMIT them rather than send zeroes: a zero would read
   * as "no work assigned" for someone who actually has five.
   */
  assigned?: number;
  done?: number;
  lastSeenAt?: number;
}

/** Who the SERVER thinks you are — not who the role switcher is previewing. */
export interface Me {
  id: string;
  name: string;
  role: string;
  /** Chapter ID — the scoping key. Group and filter on this, never on the name. */
  chapter: string;
  /** Display-only chapter label. Absent on legacy tokens; fall back to `chapter`. */
  chapterName?: string;
  signedIn: boolean;
}

export const KIND_LABEL: Record<AssignmentKind, string> = {
  doc: "Document",
  deck: "Flashcards",
  quiz: "Quiz",
  module: "Module",
};

/**
 * Where a given kind of assigned content opens. Every destination carries the
 * caller's `?back=` trail, so finishing an assigned quiz returns you to My
 * assignments rather than dumping you in the generic Quizzes list.
 */
/**
 * Where an assignment opens. `parts` narrows a module assignment to specific
 * sections; passing it lands the student on the first one they were actually
 * asked to read instead of the top of a module where most of it isn't theirs.
 * Ignored for every other kind, none of which has sections.
 */
export function refHref(
  kind: AssignmentKind,
  refId: string,
  viewQuery = "",
  parts?: { id: string }[],
): string {
  if (kind === "doc") return `/view/${refId}${viewQuery}`;
  if (kind === "deck") return `/decks/${refId}${viewQuery}`;
  if (kind === "quiz") return `/quizzes/${refId}${viewQuery}`;
  if (!parts?.length) return `/modules/${refId}${viewQuery}`;
  const ids = encodeURIComponent(parts.map((p) => p.id).join(","));
  // viewQuery already carries a leading "?" when present.
  return `/modules/${refId}${viewQuery ? `${viewQuery}&` : "?"}parts=${ids}`;
}

export function formatDue(dueAt: number | null): string | null {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Every refusal the assignment endpoints can return, in words that say what to
 * do next. "forbidden" especially: previewing a teaching role doesn't grant it,
 * and the member needs to know that rather than see a dead button.
 */
export function errorMessage(status: number, error?: string): string {
  switch (error) {
    case "forbidden":
      return "Your HOSA account can't do that. The role switcher only previews a view — the server checks the role on your session.";
    case "cross_chapter":
      return "That member is in another chapter. Only an admin can assign across chapters.";
    case "unknown_assignee":
      return "Vitals hasn't seen that member yet — they need to open Vitals once from the HOSA platform before they can be assigned work.";
    case "unknown_ref":
      return "That resource no longer exists.";
    case "limit":
      return "That member has hit the limit of 200 assignments.";
    case "not_found":
      return "That assignment is already gone.";
    case "dashboard_disabled":
      return "The dashboard is disabled on this deployment.";
    case "bad_kind":
    case "bad_request":
      return "Vitals couldn't read that request.";
    default:
      return `That didn't work (HTTP ${status}).`;
  }
}

async function readError(res: Response): Promise<{ message: string; code: string }> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return { message: errorMessage(res.status, body?.error), code: body?.error ?? "" };
}

const OFFLINE = "Couldn't reach Vitals. Check the connection and try again.";

/**
 * Identity as the server sees it: the signed session when there is one, else the
 * local profile (the standalone demo). `id` is the owner assignments hang off.
 */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [auth, profile] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/profile", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!live) return;
      if (auth?.signedIn) {
        setMe({
          id: auth.id, name: auth.name, role: auth.role,
          chapter: auth.chapter ?? "", chapterName: auth.chapterName || undefined,
          signedIn: true,
        });
      } else if (profile?.owner) {
        setMe({
          id: profile.owner, name: profile.displayName, role: profile.role,
          chapter: profile.chapter ?? "", chapterName: profile.chapterName || undefined,
          signedIn: false,
        });
      } else {
        // Both lookups failed. Resolve anyway with an empty id so callers fall
        // back to "whoever the server says I am" instead of spinning forever.
        setMe({ id: "", name: "", role: "student", chapter: "", signedIn: false });
      }
    })();
    return () => { live = false; };
  }, []);
  return me;
}

export interface AssignmentsState {
  assignments: Assignment[];
  scope: AssignmentScope | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * `assignee` narrows to one member — the API still refuses to widen, so this is
 * also how a viewer asks for "mine" without trusting the previewed role. Pass
 * `undefined` to skip the request until the caller knows who to ask about.
 */
export function useAssignments(assignee?: string, enabled = true): AssignmentsState {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [scope, setScope] = useState<AssignmentScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const q = assignee ? `?assignee=${encodeURIComponent(assignee)}` : "";
    const res = await fetch(`/api/assignments${q}`, { cache: "no-store" }).catch(() => null);
    if (!res) { setError(OFFLINE); setLoading(false); return; }
    if (!res.ok) { setError((await readError(res)).message); setAssignments([]); setLoading(false); return; }
    const body = await res.json();
    setAssignments(body.assignments ?? []);
    setScope(body.scope ?? null);
    setError(null);
    setLoading(false);
  }, [assignee, enabled]);

  // reload() only setState()s after its fetch awaits, so the cascading-render
  // concern the rule guards against doesn't apply (same as the doc list).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  return { assignments, scope, loading, error, reload };
}

export interface RosterState {
  roster: RosterMember[];
  scope: string | null;
  loading: boolean;
  error: string | null;
  /** Raw API error code, so a caller can explain ITS refusal in its own terms. */
  errorCode: string | null;
  reload: () => Promise<void>;
}

/**
 * The members this viewer may assign to. Students get a 403 here, by design.
 *
 * `role` FILTERS the roster down to members holding that role - it does not
 * describe the caller, whose scope the server decides from the session. Passing
 * your own role is a plausible-looking mistake that returns your peers and
 * nobody you teach; callers who want everyone pass nothing.
 */
export function useRoster(role?: string): RosterState {
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/roster${role ? `?role=${encodeURIComponent(role)}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res) { setError(OFFLINE); setErrorCode("offline"); setLoading(false); return; }
    if (!res.ok) {
      const { message, code } = await readError(res);
      setError(message);
      setErrorCode(code);
      setRoster([]);
      setLoading(false);
      return;
    }
    const body = await res.json();
    setRoster(body.roster ?? []);
    setScope(body.scope ?? null);
    setError(null);
    setErrorCode(null);
    setLoading(false);
  }, [role]);

  // Same as above: every setState here happens after an await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  return { roster, scope, loading, error, errorCode, reload };
}

export type MutationResult = { ok: boolean; message: string };

/**
 * Mark an assignment done, or put it back to todo. The API allows only the
 * assignee — see setStatus. Reopening exists because completion was a one-way
 * door: a mis-tap could not be undone, and the trainer's progress count was
 * then wrong for good.
 */
export async function setAssignmentStatus(
  id: string,
  title: string,
  status: AssignmentStatus,
): Promise<MutationResult> {
  const res = await fetch(`/api/assignments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => null);
  if (!res) return { ok: false, message: OFFLINE };
  if (!res.ok) return { ok: false, message: (await readError(res)).message };
  return {
    ok: true,
    message: status === "done" ? `Marked "${title}" done` : `Reopened "${title}"`,
  };
}

/** Complete an assignment. Thin alias kept for existing callers. */
export async function completeAssignment(id: string, title: string): Promise<MutationResult> {
  return setAssignmentStatus(id, title, "done");
}

/** Take an assignment back. The API allows only the assigner, or an admin. */
export async function unassignAssignment(id: string, title: string): Promise<MutationResult> {
  const res = await fetch(`/api/assignments/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  if (!res) return { ok: false, message: OFFLINE };
  if (!res.ok) return { ok: false, message: (await readError(res)).message };
  return { ok: true, message: `Unassigned "${title}"` };
}

export async function assignContent(input: {
  kind: AssignmentKind;
  refId: string;
  assigneeId: string;
  assigneeName: string;
  title: string;
  dueAt?: number | null;
  /**
   * Section ids narrowing a module assignment to part of the module. Omit for
   * the whole thing - the server reads absent as "all of it". Ids only: the
   * titles the student sees are read off the module server-side.
   */
  parts?: string[];
}): Promise<MutationResult> {
  const res = await fetch("/api/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: input.kind,
      refId: input.refId,
      assigneeId: input.assigneeId,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.parts?.length ? { parts: input.parts } : {}),
    }),
  }).catch(() => null);
  if (!res) return { ok: false, message: OFFLINE };
  if (!res.ok) return { ok: false, message: (await readError(res)).message };
  const body = await res.json().catch(() => null);
  return {
    ok: true,
    message: body?.duplicate
      ? `${input.assigneeName} already has "${input.title}" open`
      : `Assigned "${input.title}"${input.parts?.length ? ` (${input.parts.length} part${input.parts.length === 1 ? "" : "s"})` : ""} to ${input.assigneeName}`,
  };
}

/**
 * Roles the server lets hand work out, and — since the same three roles are the
 * ones with oversight of a chapter — the roles that get the staff affordances:
 * Assign on the roster, Assigned work, Attempts on a chapter member's exam.
 *
 * A CLIENT mirror of canAssign in lib/users, which is the authority; that module
 * carries the signed-user store, so a component importing it for one predicate
 * would drag the directory into the bundle. This is presentation only. Every
 * route re-decides for itself against the SIGNED session, so a viewer who flips
 * the preview switcher gets buttons that then refuse them — never access.
 */
export function canAssign(role?: string): boolean {
  return role === "trainer" || role === "advisor" || role === "admin";
}

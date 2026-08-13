"use client";

/**
 * Turning HOSA identity ids into the names they stand for.
 *
 * Every surface that shows a person was printing the raw `sub` — a cuid. The
 * worst of them was the comment byline, where a whole thread was signed
 * "cmx8k2..." and nobody could tell who was speaking. lib/users has stored the
 * name all along; nothing was fetching it.
 *
 * The directory is /api/roster, which is one request for the whole surface.
 * That matters more than it looks: the alternative shape — resolve each id as
 * you meet it — is a request per comment, per card, per row, against an
 * endpoint that already returns everyone in a single call.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: invent a placeholder. An id the roster
 * doesn't cover falls back to the id itself. A non-admin's roster is scoped to
 * their own chapter, so a member of another chapter is legitimately unknown
 * here — and "Unknown member" would render that ordinary case identically to a
 * roster that failed to load and to an account that no longer exists. An
 * unfamiliar id at least says "this is an identity we couldn't look up".
 */

import { useMemo } from "react";

import {
  chapterLabel,
  makeNameResolver,
  type ChapterNamed,
  type DirectoryMember,
  type NameResolver,
} from "@/lib/visibility";

import { useMe, useRoster, type RosterMember } from "./use-assignments";

export interface Names {
  /** An identity id to the member's name; the id itself when unresolvable. */
  name: NameResolver;
  /** A chapter id to the chapter's name; the id itself when unresolvable. */
  chapter: (chapterId: string) => string;
  /** Roster plus your own session, for callers that resolve in bulk. */
  directory: DirectoryMember[];
  /** The raw roster, for callers that need more than a name. */
  roster: RosterMember[];
  loading: boolean;
  error: string | null;
  /**
   * Whether the directory is complete enough to conclude an id is NOT in it.
   * While it is loading or failed every id looks unresolvable, and a caller
   * that marks ids as unknown on that basis would libel every healthy one.
   */
  ready: boolean;
}

export function useNames(): Names {
  const me = useMe();
  const { roster, loading, error } = useRoster();

  // Your own session goes last so it outranks a stale roster row about you —
  // and so your own name still resolves when the roster is empty or failed,
  // which is the common case for a chapter-less account.
  const directory = useMemo<DirectoryMember[]>(
    () => (me?.id ? [...roster, { id: me.id, name: me.name }] : roster),
    [roster, me],
  );

  const name = useMemo(() => makeNameResolver(directory), [directory]);

  const chapters = useMemo<ChapterNamed[]>(
    () => (me ? [...roster, me] : roster),
    [roster, me],
  );
  const chapter = useMemo(
    () => (chapterId: string) => chapterLabel(chapterId, chapters),
    [chapters],
  );

  return { name, chapter, directory, roster, loading, error, ready: !loading && !error };
}

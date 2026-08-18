"use client";

/**
 * The chapter card on the home page.
 *
 * This was the last fixture in the app, and the worst placed: every member in
 * every chapter was shown "Toronto Central", advisor "Coach Rivera", and a
 * deadline to "confirm your competitive events by Oct 20". Being the landing
 * page made it the most-read screen in Vitals, and being actionable made it
 * worse than merely wrong.
 *
 * What's shown here now comes from the signed session and the roster. The
 * fields with no source in Vitals — region, next event, announcement — are
 * gone rather than invented; HOSA owns conferences and comms, and until there
 * is a feed for them there is nothing truthful to put in their place.
 */

import { useMemo } from "react";

import { useMe, useRoster } from "./use-assignments";

/** Teaching roles, most senior first — who a student should be pointed at. */
const LEAD_ROLES = ["advisor", "trainer"] as const;

export function ChapterSummary() {
  const me = useMe();
  // Students get a reduced people-only roster for their own chapter, which is
  // exactly what this needs — no completion counts, no activity timestamps.
  //
  // `error` is not optional to read. A failed fetch also leaves roster empty
  // and loading false, so dropping it made an outage render as "0 members" and
  // "your advisor hasn't opened Vitals yet" — a fetch failure stated as a fact
  // about the student's chapter, on the page they land on.
  const { roster, scope, loading, error } = useRoster();

  // The roster's scope belongs to the VIEWER; this card is about ONE chapter.
  // For a student or trainer those already coincide, but an admin's roster is
  // every member Vitals knows (scope "all") — so the raw array under a heading
  // reading "Your chapter" announced 17 people drawn from four different
  // chapters as though they were all in this one, and listed another chapter's
  // trainer as this chapter's lead. Narrow to the chapter being named.
  const here = useMemo(
    () => (me?.chapter ? roster.filter((m) => m.chapter === me.chapter) : roster),
    [roster, me],
  );

  const leads = useMemo(
    () =>
      LEAD_ROLES.flatMap((role) =>
        here.filter((m) => m.role === role).map((m) => ({ ...m, role })),
      ),
    [here],
  );

  const chapterLabel = me?.chapterName || me?.chapter || "";

  // No chapter on the identity: say so plainly. HOSA owns chapter assignment,
  // so an empty card here means the member platform has them unassigned.
  //
  // Gated on `me` rather than on the roster's loading flag, because they are
  // two independent requests: keying off the roster announced "No chapter yet"
  // to anyone whose roster simply answered first, turning a load order into a
  // statement about their account.
  if (me && !chapterLabel) {
    return (
      <div className="chapter-card">
        <div className="chapter-head">
          <div>
            <p className="chapter-name">No chapter yet</p>
            <p className="chapter-region">Set your chapter in the HOSA member platform</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chapter-card">
      <div className="chapter-head">
        <div>
          <p className="chapter-name">{chapterLabel || "Loading..."}</p>
          <p className="chapter-region">Your chapter</p>
        </div>
        {/* A count is a claim about the chapter. Don't make one from a roster
            we failed to load — an empty array here means "we don't know", not
            "nobody". */}
        {!loading && !error && (
          <span className="chapter-members">
            {here.length} {here.length === 1 ? "member" : "members"} here
          </span>
        )}
      </div>

      {/* An admin reads every chapter, so say which one this card is counting —
          otherwise the narrowed number looks like the platform is smaller than
          it is, which is the opposite error but just as misleading. */}
      {!loading && !error && scope === "all" && (
        <p className="chapter-note">
          Your own chapter. Users &amp; roles lists every member in Vitals.
        </p>
      )}

      {!loading && error && (
        <p className="chapter-note">
          Couldn&apos;t load your chapter&apos;s members just now. Reload to try again.
        </p>
      )}

      {!error && leads.length > 0 && (
        <div className="chapter-facts">
          {leads.slice(0, 3).map((m) => (
            <div key={m.id}>
              <span className="chapter-label">{m.role === "advisor" ? "Advisor" : "Trainer"}</span>
              <span>{m.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* The roster is discovered one arrival at a time (lib/users), so a thin
          chapter means "few have opened Vitals", not "few are in the chapter".
          Saying which keeps an advisor from reading it as a roster problem.
          Suppressed on error for the same reason as the count above: a failed
          fetch also leaves `leads` empty, so without this the card printed
          "your advisor hasn't opened Vitals yet" directly underneath the line
          admitting we couldn't load the roster at all. */}
      {!loading && !error && (
        <p className="chapter-note">
          {leads.length === 0
            ? "Your advisor hasn't opened Vitals yet. Members appear here once they've opened it from the HOSA member platform."
            : "Only members who have opened Vitals from the HOSA member platform appear here."}
        </p>
      )}
    </div>
  );
}

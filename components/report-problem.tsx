"use client";

// Reporting a problem from inside the thing that has the problem.
//
// The dashboard's feedback box asks members to describe where they were; this
// asks nothing, because it already knows - it ships whatever the member is
// looking at, down to the question or the card. The point is that "question 4's
// answer is wrong" reaches an admin still attached to question 4.
//
// Every instance says, in the dialog, that this goes privately to staff and is
// not posted in the comments. That line is not decoration: comments are a
// public thread other students read, this is a private message to the people
// who can fix the thing, and a member who picks wrong gets read by the wrong
// audience. Where a page has both, the two sit together for the same reason.
//
// WHERE TO PUT IT. The control was only ever at the very bottom of a page, as a
// sentence inside a paragraph, which is why members reported it as missing. Two
// placements, and hosts should use both where both apply:
//
//   1. Immediately before the back link in the page's quiet closing row
//      (`.study-foot`), so it lands in the same place on every content page and
//      is learnable. Never in `.study-controls` - that row is Next / Submit /
//      the grade buttons, and this must not compete with them.
//   2. Beside the specific part when one is marked - a graded quiz question -
//      because that is the moment a member decides something is wrong.
//
// It renders as exactly one layout box (the dialog is fixed-position and out of
// flow), so dropping it into a flex row doesn't push the row's other items
// around.

import * as React from "react";

import {
  reportMessage,
  reportMessageMax,
  reportSubject,
  reportTriggerAriaLabel,
  reportTriggerLabel,
  type ReportContext,
} from "@/lib/report-ux";

import { useModal } from "./use-modal";

/** The two kinds worth offering in-context; "other" stays on the general form. */
type ReportKind = "bug" | "idea";

/**
 * What to tell the member when a submit fails, by HTTP status (null = the
 * request never got a response). Rate limiting gets its own line because a
 * generic failure reads as "your words are gone": the report genuinely wasn't
 * filed, but the draft is still sitting in the textarea, and saying so is what
 * stops a member from retyping it and hitting the same limit again.
 */
export function reportProblemError(status: number | null): string {
  if (status === null) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 429) return "That's a few reports in quick succession. Your message is still here - wait a minute, then send it again.";
  if (status === 400) return "Add a little more detail before sending.";
  if (status === 401 || status === 403) return "You need to be signed in to send a report.";
  if (status === 404) return "Reporting isn't available here right now.";
  return `Couldn't send your report (error ${status}). Try again in a moment.`;
}

/** Where the member is, for an admin retracing their steps. */
function currentPage(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.pathname + window.location.search;
}

/**
 * Pass a `target` for anything FeedbackTarget can name, so the report is
 * filterable; pass `title` (and `part`) for anything it can't, and lib/report-ux
 * puts the subject in the message instead. One or the other is required.
 */
export function ReportProblem(ctx: ReportContext) {
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  // The draft lives out here, above the dialog that edits it. Escape and a
  // stray backdrop click both close this thing, and lib/feedback's rule is that
  // the member's message is the part we can't afford to lose - so a reopened
  // form is exactly as they left it. Only a successful send clears it.
  const [kind, setKind] = React.useState<ReportKind>("bug");
  const [message, setMessage] = React.useState("");

  return (
    <>
      <span>
        <button
          type="button"
          className="link-btn"
          aria-label={reportTriggerAriaLabel(ctx)}
          onClick={() => { setSent(false); setOpen(true); }}
        >
          {reportTriggerLabel(ctx)}
        </button>
        {" "}
        {/* The live region stays mounted and fills in later: a region inserted
            into the DOM already carrying its text often goes unannounced. */}
        <span role="status">
          {sent && !open && <span className="feedback-thanks">Thanks - sent privately to staff.</span>}
        </span>
      </span>
      {open && (
        <ReportDialog
          ctx={ctx}
          kind={kind}
          message={message}
          onKind={setKind}
          onMessage={setMessage}
          onClose={() => setOpen(false)}
          onSent={() => { setMessage(""); setKind("bug"); setOpen(false); setSent(true); }}
        />
      )}
    </>
  );
}

function ReportDialog({ ctx, kind, message, onKind, onMessage, onClose, onSent }: {
  ctx: ReportContext;
  kind: ReportKind;
  message: string;
  onKind: (k: ReportKind) => void;
  onMessage: (m: string) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = useModal(onClose);
  // Two instances on one page (a quiz and each of its questions) would
  // otherwise share a radio name and fight over the selection.
  const group = React.useId();
  const subject = reportSubject(ctx);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    // Emptiness is judged on what the MEMBER wrote, not on what gets sent: a
    // subject preamble would make every blank report look like a full one.
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        message: reportMessage(ctx, text),
        page: currentPage(),
        ...(ctx.target ? { target: ctx.target } : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(reportProblemError(res?.status ?? null));
      return;
    }
    onSent();
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div
        className="dash-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Report a problem with ${subject}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Report a problem</h2>
        <p className="dash-sub">
          About {subject}. This goes privately to staff - it is not posted in the comments.
        </p>

        <form onSubmit={send}>
          <div className="dash-checks" role="radiogroup" aria-label="What kind of report is this?">
            <label>
              <input
                type="radio"
                name={group}
                checked={kind === "bug"}
                onChange={() => { onKind("bug"); setError(null); }}
              />
              <span>Problem - something here is wrong or broken</span>
            </label>
            <label>
              <input
                type="radio"
                name={group}
                checked={kind === "idea"}
                onChange={() => { onKind("idea"); setError(null); }}
              />
              <span>Suggestion - an idea for making this better</span>
            </label>
          </div>

          <label className="dash-field">
            <span>{kind === "bug" ? "What's wrong?" : "What would you change?"}</span>
            <textarea
              value={message}
              onChange={(e) => { onMessage(e.target.value); setError(null); }}
              placeholder={
                kind === "bug"
                  ? "Which part, and what's wrong with it - a wrong answer, a broken link, a page that won't load."
                  : "What would make this clearer or more useful?"
              }
              rows={5}
              maxLength={reportMessageMax(ctx)}
            />
          </label>

          {error && <p className="upload-error" role="alert">{error}</p>}
          <div className="dash-modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="cta" disabled={busy || !message.trim()}>
              {busy ? "Sending..." : "Send report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

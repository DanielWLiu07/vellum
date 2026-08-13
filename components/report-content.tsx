"use client";

/**
 * "Report" — a member telling a human that a resource shouldn't be here.
 *
 * Sibling to, and deliberately not merged with, the feedback form. Feedback is
 * a message to staff about something being wrong (a bad answer key, a broken
 * link) and is answered with a correction. This is an accusation about the
 * content itself and is answered with a moderation decision, so it posts to
 * /api/report and lands in the review queue next to the automatic flags. The
 * dialog says which is which, because a member who picks the wrong one gets
 * their issue read by the wrong person.
 *
 * The trigger is a quiet link rather than a button with weight: reporting is a
 * rare, deliberate act, and a prominent Report control next to every resource
 * invites misfires on material people simply dislike.
 */

import * as React from "react";

import { useModal } from "./use-modal";

export type ReportKind = "doc" | "deck" | "quiz" | "module";

const REASON_MAX = 1000;

type Sent = { duplicate: boolean };

export function ReportContent({ kind, id, title }: { kind: ReportKind; id: string; title: string }) {
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState<Sent | null>(null);

  // Once a report is filed, the trigger is replaced rather than left clickable.
  // The server would fold a second report into the first anyway, but a button
  // that still says "Report" reads as though the first press did nothing.
  if (sent) {
    return (
      <p className="dash-sub" role="status">
        {sent.duplicate
          ? "You've already reported this. It's with the reviewers."
          : "Reported. A reviewer will take a look."}
      </p>
    );
  }

  return (
    <>
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        Report
      </button>
      {open && (
        <ReportDialog
          kind={kind}
          id={id}
          title={title}
          onClose={() => setOpen(false)}
          onSent={(result) => {
            setOpen(false);
            setSent(result);
          }}
        />
      )}
    </>
  );
}

function ReportDialog({
  kind,
  id,
  title,
  onClose,
  onSent,
}: {
  kind: ReportKind;
  id: string;
  title: string;
  onClose: () => void;
  onSent: (result: Sent) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = useModal(onClose);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError("Couldn't reach the server. Try again in a moment.");
      return;
    }
    if (!res.ok) {
      // Each of these is a different thing to do next, so they get different
      // sentences. A single "something went wrong" would leave a member
      // retrying the one case (rate limit) where retrying is the wrong move.
      setError(
        res.status === 429
          ? "You've sent several reports just now. Wait a minute and try again."
          : res.status === 401
            ? "Sign in again to report this."
            : res.status === 404
              ? "This isn't available any more — it may already have been removed."
              : "Couldn't send that report. Try again.",
      );
      return;
    }
    const body = await res.json().catch(() => ({}));
    onSent({ duplicate: Boolean(body?.duplicate) });
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div
        className="dash-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Report ${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Report &ldquo;{title}&rdquo;</h2>
        <p className="dash-sub">
          This goes to HOSA reviewers, not to whoever posted it. Use it for content that shouldn&rsquo;t
          be on the platform. If the material belongs here but something in it is wrong, send feedback
          instead — that reaches the people who can fix it.
        </p>

        <label className="dash-field">
          <span>What&rsquo;s wrong with it?</span>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="Tell the reviewer what they should be looking at."
            rows={4}
            maxLength={REASON_MAX}
          />
        </label>
        {/* Not a warning, a correction of the obvious assumption. Members expect
            Report to remove things, and quietly not removing it looks like the
            report was ignored when the reviewer takes a day. */}
        <p className="dash-sub">
          Nothing is taken down automatically — a reviewer decides, and reported items go to the front
          of their queue.
        </p>

        {error && <p className="upload-error" role="alert">{error}</p>}
        <div className="dash-modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cta" disabled={busy || !reason.trim()} onClick={send}>
            {busy ? "Sending..." : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}

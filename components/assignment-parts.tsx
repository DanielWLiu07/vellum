"use client";

/**
 * How a NARROWED assignment says so.
 *
 * An assignment can now cover only some sections of a module. Until this,
 * every surface rendered "EMT Fundamentals / Module · from Demo Trainer" for
 * both the whole-module assignment and the sections-1-and-3 one, so a student
 * holding both saw two identical cards and could not tell what they had
 * actually been asked to read.
 *
 * THE ABSENT CASE IS THE COMMON ONE AND MUST STAY SILENT. `parts` is absent on
 * every assignment made before the feature existed, and absent means the whole
 * resource — not "no parts". Rendering anything at all for it would relabel
 * the entire existing corpus as narrowed. So `partsOf` collapses absent AND
 * empty to null, and every caller renders nothing for null.
 *
 * Only modules ever carry parts, and a selection is never all of a module's
 * sections (all-sections is stored as whole-module deliberately), so "2 parts"
 * always means a genuine narrowing.
 *
 * Shared because three surfaces show the same fact — the student's own card,
 * the trainer's oversight list, and the To-do list — and they drifted apart
 * once already.
 */

import * as React from "react";

export interface AssignmentPart {
  id: string;
  title: string;
}

/**
 * The client Assignment type (components/use-assignments.ts, pane 1's file)
 * does not declare `parts` yet, though the API sends it and lib/assignments
 * types it. Narrowing here rather than editing that file keeps this additive;
 * when the field is declared upstream this type alias can simply go.
 */
type MaybeNarrowed = { parts?: AssignmentPart[] | null };

/** The assigned sections, or null when this covers the whole resource. */
export function partsOf(assignment: unknown): AssignmentPart[] | null {
  const raw = (assignment as MaybeNarrowed | null | undefined)?.parts;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.filter((p): p is AssignmentPart => Boolean(p && typeof p.title === "string"));
}

/** "2 parts" — the compact form for a meta line. Null for a whole resource. */
export function partsLabel(assignment: unknown): string | null {
  const parts = partsOf(assignment);
  if (!parts || parts.length === 0) return null;
  return `${parts.length} part${parts.length === 1 ? "" : "s"}`;
}

/**
 * The section titles themselves, on their own line.
 *
 * The count alone ("2 parts") distinguishes a narrowed assignment from a whole
 * one but still doesn't say WHICH two, which is the thing the student needs in
 * order to do the work. Naming them costs a line and answers it outright — and
 * it needs no extra request, since the titles ride on the assignment.
 */
export function AssignmentParts({ assignment }: { assignment: unknown }) {
  const parts = partsOf(assignment);
  if (!parts || parts.length === 0) return null;
  return (
    <p className="assignment-parts">
      <span className="assignment-parts-label">Just these parts:</span>{" "}
      {parts.map((p) => p.title).join(" · ")}
    </p>
  );
}

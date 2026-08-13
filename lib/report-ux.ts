/**
 * How an in-context report names the thing it is about.
 *
 * The control is deliberately identical wherever it appears - one trigger, one
 * dialog, one destination - but its subject is not: a module, a document, one
 * question of a quiz, one card of a deck. Every string that varies with the
 * subject is derived here so the hosts don't each invent their own wording, and
 * so the wording is testable without rendering a component.
 *
 * This module also decides where the subject TRAVELS. lib/feedback's
 * FeedbackTarget can name a module, a doc, or a numbered quiz question, and an
 * admin can filter reports by it. Anything it can't name has to ride in the
 * message text instead, because a report that reaches staff saying only "this
 * one is wrong" costs more to chase than it is worth.
 */

import type { FeedbackTarget } from "./feedback";

/** Mirrors MSG_MAX in lib/feedback, so the server never silently truncates. */
export const MESSAGE_MAX = 2000;

/**
 * A card front can be a paragraph, and a title can be pasted; a label that long
 * stops being a label. Everything in a subject line is cut to this, which also
 * bounds what the line can cost the member's own message - see reportMessageMax.
 */
const LABEL_MAX = 80;

/** A piece of the content smaller than the target can name - a deck card. */
export interface ReportPart {
  /** Singular noun for the trigger: "Report this card". */
  noun: string;
  /** What identifies it to an admin, without repeating the noun: `4: "Systole"`. */
  label: string;
}

/**
 * What is being reported. Exactly one of `target` / `title` is required: a
 * report control with nothing to name would file an anonymous complaint, so
 * the type refuses to render one.
 */
export type ReportContext = (
  | { target: FeedbackTarget; title?: undefined }
  | { target?: undefined; title: string }
) & { part?: ReportPart };

/** Collapse and cut a piece of member-authored text down to label length. */
function clampLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}

/**
 * A deck card's identity, by position and by what it says.
 *
 * Position alone ("card 4") survives a card being edited but not one being
 * inserted above it; the front text alone survives a reorder but not an edit.
 * Sending both means an admin can still find the card when one of them has
 * moved on. An image-only card has no front text and falls back to position.
 */
export function deckCardPart(number: number, front: string): ReportPart {
  const text = clampLabel(front);
  return { noun: "card", label: text ? `${number}: “${text}”` : String(number) };
}

/** The phrase both the member and the admin see: what this report is about. */
export function reportSubject(ctx: ReportContext): string {
  const base = `“${clampLabel(ctx.target ? ctx.target.title : ctx.title)}”`;
  if (ctx.part) return `${base}, ${ctx.part.noun} ${ctx.part.label}`;
  if (ctx.target?.question) return `${base}, question ${ctx.target.question}`;
  return base;
}

/**
 * The trigger's visible text.
 *
 * It names its own scope rather than saying "Report a problem" twenty times
 * down a results page: next to one question, the thing being reported is that
 * question, and a control that doesn't say so makes the member guess whether
 * they are about to complain about the whole quiz.
 */
export function reportTriggerLabel(ctx: ReportContext): string {
  if (ctx.part) return `Report this ${ctx.part.noun}`;
  if (ctx.target?.question) return "Report this question";
  return "Report a problem";
}

/**
 * The accessible name, which must OPEN with the visible label - WCAG's
 * label-in-name rule, and the reason speech control ("click report this card")
 * works at all. The subject follows so that twenty otherwise identical links
 * are told apart in a screen reader's list of controls.
 */
export function reportTriggerAriaLabel(ctx: ReportContext): string {
  return `${reportTriggerLabel(ctx)} - ${reportSubject(ctx)}`;
}

/** Whether the stored target already says everything the subject line says. */
function targetCarriesSubject(ctx: ReportContext): boolean {
  return Boolean(ctx.target) && !ctx.part;
}

/**
 * The message actually sent.
 *
 * When the target carries the subject the member's words go up untouched - the
 * admin view reads kind, id and question off the target, and repeating them in
 * the body would be noise in every single report. When it can't (a deck, which
 * FeedbackTarget has no kind for; a card, which it has no field for) the
 * subject is prepended, because the alternative is an untargeted report that
 * says "the answer is wrong" about nothing in particular.
 */
export function reportMessage(ctx: ReportContext, text: string): string {
  return targetCarriesSubject(ctx) ? text : `About ${reportSubject(ctx)}\n\n${text}`;
}

/**
 * How much the member may type. The preamble counts against lib/feedback's cap,
 * so the textarea gives back exactly what the subject line spends - otherwise a
 * member who fills the box has the end of their sentence cut off by a prefix
 * they didn't write. Every piece of the line is clamped, so this can't collapse
 * to nothing however long the title is.
 */
export function reportMessageMax(ctx: ReportContext): number {
  return MESSAGE_MAX - reportMessage(ctx, "").length;
}

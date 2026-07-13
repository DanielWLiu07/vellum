/**
 * Best-effort copyright detector for uploads. This is NOT content
 * fingerprinting (no Content-ID database) - it scans text for strong markers of
 * THIRD-PARTY published material (ISBNs, commercial publisher names, textbook
 * ancillaries like "test bank" / "instructor's manual") so we don't host an
 * obvious textbook scan and eat a takedown notice.
 *
 * It deliberately does NOT flag generic "(c) 2024" / "all rights reserved"
 * notices, because HOSA's own official materials carry those too - flagging
 * them would block exactly the resources we want. So it errs toward flagging
 * only on signals that rarely appear on a chapter's own handouts.
 */

export interface CopyrightResult {
  flagged: boolean;
  /** Human-readable markers that tripped the detector (for the audit + UI). */
  signals: string[];
}

// Commercial publishers common in medical / test-prep material.
const PUBLISHERS = [
  "pearson", "mcgraw-hill", "mcgraw hill", "elsevier", "wiley", "cengage",
  "houghton mifflin", "saunders", "mosby", "lippincott", "wolters kluwer",
  "kaplan", "barron's", "princeton review", "oxford university press",
  "cambridge university press", "f.a. davis", "jones & bartlett", "quizlet plus",
];

// Phrases that signal commercially published / restricted material.
const PHRASES = [
  "instructor's manual", "instructors manual", "test bank", "solutions manual",
  "for classroom use only", "not for resale", "may not be reproduced",
  "no part of this publication", "no part of this book", "reproduction is prohibited",
  "unauthorized reproduction", "printed in the united states of america",
];

// A labeled ISBN-10/13 ("ISBN: 978-0-13-..."), separators optional.
const LABELED_ISBN = /isbn(?:-1[03])?\s*:?\s*(?:97[89][\s-]?)?\d(?:[\s-]?\d){8,11}[\dx]/i;
// A BARE ISBN-13 / EAN barcode: exactly 13 digits starting 978/979 (separators
// allowed), not embedded in a longer digit run. Catches textbook barcode blocks
// printed without the word "ISBN". Starting 978/979 keeps false positives (phone
// / card numbers) essentially nil.
const BARE_ISBN13 = /(?<!\d)97[89](?:[\s-]?\d){10}(?!\d)/;

export function scanCopyright(text: string): CopyrightResult {
  const hay = text.toLowerCase();
  const signals: string[] = [];
  if (LABELED_ISBN.test(text) || BARE_ISBN13.test(text)) signals.push("ISBN");
  for (const p of PHRASES) if (hay.includes(p)) signals.push(`"${p}"`);
  for (const pub of PUBLISHERS) if (hay.includes(pub)) signals.push(pub);
  const unique = [...new Set(signals)];
  return { flagged: unique.length > 0, signals: unique };
}

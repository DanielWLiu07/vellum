/**
 * Demo seed data for the standalone dashboard. OPT-IN: only runs when
 * VELLUM_SEED_DEMO=1 and no durable object store is configured, so it never
 * touches tests or a real deployment. Populates the in-memory backend with a
 * realistic HOSA resource library so "All resources" has something to show,
 * exercising every card variant: HOSA-official / your upload / shared by a
 * member, each visibility badge, and per-person "shared with N".
 *
 * All records point at the bundled sample.pdf for their bytes, so Open and
 * Make-a-copy work on seeded resources like any other upload.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { ensureReady } from "./bootstrap";
import { setFavorite } from "./favorites";
import { createFolder, getFolder } from "./folders";
import { getResourceMeta, setResourceMeta } from "./resource-meta";
import { getShare, setShare } from "./resource-share";
import { objectStoreConfigured } from "./storage";
import { __seedUpload } from "./storage/memory";
import type { PersonShare, Visibility } from "./visibility";

interface SeedSpec {
  id: string;
  name: string;
  owner: string;
  visibility: Visibility;
  chapter: string;
  sizeBytes: number;
  ageDays: number;
  event?: string;
  people?: PersonShare[];
  /** Official HOSA-created resource: badged + locked. */
  official?: boolean;
}

const HOSA = "HOSA Canada";

const CHAPTER = "Toronto Central";

// A believable spread across HOSA competitive-event study material.
const SPECS: SeedSpec[] = [
  { id: "u_seed_ecg", name: "ECG interpretation - the basics", owner: "you", visibility: "public", chapter: CHAPTER, sizeBytes: 1_240_000, ageDays: 1, event: "Medical Reading" },
  { id: "u_seed_terms", name: "Medical terminology - roots, prefixes & suffixes", owner: "Priya Sharma", visibility: "public", chapter: CHAPTER, sizeBytes: 860_000, ageDays: 3, event: "Medical Terminology" },
  { id: "u_seed_cardio", name: "Anatomy & physiology - the cardiovascular system", owner: "Marcus Chen", visibility: "chapter", chapter: CHAPTER, sizeBytes: 2_310_000, ageDays: 4, event: "Human Growth & Development" },
  { id: "u_seed_ppe", name: "Lab safety and PPE checklist", owner: "you", visibility: "chapter", chapter: CHAPTER, sizeBytes: 420_000, ageDays: 6, event: "Clinical Nursing", people: [{ person: "Priya Sharma", role: "viewer" }] },
  { id: "u_seed_pharm", name: "Pharmacology quick reference - top 50 drugs", owner: "Dev Patel", visibility: "public", chapter: CHAPTER, sizeBytes: 1_780_000, ageDays: 8, event: "Pharmacology" },
  { id: "u_seed_vitals", name: "Vital signs reference card", owner: "you", visibility: "private", chapter: CHAPTER, sizeBytes: 190_000, ageDays: 9, event: "Clinical Nursing" },
  { id: "u_seed_emr", name: "Emergency medical responder - scenario pack", owner: "Sofia Rossi", visibility: "chapter", chapter: CHAPTER, sizeBytes: 3_050_000, ageDays: 12, event: "Emergency Medical Technician", people: [{ person: "you", role: "viewer" }, { person: "Marcus Chen", role: "editor" }] },
  { id: "u_seed_nutri", name: "Nutrition and metabolism study guide", owner: "Priya Sharma", visibility: "public", chapter: CHAPTER, sizeBytes: 1_010_000, ageDays: 15, event: "Nutrition" },
  { id: "u_seed_mhfa", name: "Mental health first aid - overview", owner: "you", visibility: "public", chapter: CHAPTER, sizeBytes: 640_000, ageDays: 19, event: "Behavioral Health" },
  { id: "u_seed_sports", name: "Sports medicine - common injuries & taping", owner: "Marcus Chen", visibility: "public", chapter: CHAPTER, sizeBytes: 2_640_000, ageDays: 26, event: "Sports Medicine" },

  // Official HOSA Canada resources: created by HOSA, badged, and locked.
  { id: "u_seed_off_handbook", name: "HOSA Canada - Competitive Events Handbook 2027", owner: HOSA, visibility: "public", chapter: "", sizeBytes: 4_120_000, ageDays: 40, official: true },
  { id: "u_seed_off_emt", name: "HOSA Canada - Official EMT skills guide", owner: HOSA, visibility: "public", chapter: "", sizeBytes: 2_880_000, ageDays: 34, event: "Emergency Medical Technician", official: true },
  { id: "u_seed_off_ethics", name: "HOSA Canada - Medical ethics & professionalism", owner: HOSA, visibility: "public", chapter: "", sizeBytes: 1_460_000, ageDays: 30, event: "Medical Law & Ethics", official: true },
  { id: "u_seed_off_terms", name: "HOSA Canada - Approved medical terminology list", owner: HOSA, visibility: "public", chapter: "", sizeBytes: 990_000, ageDays: 22, event: "Medical Terminology", official: true },
];

// Global like-counts to seed per resource (from other members). Populates the
// social like-count so it reads as a real, active library instead of all zeros.
// Also covers the bundled sample doc/deck/quiz ids.
const LIKES: Record<string, number> = {
  u_seed_ecg: 24,
  u_seed_terms: 11,
  u_seed_cardio: 18,
  u_seed_ppe: 6,
  u_seed_pharm: 31,
  u_seed_vitals: 3,
  u_seed_emr: 15,
  u_seed_nutri: 9,
  u_seed_mhfa: 7,
  u_seed_sports: 20,
  sample: 42,
  "sample-deck": 13,
  "sample-quiz": 8,
};

const g = globalThis as unknown as { __vellumSeeded?: boolean };

/** Seed the in-memory backend once. Safe to call on every request. */
export async function ensureSeeded(): Promise<void> {
  // Hydrate persisted state first, so create-if-missing sees existing folders
  // and persist() writes land after hydration (never clobbering saved state).
  await ensureReady();
  if (process.env.VELLUM_SEED_DEMO !== "1") return;
  if (g.__vellumSeeded) return;
  if (objectStoreConfigured()) return; // never seed a durable store
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "sample.pdf")));
  } catch {
    return; // no sample to back the seeds; skip silently
  }
  g.__vellumSeeded = true;
  const now = Date.now();

  // Official + personal folders (fixed ids, create-if-missing). Which folder
  // each seed doc belongs to - applied ONCE below, not on every boot.
  if (!getFolder("f_seed_handbooks")) createFolder("Official handbooks", HOSA, true, "f_seed_handbooks");
  if (!getFolder("f_seed_emt")) createFolder("Emergency Medical Technician", HOSA, true, "f_seed_emt");
  if (!getFolder("f_seed_terms")) createFolder("Medical Terminology", HOSA, true, "f_seed_terms");
  if (!getFolder("f_seed_mine")) createFolder("My study set", "you", false, "f_seed_mine");
  const FOLDER_OF: Record<string, string> = {
    u_seed_off_handbook: "f_seed_handbooks", u_seed_off_ethics: "f_seed_handbooks",
    u_seed_off_emt: "f_seed_emt", u_seed_emr: "f_seed_emt",
    u_seed_off_terms: "f_seed_terms", u_seed_terms: "f_seed_terms",
    u_seed_ecg: "f_seed_mine", u_seed_ppe: "f_seed_mine",
  };

  for (const s of SPECS) {
    __seedUpload({
      id: s.id,
      name: s.name,
      owner: s.owner,
      visibility: s.visibility,
      chapter: s.chapter,
      sizeBytes: s.sizeBytes,
      contentType: "application/pdf",
      uploadedAt: now - s.ageDays * 86_400_000,
      bytes,
    });
    // Sidecar state (sharing, event/official/folder) is seeded ONLY if the doc
    // has none yet. A restart re-runs this, and hydration has already loaded the
    // persisted state - re-applying seed values would clobber a user's edits
    // (a moved folder, a changed share). So we seed once, then leave it alone.
    if (!getShare(s.id) && s.people?.length) {
      setShare(s.id, { visibility: s.visibility, chapter: s.chapter, people: s.people });
    }
    if (!getResourceMeta(s.id)) {
      setResourceMeta(s.id, { event: s.event, official: s.official, folderId: FOLDER_OF[s.id] });
    }
  }

  // Seed like-counts: N distinct members each save the resource, so the global
  // like-count is a real number. Your own likes (owner "you") are separate and
  // add on top when you tap a heart. setFavorite is idempotent (Set-based).
  for (const [id, n] of Object.entries(LIKES)) {
    for (let i = 0; i < n; i++) setFavorite(`member_${i}`, id, true);
  }
}

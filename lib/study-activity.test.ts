// The record of what a member has studied.
//
// This store is the only place a self-directed study session is written down,
// so the cases that matter are the ones where a fact would be silently lost or
// silently attributed to the wrong person: the log growing without bound until
// eviction eats it, a key that lets two members share a row, and a signed-out
// visitor writing into a bucket the next visitor reads. The derived halves
// (module progress, the schedule, the transcript) are folds, so their tests are
// about the fold being faithful to the events rather than about storage.

import { beforeEach, describe, expect, it } from "vitest";

import {
  DAY_MS,
  GRADE_EASY,
  GRADE_FORGOT,
  GRADE_GOOD,
  GRADE_HARD,
  MAX_EVENTS_PER_MEMBER,
  MIN_EASE,
  NEW_CARD,
  REMOVED_TITLE,
  __resetStudy,
  cardKey,
  clearCompletion,
  deckSchedule,
  listStudy,
  moduleProgress,
  nextReview,
  recordStudy,
  reviewState,
  transcript,
  type RecordStudyInput,
} from "./study-activity";

const T0 = 1_700_000_000_000;

const study = (patch: Partial<RecordStudyInput> = {}) =>
  recordStudy({ member: "student_1", kind: "module", refId: "m1", action: "viewed", now: T0, ...patch });

beforeEach(() => __resetStudy());

describe("recording one study fact", () => {
  it("stores who, what, which part, and when", () => {
    const e = study({ part: "ss1", action: "completed", title: "EMT Fundamentals", now: T0 })!;
    expect(e).toMatchObject({
      member: "student_1",
      kind: "module",
      refId: "m1",
      part: "ss1",
      action: "completed",
      at: T0,
      title: "EMT Fundamentals",
    });
  });

  it("keeps only the latest view of a part rather than a history of opens", () => {
    // A view is a "where was I" fact. Appending one per open would grow the log
    // without bound for the member who scrolls back and forth through a module,
    // and eviction would then start eating the completions that actually matter.
    study({ part: "ss1", now: T0 });
    study({ part: "ss1", now: T0 + 60_000 });
    const views = listStudy("student_1", { action: "viewed" });
    expect(views).toHaveLength(1);
    expect(views[0].at).toBe(T0 + 60_000);
  });

  it("keeps one completion per part, no matter how often it is re-marked", () => {
    study({ part: "ss1", action: "completed", now: T0 });
    study({ part: "ss1", action: "completed", now: T0 + 60_000 });
    expect(listStudy("student_1", { action: "completed" })).toHaveLength(1);
  });

  it("appends every review, because the sequence of grades IS the schedule", () => {
    // Unlike a view, an earlier grade is not superseded by a later one -
    // replaying them in order is what produces ease and interval.
    study({ kind: "deck", refId: "d1", part: "cA", action: "reviewed", grade: GRADE_GOOD, now: T0 });
    study({ kind: "deck", refId: "d1", part: "cA", action: "reviewed", grade: GRADE_HARD, now: T0 + DAY_MS });
    expect(listStudy("student_1", { action: "reviewed" })).toHaveLength(2);
  });

  it("records nothing for a blank member", () => {
    // A signed-out viewer is `owner: ""` (NOBODY in lib/profile). Writing under
    // "" would put every anonymous visitor in one shared bucket, and the next
    // one to arrive would read the last one's progress as their own.
    expect(study({ member: "" })).toBeNull();
    expect(study({ member: "   " })).toBeNull();
    expect([...listStudy(""), ...listStudy("student_1")]).toEqual([]);
  });

  it("records nothing without a ref, an unknown kind, or an unknown action", () => {
    // Junk that reaches the store would sit in every fold forever; the store is
    // the last place that can refuse it.
    expect(study({ refId: "" })).toBeNull();
    expect(study({ kind: "chapter" })).toBeNull();
    expect(study({ kind: undefined })).toBeNull();
    expect(study({ action: "skimmed" })).toBeNull();
    expect(listStudy("student_1")).toEqual([]);
  });

  it("refuses a review with no usable grade instead of storing an empty one", () => {
    // A grade-less review carries no schedule information, so it would be a row
    // every fold has to remember to skip.
    const review = { kind: "deck" as const, refId: "d1", part: "cA", action: "reviewed" as const };
    expect(study({ ...review })).toBeNull();
    expect(study({ ...review, grade: 9 })).toBeNull();
    expect(study({ ...review, grade: "not-a-grade" })).toBeNull();
    // A numeric string is still a grade - JSON bodies routinely carry one.
    expect(study({ ...review, grade: "2" })!.grade).toBe(GRADE_GOOD);
  });

  it("ignores a grade on anything that isn't a review", () => {
    expect(study({ part: "ss1", action: "completed", grade: GRADE_EASY })!.grade).toBeUndefined();
  });

  it("clamps a snapshotted title and drops a blank one", () => {
    expect(study({ title: "  EMT Fundamentals  " })!.title).toBe("EMT Fundamentals");
    expect(study({ title: "   " })!.title).toBeUndefined();
    expect(study({ title: "t".repeat(400) })!.title).toHaveLength(120);
  });
});

describe("row ownership", () => {
  it("cannot be collided by an id containing the key separator", () => {
    // The upsert key decides which row belongs to whom, so a member id that
    // happens to contain the separator must not be able to address another
    // member's row. These two produce the SAME key unencoded:
    //   "alice|module|m1" studying module "m2"
    //   "alice"           studying module "m1|module|m2"
    const a = recordStudy({ member: "alice|module|m1", kind: "module", refId: "m2", action: "completed", now: T0 })!;
    const b = recordStudy({ member: "alice", kind: "module", refId: "m1|module|m2", action: "completed", now: T0 + 1 })!;

    expect(a.id).not.toBe(b.id);
    expect(listStudy("alice|module|m1")).toHaveLength(1);
    expect(listStudy("alice")).toHaveLength(1);
    expect(listStudy("alice")[0].refId).toBe("m1|module|m2");
  });

  it("keeps two members' progress on the same content apart", () => {
    study({ member: "student_1", part: "ss1", action: "completed" });
    study({ member: "student_2", part: "ss1", action: "completed" });
    expect(listStudy("student_1")).toHaveLength(1);
    expect(listStudy("student_2")).toHaveLength(1);
  });

  it("lists nothing for a blank member rather than everything", () => {
    study({ part: "ss1", action: "completed" });
    expect(listStudy("")).toEqual([]);
  });
});

describe("clearCompletion", () => {
  it("removes the row, so absence is the only way to say 'not done'", () => {
    // A stored "not done" event would be a second representation of the same
    // state, and two representations are two things to keep in agreement.
    study({ part: "ss1", action: "completed" });
    expect(clearCompletion("student_1", "module", "m1", "ss1")).toBe(true);
    expect(listStudy("student_1", { action: "completed" })).toEqual([]);
  });

  it("reports false when there was nothing to clear, and leaves views alone", () => {
    study({ part: "ss1", action: "viewed" });
    expect(clearCompletion("student_1", "module", "m1", "ss1")).toBe(false);
    expect(listStudy("student_1", { action: "viewed" })).toHaveLength(1);
  });
});

describe("moduleProgress", () => {
  const SUBS = ["ss1", "ss2", "ss3", "ss4"];

  it("counts completions against what the module contains now", () => {
    study({ part: "ss1", action: "completed" });
    study({ part: "ss2", action: "completed" });
    const p = moduleProgress("student_1", "m1", SUBS);
    expect(p.completed).toBe(2);
    expect(p.total).toBe(4);
    expect(p.percent).toBe(50);
    expect(p.completedParts).toEqual(["ss1", "ss2"]);
  });

  it("ignores a completion for a subsection that no longer exists", () => {
    // Otherwise deleting a subsection strands the member above 100%, or at
    // "7 of 8" with nothing left to open.
    study({ part: "ss1", action: "completed" });
    study({ part: "deleted_ss", action: "completed" });
    const p = moduleProgress("student_1", "m1", SUBS);
    expect(p.completed).toBe(1);
    expect(p.percent).toBe(25);
  });

  it("resumes at the last subsection opened while it is still unfinished", () => {
    study({ part: "ss3", action: "viewed", now: T0 + 1000 });
    expect(moduleProgress("student_1", "m1", SUBS).resumePart).toBe("ss3");
  });

  it("resumes at the first unfinished part once the last one opened is done", () => {
    // Sending someone back to a subsection they already ticked off is how a
    // "continue" button starts feeling broken.
    study({ part: "ss1", action: "completed", now: T0 });
    study({ part: "ss1", action: "viewed", now: T0 + 1000 });
    expect(moduleProgress("student_1", "m1", SUBS).resumePart).toBe("ss2");
  });

  it("points a member who has finished everything at nothing", () => {
    for (const id of SUBS) study({ part: id, action: "completed" });
    const p = moduleProgress("student_1", "m1", SUBS);
    expect(p.percent).toBe(100);
    expect(p.resumePart).toBeNull();
  });

  it("reports 0 percent for an empty module rather than NaN", () => {
    const p = moduleProgress("student_1", "m1", []);
    expect(p.percent).toBe(0);
    expect(p.lastStudiedAt).toBeNull();
  });

  it("never counts another member's progress", () => {
    study({ member: "student_2", part: "ss1", action: "completed" });
    expect(moduleProgress("student_1", "m1", SUBS).completed).toBe(0);
  });
});

describe("the spaced-repetition step", () => {
  it("puts a first success one day out", () => {
    const s = nextReview(NEW_CARD, GRADE_GOOD, T0);
    expect(s.reps).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.dueAt).toBe(T0 + DAY_MS);
    expect(s.lastReviewedAt).toBe(T0);
  });

  it("grows the interval across successive good grades", () => {
    // 1 day, then 6, then ease-multiplied. The whole point of the scheduler is
    // that a card you keep knowing stops being asked so often.
    const first = nextReview(NEW_CARD, GRADE_GOOD, T0);
    const second = nextReview(first, GRADE_GOOD, T0 + DAY_MS);
    const third = nextReview(second, GRADE_GOOD, T0 + 7 * DAY_MS);
    expect([first.intervalDays, second.intervalDays, third.intervalDays]).toEqual([1, 6, 15]);
    expect(third.dueAt).toBe(T0 + 7 * DAY_MS + 15 * DAY_MS);
  });

  it("moves ease down for a hard card and up for an easy one", () => {
    expect(nextReview(NEW_CARD, GRADE_HARD, T0).ease).toBeCloseTo(2.35, 5);
    expect(nextReview(NEW_CARD, GRADE_GOOD, T0).ease).toBeCloseTo(2.5, 5);
    expect(nextReview(NEW_CARD, GRADE_EASY, T0).ease).toBeCloseTo(2.65, 5);
  });

  it("sends a forgotten card back to today, not to tomorrow", () => {
    // Pressing "forgot" is a request to see the card again in this session. A
    // scheduler that answers "tomorrow" teaches members to stop pressing it
    // honestly, which costs more than the lost interval.
    const known = nextReview(nextReview(NEW_CARD, GRADE_GOOD, T0), GRADE_GOOD, T0 + DAY_MS);
    const lapsed = nextReview(known, GRADE_FORGOT, T0 + 2 * DAY_MS);
    expect(lapsed.dueAt).toBe(T0 + 2 * DAY_MS);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.ease).toBeCloseTo(2.3, 5);
  });

  it("floors ease so a bad run can't pin a card at an interval it can't escape", () => {
    let s = NEW_CARD;
    for (let i = 0; i < 12; i++) s = nextReview(s, GRADE_FORGOT, T0 + i * DAY_MS);
    expect(s.ease).toBe(MIN_EASE);
    expect(s.lapses).toBe(12);
  });

  it("always advances the interval by at least a day once a card is known", () => {
    // With ease at the floor, an un-rounded multiply can leave the interval
    // where it was, and the card never graduates.
    let s = NEW_CARD;
    for (let i = 0; i < 12; i++) s = nextReview(s, GRADE_HARD, T0 + i * DAY_MS);
    expect(s.ease).toBe(MIN_EASE);
    expect(s.intervalDays).toBeGreaterThan(1);
  });
});

describe("replaying a card's grades", () => {
  it("treats a card with no history as new", () => {
    expect(reviewState([])).toEqual(NEW_CARD);
  });

  it("gives the same answer whatever order the events arrive in", () => {
    // The log is read newest-first, so a fold that depended on arrival order
    // would compute a different schedule than the one the member earned.
    const grades = [
      { grade: GRADE_GOOD, at: T0 },
      { grade: GRADE_HARD, at: T0 + DAY_MS },
      { grade: GRADE_GOOD, at: T0 + 8 * DAY_MS },
    ];
    expect(reviewState([...grades].reverse())).toEqual(reviewState(grades));
  });

  it("is reproducible from the events alone, with no stored ease or interval", () => {
    const grades = [
      { grade: GRADE_GOOD, at: T0 },
      { grade: GRADE_GOOD, at: T0 + DAY_MS },
    ];
    const stepped = nextReview(nextReview(NEW_CARD, GRADE_GOOD, T0), GRADE_GOOD, T0 + DAY_MS);
    expect(reviewState(grades)).toEqual(stepped);
  });
});

describe("cardKey", () => {
  it("survives reordering, because an index is not an identity", () => {
    // Inserting one card at the top of a deck would otherwise shift every
    // member's scheduling onto the wrong card, silently.
    const cards = [{ front: "Tachycardia" }, { front: "Hypoxia" }];
    const reordered = [...cards].reverse();
    expect(cards.map(cardKey)).toEqual(reordered.map(cardKey).reverse());
  });

  it("ignores the answer, so fixing a definition doesn't reset the schedule", () => {
    expect(cardKey({ front: "Tachycardia" })).toBe(cardKey({ front: "Tachycardia" }));
  });

  it("changes when the prompt changes, because that is a different thing to learn", () => {
    expect(cardKey({ front: "Tachycardia" })).not.toBe(cardKey({ front: "Bradycardia" }));
  });

  it("distinguishes an image-only card from a bare one", () => {
    expect(cardKey({ front: "", frontImageId: "img_1" })).not.toBe(cardKey({ front: "" }));
    expect(cardKey({ front: "", frontImageId: "img_1" })).not.toBe(cardKey({ front: "", frontImageId: "img_2" }));
  });
});

describe("deckSchedule", () => {
  const CARDS = [{ front: "A" }, { front: "B" }, { front: "C" }];
  const review = (front: string, grade: 0 | 1 | 2 | 3, at: number) =>
    recordStudy({ member: "student_1", kind: "deck", refId: "d1", part: cardKey({ front }), action: "reviewed", grade, now: at });

  it("counts a never-reviewed card as unseen and due", () => {
    const s = deckSchedule("student_1", "d1", CARDS, T0);
    expect(s).toMatchObject({ total: 3, unseen: 3, due: 3, resting: 0, nextDueAt: null });
  });

  it("rests a card that was just answered and says when it comes back", () => {
    review("A", GRADE_GOOD, T0);
    const s = deckSchedule("student_1", "d1", CARDS, T0 + 60 * 60 * 1000);
    expect(s).toMatchObject({ total: 3, unseen: 2, due: 2, resting: 1 });
    expect(s.nextDueAt).toBe(T0 + DAY_MS);
  });

  it("brings a rested card back once its interval has elapsed", () => {
    review("A", GRADE_GOOD, T0);
    expect(deckSchedule("student_1", "d1", CARDS, T0 + DAY_MS).due).toBe(3);
  });

  it("keeps a forgotten card in the session", () => {
    review("A", GRADE_FORGOT, T0);
    const a = deckSchedule("student_1", "d1", CARDS, T0 + 1000).cards[0];
    expect(a.due).toBe(true);
    expect(a.state.lapses).toBe(1);
  });

  it("lets the deck's current contents define the session", () => {
    // A card the owner deleted stops being asked and a new one shows up as
    // unseen, with nobody migrating a stored schedule to match.
    review("A", GRADE_GOOD, T0);
    review("B", GRADE_GOOD, T0);
    const s = deckSchedule("student_1", "d1", [{ front: "B" }, { front: "D" }], T0 + 60_000);
    expect(s.total).toBe(2);
    expect(s.unseen).toBe(1); // D
    expect(s.cards.map((c) => c.index)).toEqual([0, 1]);
  });

  it("never folds another member's reviews into your schedule", () => {
    recordStudy({ member: "student_2", kind: "deck", refId: "d1", part: cardKey({ front: "A" }), action: "reviewed", grade: GRADE_GOOD, now: T0 });
    expect(deckSchedule("student_1", "d1", CARDS, T0 + 60_000).unseen).toBe(3);
  });
});

describe("the transcript", () => {
  const seed = () => {
    study({ kind: "module", refId: "m1", part: "ss1", action: "viewed", now: T0, title: "EMT Fundamentals" });
    study({ kind: "module", refId: "m1", part: "ss1", action: "completed", now: T0 + 1000, title: "EMT Fundamentals" });
    study({ kind: "module", refId: "m1", part: "ss2", action: "viewed", now: T0 + 2000, title: "EMT Fundamentals" });
    study({ kind: "deck", refId: "d1", part: "cA", action: "reviewed", grade: GRADE_GOOD, now: T0 + 5000, title: "Medical Terminology" });
    study({ kind: "deck", refId: "d1", part: "cB", action: "reviewed", grade: GRADE_HARD, now: T0 + 6000, title: "Medical Terminology" });
  };

  it("groups by content, most recently studied first", () => {
    seed();
    const rows = transcript("student_1");
    expect(rows.map((r) => r.refId)).toEqual(["d1", "m1"]);
  });

  it("counts distinct parts, not raw events", () => {
    // Two opens of the same subsection is one subsection read. Counting events
    // would let a member inflate their transcript by clicking around.
    seed();
    study({ kind: "module", refId: "m1", part: "ss2", action: "viewed", now: T0 + 9000 });
    const mod = transcript("student_1").find((r) => r.refId === "m1")!;
    expect(mod.partsViewed).toBe(2);
    expect(mod.partsCompleted).toBe(1);
    expect(mod.reviews).toBe(0);
    expect(transcript("student_1").find((r) => r.refId === "d1")!.reviews).toBe(2);
  });

  it("brackets the whole span of studying one thing", () => {
    seed();
    const mod = transcript("student_1").find((r) => r.refId === "m1")!;
    expect(mod.firstStudiedAt).toBe(T0);
    expect(mod.lastStudiedAt).toBe(T0 + 2000);
  });

  it("prefers the live title so a rename follows", () => {
    seed();
    const rows = transcript("student_1", (kind, refId) => (kind === "module" && refId === "m1" ? "EMT Fundamentals (2027)" : undefined));
    const mod = rows.find((r) => r.refId === "m1")!;
    expect(mod.title).toBe("EMT Fundamentals (2027)");
    expect(mod.removed).toBe(false);
  });

  it("falls back to the snapshot when the content is gone", () => {
    // A transcript of ids nobody can place is not a record of anything.
    seed();
    const mod = transcript("student_1").find((r) => r.refId === "m1")!;
    expect(mod.title).toBe("EMT Fundamentals");
    expect(mod.removed).toBe(true);
  });

  it("names content that was deleted before titles were snapshotted", () => {
    study({ kind: "quiz", refId: "q_old", action: "viewed" });
    expect(transcript("student_1")[0].title).toBe(REMOVED_TITLE);
  });

  it("separates finishing the content from finishing a part of it", () => {
    study({ kind: "doc", refId: "doc1", action: "completed" });
    study({ kind: "module", refId: "m1", part: "ss1", action: "completed" });
    const rows = transcript("student_1");
    expect(rows.find((r) => r.refId === "doc1")!.completed).toBe(true);
    expect(rows.find((r) => r.refId === "m1")!.completed).toBe(false);
  });

  it("is empty for a member who has studied nothing, and for a blank one", () => {
    seed();
    expect(transcript("student_2")).toEqual([]);
    expect(transcript("")).toEqual([]);
  });
});

describe("the per-member cap", () => {
  it("spends views before completions and reviews", () => {
    // Eviction is where a member's history actually gets destroyed, so it has
    // to destroy the cheapest fact first. A lost completion resets their
    // progress bar; a lost review resets a card's schedule; a lost view costs
    // a resume point.
    recordStudy({ member: "student_1", kind: "module", refId: "m1", part: "keep", action: "completed", now: T0 });
    recordStudy({ member: "student_1", kind: "deck", refId: "d1", part: "cA", action: "reviewed", grade: GRADE_GOOD, now: T0 + 1 });
    for (let i = 0; i < MAX_EVENTS_PER_MEMBER; i++) {
      recordStudy({ member: "student_1", kind: "module", refId: "m1", part: `ss${i}`, action: "viewed", now: T0 + 100 + i });
    }

    const mine = listStudy("student_1");
    expect(mine).toHaveLength(MAX_EVENTS_PER_MEMBER);
    expect(mine.filter((e) => e.action === "completed")).toHaveLength(1);
    expect(mine.filter((e) => e.action === "reviewed")).toHaveLength(1);
  });

  it("caps each member separately", () => {
    // One heavy user must not evict a quieter member's records.
    recordStudy({ member: "student_2", kind: "module", refId: "m1", part: "ss1", action: "completed", now: T0 });
    for (let i = 0; i < MAX_EVENTS_PER_MEMBER + 5; i++) {
      recordStudy({ member: "student_1", kind: "module", refId: "m1", part: `ss${i}`, action: "viewed", now: T0 + i });
    }
    expect(listStudy("student_2")).toHaveLength(1);
  });
});

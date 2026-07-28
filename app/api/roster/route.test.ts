// The roster: the members a trainer/advisor/admin may assign work to, with
// their completion counts. Scoped by chapter, and closed to students.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";
import { __resetAssignments, createAssignment, markDone } from "@/lib/assignments";
import { SESSION_COOKIE } from "@/lib/auth";
import { type Identity, mintIdentityToken } from "@/lib/identity-token";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetUsers, rememberUser } from "@/lib/users";

const SECRET = "shared-secret-at-least-16-chars";
// `chapter` is the host app's chapter ID (a cuid) - the scoping key everything
// filters on. `chapterName` is the only thing that may be rendered.
const TC = "clx3k2p9f0001";
const TC_NAME = "Toronto Central";
const VW = "clx3k2p9f0002";
const VW_NAME = "Vancouver West";

const PEOPLE = {
  rivera: { sub: "t_rivera", name: "Coach Rivera", chapter: TC, chapterName: TC_NAME, role: "trainer" },
  ada: { sub: "s_ada", name: "Ada Okafor", chapter: TC, chapterName: TC_NAME, role: "student" },
  liam: { sub: "s_liam", name: "Liam Tremblay", chapter: TC, chapterName: TC_NAME, role: "student" },
  zoe: { sub: "s_zoe", name: "Zoe Roy", chapter: VW, chapterName: VW_NAME, role: "student" },
  daniel: { sub: "admin_1", name: "Daniel Liu", chapter: "clx_hq", chapterName: "HOSA Canada", role: "admin" },
  nomad: { sub: "t_nomad", name: "No Chapter", chapter: "", chapterName: "", role: "trainer" },
  drifter: { sub: "s_drifter", name: "Unplaced Student", chapter: "", chapterName: "", role: "student" },
  // A member whose token predates chapterName: chapter id only, no display
  // name. Parked in a chapter of their own so they don't perturb the counts.
  legacy: { sub: "s_legacy", name: "Legacy Token", chapter: "clx_solo", role: "student" },
} as const;

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];
/** Both payload shapes: the student's reduced view has no counts/timestamps. */
interface Row {
  id: string;
  name: string;
  /** Chapter id (scoping key). */
  chapter: string;
  /** Chapter display name; "" on a legacy token. */
  chapterName: string;
  role: string;
  assigned?: number;
  done?: number;
  lastSeenAt?: number;
}

const get = (p: Person, query = "") =>
  GET(new NextRequest(`https://v.test/api/roster${query}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}` },
  }));

const rosterOf = async (p: Person, query = ""): Promise<Row[]> => (await (await get(p, query)).json()).roster;

let moduleId = "";

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetAssignments();
  __resetUsers();
  __resetModules();
  moduleId = createModule("Airway Management", "system").id;
  for (const p of Object.values(PEOPLE)) rememberUser({ ...p, exp: 9e9, iat: 0 } as Identity);
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  __resetAssignments();
  __resetUsers();
  __resetModules();
});

describe("GET /api/roster", () => {
  it("gives a trainer their own chapter, sorted by name", async () => {
    const roster = await rosterOf(PEOPLE.rivera);
    expect(roster.map((r) => r.name)).toEqual(["Ada Okafor", "Coach Rivera", "Liam Tremblay"]);
    expect(roster.some((r) => r.id === "s_zoe")).toBe(false);
  });

  it("narrows to a role on request", async () => {
    expect((await rosterOf(PEOPLE.rivera, "?role=student")).map((r) => r.id)).toEqual(["s_ada", "s_liam"]);
  });

  it("carries each member's assigned/done counts", async () => {
    const first = await createAssignment({
      kind: "module", refId: moduleId, assigneeId: "s_ada",
      assignedBy: "t_rivera", assignedByName: "Coach Rivera", chapter: TC,
    });
    const second = createModule("Second", "system");
    await createAssignment({
      kind: "module", refId: second.id, assigneeId: "s_ada",
      assignedBy: "t_rivera", assignedByName: "Coach Rivera", chapter: TC,
    });
    if (first.ok) markDone(first.assignment.id, "s_ada");

    const roster = await rosterOf(PEOPLE.rivera, "?role=student");
    expect(roster.find((r) => r.id === "s_ada")).toMatchObject({ assigned: 2, done: 1 });
    expect(roster.find((r) => r.id === "s_liam")).toMatchObject({ assigned: 0, done: 0 });
  });

  it("gives an admin every chapter", async () => {
    const roster = await rosterOf(PEOPLE.daniel);
    expect(roster).toHaveLength(Object.keys(PEOPLE).length);
    expect(roster.some((r) => r.id === "s_zoe")).toBe(true);
  });

  it("gives a chapter-less trainer nothing rather than everyone", async () => {
    expect(await rosterOf(PEOPLE.nomad)).toEqual([]);
  });

  it("keeps the teaching payload whole - counts, timestamps, and no limited flag", async () => {
    const body = await (await get(PEOPLE.rivera)).json();
    expect(body.limited).toBeUndefined();
    const row = body.roster.find((r: Row) => r.id === "s_ada");
    expect(Object.keys(row).sort()).toEqual(["assigned", "chapter", "chapterName", "done", "id", "lastSeenAt", "name", "role"]);
  });

  it("keeps the admin payload whole too", async () => {
    const body = await (await get(PEOPLE.daniel)).json();
    expect(body.scope).toBe("all");
    expect(body.limited).toBeUndefined();
    expect(body.roster[0]).toHaveProperty("lastSeenAt");
  });

  it("carries the chapter id and its display name as separate fields", async () => {
    const roster = await rosterOf(PEOPLE.rivera);
    expect(roster.find((r) => r.id === "s_ada")).toMatchObject({ chapter: TC, chapterName: TC_NAME });
  });

  it("sends an empty chapterName for a member on a legacy token", async () => {
    // Admin sees every chapter, including the one this member is parked in.
    const row = (await rosterOf(PEOPLE.daniel)).find((r) => r.id === "s_legacy")!;
    expect(row.chapterName).toBe("");
    expect(row.chapterName || row.chapter).toBe("clx_solo");
  });

  it("404s when dashboard mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await get(PEOPLE.rivera)).status).toBe(404);
  });
});

describe("GET /api/roster - the student's reduced view", () => {
  it("gives a student their own chapter, everyone in it", async () => {
    const body = await (await get(PEOPLE.ada)).json();
    expect(body.scope).toBe("chapter");
    expect(body.limited).toBe(true);
    // Trainers and advisors included: members should see who teaches them.
    expect(body.roster.map((r: Row) => r.name)).toEqual(["Ada Okafor", "Coach Rivera", "Liam Tremblay"]);
    // And the chapter reads as a name, not as the cuid it's scoped by.
    expect(body.roster[0]).toMatchObject({ chapter: TC, chapterName: TC_NAME });
  });

  it("omits completion counts and activity entirely - absent, not zeroed", async () => {
    // A 0 would read as "this classmate has nothing assigned"; absent means
    // "not shown". Assert the keys are MISSING, not merely falsy.
    const roster = await rosterOf(PEOPLE.ada);
    for (const row of roster) {
      expect(Object.keys(row).sort()).toEqual(["chapter", "chapterName", "id", "name", "role"]);
      expect(row).not.toHaveProperty("assigned");
      expect(row).not.toHaveProperty("done");
      expect(row).not.toHaveProperty("lastSeenAt");
    }
  });

  it("hides the counts even from a student who HAS assignments in the chapter", async () => {
    await createAssignment({
      kind: "module", refId: moduleId, assigneeId: "s_liam",
      assignedBy: "t_rivera", assignedByName: "Coach Rivera", chapter: TC,
    });
    const liam = (await rosterOf(PEOPLE.ada)).find((r) => r.id === "s_liam")!;
    expect(liam).not.toHaveProperty("assigned");
  });

  it("scopes a student to their OWN chapter, not the one they ask about", async () => {
    const roster = await rosterOf(PEOPLE.zoe);
    expect(roster.map((r) => r.id)).toEqual(["s_zoe"]);
    expect(roster.some((r) => r.chapter === TC)).toBe(false);
  });

  it("gives a chapter-less student nothing rather than everyone", async () => {
    expect(await rosterOf(PEOPLE.drifter)).toEqual([]);
  });

  it("lets a student narrow by role - it can only remove rows", async () => {
    expect((await rosterOf(PEOPLE.ada, "?role=trainer")).map((r) => r.name)).toEqual(["Coach Rivera"]);
    expect((await rosterOf(PEOPLE.ada, "?role=student")).map((r) => r.id)).toEqual(["s_ada", "s_liam"]);
  });

  it("404s when dashboard mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await get(PEOPLE.ada)).status).toBe(404);
  });
});

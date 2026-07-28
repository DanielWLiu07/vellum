// Assignments API: who may hand work out, to whom, and who may see whose.
// Every request carries a real signed HOSA session - the role rules live on the
// identity token, not on the (unpatchable) local profile.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET, POST } from "./route";
import { __resetAssignments, createAssignment, listAssignmentsFor } from "@/lib/assignments";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { type Identity, mintIdentityToken } from "@/lib/identity-token";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetUsers, rememberUser } from "@/lib/users";

const SECRET = "shared-secret-at-least-16-chars";
const TC = "Toronto Central";
const VW = "Vancouver West";

const PEOPLE = {
  rivera: { sub: "t_rivera", name: "Coach Rivera", chapter: TC, role: "trainer" },
  singh: { sub: "t_singh", name: "Dr. Singh", chapter: VW, role: "trainer" },
  lefebvre: { sub: "a_lefebvre", name: "Ms. Lefebvre", chapter: TC, role: "advisor" },
  ada: { sub: "s_ada", name: "Ada Okafor", chapter: TC, role: "student" },
  liam: { sub: "s_liam", name: "Liam Tremblay", chapter: TC, role: "student" },
  zoe: { sub: "s_zoe", name: "Zoe Roy", chapter: VW, role: "student" },
  daniel: { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" },
} as const;

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

const tokenFor = (p: Person) => mintIdentityToken(SECRET, { ...p });
const as = (p: Person, path = "", init?: { method?: string; body?: unknown }) =>
  new NextRequest(`https://v.test/api/assignments${path}`, {
    method: init?.method ?? "GET",
    headers: { Cookie: `${SESSION_COOKIE}=${tokenFor(p)}`, "Content-Type": "application/json" },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const post = (p: Person, body: unknown) => POST(as(p, "", { method: "POST", body }));
const get = (p: Person, path = "") => GET(as(p, path));

/** Vitals only knows members who have entered at least once (lib/users). */
const known = (p: Person) => rememberUser({ ...p, exp: 9e9, iat: 0 } as Identity);

let moduleId = "";

beforeEach(() => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetAssignments();
  __resetUsers();
  __resetModules();
  moduleId = createModule("Airway Management", "system").id;
  for (const p of Object.values(PEOPLE)) known(p);
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.VELLUM_DEMO_MODE;
  delete process.env.VITALS_AUTH_SECRET;
  __resetAssignments();
  __resetUsers();
  __resetModules();
  vi.clearAllMocks();
});

/** Seed an assignment straight into the store, bypassing the API's policy. */
const seed = (assignee: Person, by: Person = PEOPLE.rivera) =>
  createAssignment({
    kind: "module", refId: moduleId, assigneeId: assignee.sub,
    assignedBy: by.sub, assignedByName: by.name, chapter: assignee.chapter,
  });

describe("GET /api/assignments", () => {
  it("gives a student their own assignments and nobody else's", async () => {
    await seed(PEOPLE.ada);
    await seed(PEOPLE.liam);
    const body = await (await get(PEOPLE.ada)).json();
    expect(body.scope).toBe("self");
    expect(body.assignments.map((a: { assigneeId: string }) => a.assigneeId)).toEqual(["s_ada"]);
  });

  it("ignores ?assignee= for a student - they can't read a classmate's list", async () => {
    await seed(PEOPLE.liam);
    const body = await (await get(PEOPLE.ada, "?assignee=s_liam")).json();
    expect(body.assignments).toEqual([]);
  });

  it("gives a trainer their whole chapter, but not another chapter", async () => {
    await seed(PEOPLE.ada);
    await seed(PEOPLE.liam);
    await seed(PEOPLE.zoe, PEOPLE.singh);
    const body = await (await get(PEOPLE.rivera)).json();
    expect(body.scope).toBe("chapter");
    expect(body.assignments.map((a: { assigneeId: string }) => a.assigneeId).sort()).toEqual(["s_ada", "s_liam"]);
  });

  it("filters a trainer's chapter list by assignee, and never outside it", async () => {
    await seed(PEOPLE.ada);
    await seed(PEOPLE.zoe, PEOPLE.singh);
    expect((await (await get(PEOPLE.rivera, "?assignee=s_ada")).json()).assignments).toHaveLength(1);
    expect((await (await get(PEOPLE.rivera, "?assignee=s_zoe")).json()).assignments).toEqual([]);
  });

  it("gives an advisor their chapter too", async () => {
    await seed(PEOPLE.ada);
    await seed(PEOPLE.zoe, PEOPLE.singh);
    const body = await (await get(PEOPLE.lefebvre)).json();
    expect(body.assignments.map((a: { assigneeId: string }) => a.assigneeId)).toEqual(["s_ada"]);
  });

  it("gives an admin everything, filterable by assignee", async () => {
    await seed(PEOPLE.ada);
    await seed(PEOPLE.zoe, PEOPLE.singh);
    const all = await (await get(PEOPLE.daniel)).json();
    expect(all.scope).toBe("all");
    expect(all.assignments).toHaveLength(2);
    expect((await (await get(PEOPLE.daniel, "?assignee=s_zoe")).json()).assignments).toHaveLength(1);
  });

  it("404s when dashboard mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await get(PEOPLE.ada)).status).toBe(404);
  });
});

describe("POST /api/assignments", () => {
  it("lets a trainer assign to a student in their chapter", async () => {
    const res = await post(PEOPLE.rivera, { kind: "module", refId: moduleId, dueAt: 1_800_000_000_000, assigneeId: "s_ada" });
    expect(res.status).toBe(200);
    const { assignment, duplicate } = await res.json();
    expect(duplicate).toBe(false);
    expect(assignment).toMatchObject({
      kind: "module", refId: moduleId, title: "Airway Management",
      assigneeId: "s_ada", assignedBy: "t_rivera", assignedByName: "Coach Rivera",
      chapter: TC, dueAt: 1_800_000_000_000, status: "todo",
    });
    expect(recordAudit).toHaveBeenCalledWith("assignment.create", "Airway Management", "module -> Ada Okafor");
  });

  it("refuses a student outright - assigning is a teaching action", async () => {
    const res = await post(PEOPLE.ada, { kind: "module", refId: moduleId, assigneeId: "s_liam" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(listAssignmentsFor("s_liam")).toEqual([]);
  });

  it("refuses a trainer assigning outside their own chapter", async () => {
    const res = await post(PEOPLE.rivera, { kind: "module", refId: moduleId, assigneeId: "s_zoe" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cross_chapter");
    expect(listAssignmentsFor("s_zoe")).toEqual([]);
  });

  it("refuses an advisor assigning outside their own chapter", async () => {
    expect((await post(PEOPLE.lefebvre, { kind: "module", refId: moduleId, assigneeId: "s_zoe" })).status).toBe(403);
  });

  it("lets an admin assign to any chapter", async () => {
    const res = await post(PEOPLE.daniel, { kind: "module", refId: moduleId, assigneeId: "s_zoe" });
    expect(res.status).toBe(200);
    expect((await res.json()).assignment.chapter).toBe(VW);
  });

  it("404s a member Vitals has never seen", async () => {
    const res = await post(PEOPLE.daniel, { kind: "module", refId: moduleId, assigneeId: "s_never_entered" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown_assignee");
  });

  it("rejects an unknown kind (400) apart from content that isn't there (404)", async () => {
    const badKind = await post(PEOPLE.rivera, { kind: "video", refId: moduleId, assigneeId: "s_ada" });
    expect(badKind.status).toBe(400);
    expect((await badKind.json()).error).toBe("bad_kind");

    const badRef = await post(PEOPLE.rivera, { kind: "module", refId: "m_nope", assigneeId: "s_ada" });
    expect(badRef.status).toBe(404);
    expect((await badRef.json()).error).toBe("unknown_ref");
  });

  it("400s a missing body or assignee", async () => {
    expect((await POST(as(PEOPLE.rivera, "", { method: "POST" }))).status).toBe(400);
    expect((await post(PEOPLE.rivera, { kind: "module", refId: moduleId })).status).toBe(400);
  });

  it("assigns the bundled document by reference", async () => {
    const res = await post(PEOPLE.rivera, { kind: "doc", refId: "sample", assigneeId: "s_ada" });
    expect(res.status).toBe(200);
    expect((await res.json()).assignment).toMatchObject({ kind: "doc", refId: "sample", title: "Vitals - overview (sample)" });
  });

  it("collapses a double-click into one assignment and audits it once", async () => {
    await post(PEOPLE.rivera, { kind: "module", refId: moduleId, assigneeId: "s_ada" });
    const again = await post(PEOPLE.rivera, { kind: "module", refId: moduleId, assigneeId: "s_ada" });
    expect((await again.json()).duplicate).toBe(true);
    expect(listAssignmentsFor("s_ada")).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("404s when dashboard mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await post(PEOPLE.rivera, { kind: "module", refId: moduleId, assigneeId: "s_ada" })).status).toBe(404);
  });
});

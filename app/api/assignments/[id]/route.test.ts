// Completing and un-assigning: only the assignee finishes their own work, and
// only the person who assigned it (or an admin) can take it back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { DELETE, PATCH } from "./route";
import { __resetAssignments, createAssignment, getAssignment } from "@/lib/assignments";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { mintIdentityToken } from "@/lib/identity-token";
import { __resetModules, createModule } from "@/lib/modules";
import { __resetUsers } from "@/lib/users";

const SECRET = "shared-secret-at-least-16-chars";
const TC = "Toronto Central";

const PEOPLE = {
  rivera: { sub: "t_rivera", name: "Coach Rivera", chapter: TC, role: "trainer" },
  singh: { sub: "t_singh", name: "Dr. Singh", chapter: TC, role: "trainer" },
  ada: { sub: "s_ada", name: "Ada Okafor", chapter: TC, role: "student" },
  liam: { sub: "s_liam", name: "Liam Tremblay", chapter: TC, role: "student" },
  daniel: { sub: "admin_1", name: "Daniel Liu", chapter: "HOSA Canada", role: "admin" },
} as const;

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

const req = (p: Person, id: string, method: string, body?: unknown) =>
  new NextRequest(`https://v.test/api/assignments/${id}`, {
    method,
    headers: { Cookie: `${SESSION_COOKIE}=${mintIdentityToken(SECRET, { ...p })}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (p: Person, id: string, body: unknown = { status: "done" }) => PATCH(req(p, id, "PATCH", body), ctx(id));
const del = (p: Person, id: string) => DELETE(req(p, id, "DELETE"), ctx(id));

let assignmentId = "";

beforeEach(async () => {
  process.env.VELLUM_DEMO_MODE = "1";
  process.env.VITALS_AUTH_SECRET = SECRET;
  __resetAssignments();
  __resetUsers();
  __resetModules();
  const mod = createModule("Airway Management", "system");
  const res = await createAssignment({
    kind: "module", refId: mod.id, assigneeId: PEOPLE.ada.sub,
    assignedBy: PEOPLE.rivera.sub, assignedByName: PEOPLE.rivera.name, chapter: TC,
  });
  assignmentId = res.ok ? res.assignment.id : "";
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

describe("PATCH /api/assignments/[id]", () => {
  it("lets the assignee mark their own assignment done", async () => {
    const res = await patch(PEOPLE.ada, assignmentId);
    expect(res.status).toBe(200);
    const { assignment } = await res.json();
    expect(assignment.status).toBe("done");
    expect(typeof assignment.completedAt).toBe("number");
    expect(recordAudit).toHaveBeenCalledWith("assignment.complete", "Airway Management");
  });

  it("refuses another student, and the trainer who assigned it", async () => {
    expect((await patch(PEOPLE.liam, assignmentId)).status).toBe(403);
    expect((await patch(PEOPLE.rivera, assignmentId)).status).toBe(403);
    expect(getAssignment(assignmentId)?.status).toBe("todo");
  });

  it("refuses an admin marking someone else's work done", async () => {
    // Admins can take an assignment BACK, but completing it is the member's act
    // - otherwise the roster's progress numbers stop meaning anything.
    expect((await patch(PEOPLE.daniel, assignmentId)).status).toBe(403);
  });

  it("404s an assignment that doesn't exist", async () => {
    expect((await patch(PEOPLE.ada, "as_nope")).status).toBe(404);
  });

  it("400s a body that isn't {status:'done'}", async () => {
    expect((await patch(PEOPLE.ada, assignmentId, { status: "todo" })).status).toBe(400);
    // No body at all.
    expect((await PATCH(req(PEOPLE.ada, assignmentId, "PATCH"), ctx(assignmentId))).status).toBe(400);
    expect(getAssignment(assignmentId)?.status).toBe("todo");
  });

  it("404s when dashboard mode is off", async () => {
    delete process.env.VELLUM_DEMO_MODE;
    expect((await patch(PEOPLE.ada, assignmentId)).status).toBe(404);
  });
});

describe("DELETE /api/assignments/[id]", () => {
  it("lets the trainer who assigned it take it back", async () => {
    const res = await del(PEOPLE.rivera, assignmentId);
    expect(res.status).toBe(200);
    expect(getAssignment(assignmentId)).toBeUndefined();
    expect(recordAudit).toHaveBeenCalledWith("assignment.unassign", "Airway Management", "from s_ada");
  });

  it("lets an admin take back an assignment they didn't make", async () => {
    expect((await del(PEOPLE.daniel, assignmentId)).status).toBe(200);
    expect(getAssignment(assignmentId)).toBeUndefined();
  });

  it("refuses another trainer and the assignee", async () => {
    expect((await del(PEOPLE.singh, assignmentId)).status).toBe(403);
    expect((await del(PEOPLE.ada, assignmentId)).status).toBe(403);
    expect(getAssignment(assignmentId)).toBeDefined();
  });

  it("404s an assignment that doesn't exist", async () => {
    expect((await del(PEOPLE.daniel, "as_nope")).status).toBe(404);
  });
});

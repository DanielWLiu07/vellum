import { describe, expect, it } from "vitest";

import { adminAccess } from "./admin-gate";

describe("adminAccess", () => {
  it("grants a signed admin", () => {
    expect(adminAccess({ role: "admin" })).toBe("granted");
  });

  // The bug this exists for: a student previewing the admin menu is still a
  // student, and every non-admin role has to land in the same place.
  it.each(["student", "trainer", "advisor"])("denies a signed %s", (role) => {
    expect(adminAccess({ role })).toBe("denied");
  });

  it("waits rather than accusing while the identity is unknown", () => {
    expect(adminAccess(null)).toBe("checking");
  });

  // Fail closed on anything that is not exactly what the server checks for.
  // lib/profile compares `p.role === "admin"`; a client that matched more
  // loosely would show a console the API then refuses to fill.
  it.each(["", "Admin", "ADMIN", "administrator", "superadmin", "admin "])(
    "denies %o rather than guessing",
    (role) => {
      expect(adminAccess({ role })).toBe("denied");
    },
  );
});

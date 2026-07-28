import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "./demo-data";
import { DEFAULT_SECTION, NAV, roleFromParam, sectionFromParam } from "./nav";

const ALL_ROLES = ROLES.map((r) => r.id);

describe("nav ordering", () => {
  it("puts My chapter first in every role's menu", () => {
    for (const role of ALL_ROLES) {
      expect(NAV[role][0]!.id, `${role} menu`).toBe("chapter");
    }
  });

  it("keeps My chapter in all four menus exactly once", () => {
    for (const role of ALL_ROLES) {
      expect(NAV[role].filter((n) => n.id === "chapter")).toHaveLength(1);
    }
  });

  it("still ends every menu with the shared utility links", () => {
    for (const role of ALL_ROLES) {
      const tail = NAV[role].slice(-4).map((n) => n.id);
      expect(tail, `${role} menu`).toEqual(["guidelines", "feedback", "upload", "profile"]);
    }
  });
});

describe("DEFAULT_SECTION", () => {
  // These are the landing views as they shipped. Reordering the sidebar must
  // never move them, which is the whole reason they're named rather than
  // derived from position one.
  it("is the section each role has always landed on", () => {
    expect(DEFAULT_SECTION).toEqual({
      student: "home",
      trainer: "lessons",
      advisor: "home",
      admin: "overview",
    });
  });

  it("is never the first nav item, now that My chapter leads", () => {
    for (const role of ALL_ROLES) {
      expect(DEFAULT_SECTION[role], `${role} default`).not.toBe(NAV[role][0]!.id);
    }
  });

  it("names a real, non-link section in that role's menu", () => {
    for (const role of ALL_ROLES) {
      const item = NAV[role].find((n) => n.id === DEFAULT_SECTION[role]);
      expect(item, `${role} default`).toBeDefined();
      expect(item!.href).toBeUndefined();
    }
  });
});

describe("sectionFromParam", () => {
  it("accepts a real section", () => {
    expect(sectionFromParam("student", "assignments")).toBe("assignments");
    expect(sectionFromParam("admin", "activity")).toBe("activity");
    expect(sectionFromParam("student", "chapter")).toBe("chapter");
  });

  it("falls back to the role's DEFAULT_SECTION, not to position one", () => {
    for (const role of ALL_ROLES) {
      expect(sectionFromParam(role, "nonsense"), `${role} fallback`).toBe(DEFAULT_SECTION[role]);
      expect(sectionFromParam(role, null)).toBe(DEFAULT_SECTION[role]);
      expect(sectionFromParam(role, undefined)).toBe(DEFAULT_SECTION[role]);
    }
  });

  it("rejects href rows, which are pages rather than sections", () => {
    expect(sectionFromParam("student", "upload")).toBe(DEFAULT_SECTION.student);
    expect(sectionFromParam("student", "profile")).toBe(DEFAULT_SECTION.student);
  });

  it("rejects a section that belongs to a different role", () => {
    // "overview" is admin-only; a student asking for it lands on their default.
    expect(sectionFromParam("student", "overview")).toBe(DEFAULT_SECTION.student);
  });
});

describe("roleFromParam", () => {
  it("accepts known roles and falls back to student", () => {
    for (const role of ALL_ROLES) expect(roleFromParam(role)).toBe(role);
    expect(roleFromParam("superuser")).toBe("student");
    expect(roleFromParam(null)).toBe("student");
  });
});

describe("nav integrity", () => {
  it("has unique ids within each role's menu", () => {
    for (const role of ALL_ROLES) {
      const ids = NAV[role].map((n) => n.id);
      expect(new Set(ids).size, `${role} menu`).toBe(ids.length);
    }
  });

  it("covers every role", () => {
    expect(Object.keys(NAV).sort()).toEqual([...ALL_ROLES].sort() as Role[]);
  });
});

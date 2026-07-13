import { beforeEach, describe, expect, it } from "vitest";

import { __resetFolders, createFolder, deleteFolder, getFolder, listFolders, renameFolder } from "./folders";

beforeEach(() => __resetFolders());

describe("folders", () => {
  it("creates a folder with the owner and official flag", () => {
    const f = createFolder("My set", "you", false);
    expect(f.owner).toBe("you");
    expect(f.official).toBe(false);
    expect(getFolder(f.id)).toEqual(f);
  });

  it("lists official folders plus the viewer's own, and hides other people's", () => {
    createFolder("Yours", "you", false);
    createFolder("Official EMT", "HOSA Canada", true);
    createFolder("Nina's private", "nina", false);
    const names = listFolders("you").map((f) => f.name).sort();
    expect(names).toEqual(["Official EMT", "Yours"]); // Nina's is hidden
  });

  it("sorts official folders first, then alphabetically", () => {
    createFolder("Zzz personal", "you", false);
    createFolder("Aaa personal", "you", false);
    createFolder("Official B", "HOSA Canada", true);
    createFolder("Official A", "HOSA Canada", true);
    expect(listFolders("you").map((f) => f.name)).toEqual([
      "Official A", "Official B", "Aaa personal", "Zzz personal",
    ]);
  });

  it("renames and deletes", () => {
    const f = createFolder("Old", "you", false);
    renameFolder(f.id, "New");
    expect(getFolder(f.id)!.name).toBe("New");
    expect(deleteFolder(f.id)).toBe(true);
    expect(getFolder(f.id)).toBeUndefined();
  });

  it("falls back to a name when created blank", () => {
    const f = createFolder("   ", "you", false);
    expect(f.name).toBe("Untitled folder");
  });
});

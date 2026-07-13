/**
 * Resource folders. Two kinds:
 *   - official folders (official=true): created by an admin, visible to everyone
 *     - how HOSA organizes its many official resources per event.
 *   - personal folders: created by a member, visible to that owner.
 * A resource is placed in a folder via resource-meta.folderId (at most one).
 * Deleting a folder leaves its resources "unfiled" (the dangling folderId is
 * simply ignored by the UI). Demo-grade in-memory (globalThis).
 */

const NAME_MAX = 60;
const MAX_PER_OWNER = 100;

export interface Folder {
  id: string;
  name: string;
  owner: string;
  official: boolean;
  createdAt: number;
}

import { persistMap } from "./durable";

const g = globalThis as unknown as { __vitalsFolders?: Map<string, Folder> };
const store: Map<string, Folder> = (g.__vitalsFolders ??= new Map());
const { persist } = persistMap("folders", store);

const clean = (s: string) => s.trim().slice(0, NAME_MAX);

export function getFolder(id: string): Folder | undefined {
  return store.get(id);
}

/** Folders a viewer can see: every official folder plus their own. */
export function listFolders(owner: string): Folder[] {
  return [...store.values()]
    .filter((f) => f.official || f.owner === owner)
    .sort((a, b) => (Number(b.official) - Number(a.official)) || a.name.localeCompare(b.name));
}

export function createFolder(name: string, owner: string, official = false, id?: string): Folder {
  const folder: Folder = {
    id: id ?? `f_${crypto.randomUUID()}`,
    name: clean(name) || "Untitled folder",
    owner,
    official,
    createdAt: Date.now(),
  };
  store.set(folder.id, folder);
  // Per-owner cap (never evict official folders or another owner's).
  const mine = [...store.values()]
    .filter((f) => !f.official && f.owner === owner)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > MAX_PER_OWNER) {
    const old = mine.shift();
    if (old) store.delete(old.id);
  }
  persist();
  return folder;
}

export function renameFolder(id: string, name: string): Folder | undefined {
  const f = store.get(id);
  if (!f) return undefined;
  f.name = clean(name) || f.name;
  persist();
  return f;
}

export function deleteFolder(id: string): boolean {
  const ok = store.delete(id);
  if (ok) persist();
  return ok;
}

/** Test-only: clear all folders. */
export function __resetFolders(): void {
  store.clear();
}

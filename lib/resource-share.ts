/**
 * Post-upload share state for a document. Uploads start private; the owner can
 * later share them (set visibility, and a chapter if chapter-scoped). Kept as a
 * sidecar map (docId -> scope) so the storage layer doesn't need an update path.
 * Demo-grade in-memory, like the other stores.
 */

import type { Visibility } from "./visibility";

export interface ShareState {
  visibility: Visibility;
  chapter: string;
}

const g = globalThis as unknown as { __vitalsShare?: Map<string, ShareState> };
const store: Map<string, ShareState> = (g.__vitalsShare ??= new Map());

export function getShare(docId: string): ShareState | undefined {
  return store.get(docId);
}

export function setShare(docId: string, state: ShareState): void {
  store.set(docId, { visibility: state.visibility, chapter: state.chapter.slice(0, 80) });
}

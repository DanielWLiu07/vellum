/**
 * Per-resource classification metadata, kept as a sidecar (resource id -> meta)
 * like resource-share and favorites. Holds:
 *   - event: the HOSA competitive event this resource is for (a free-form tag,
 *     used for the event filter + "By event" sort)
 *   - noPreview: the uploader opted out of the auto page-preview thumbnail, so
 *     the card shows the plain placeholder instead
 * Demo-grade in-memory (globalThis), like the other stores.
 */

const EVENT_MAX = 60;

export interface ResourceMeta {
  event?: string;
  noPreview?: boolean;
  /** Official HOSA-created resource: badged and locked (only an admin sets it). */
  official?: boolean;
  /** Folder this resource is filed in (a Folder id), or unset if unfiled. */
  folderId?: string;
}

import { persistMap } from "./durable";

const g = globalThis as unknown as { __vitalsResourceMeta?: Map<string, ResourceMeta> };
const store: Map<string, ResourceMeta> = (g.__vitalsResourceMeta ??= new Map());
const { persist } = persistMap("resource-meta", store);

export function getResourceMeta(id: string): ResourceMeta | undefined {
  return store.get(id);
}

export function getResourceEvent(id: string): string | undefined {
  return store.get(id)?.event;
}

/** Merge a partial update; only the provided fields change. */
export function setResourceMeta(id: string, patch: ResourceMeta): ResourceMeta {
  const prev = store.get(id) ?? {};
  const next: ResourceMeta = { ...prev };
  if (patch.event !== undefined) {
    const e = patch.event.trim().slice(0, EVENT_MAX);
    if (e) next.event = e; else delete next.event;
  }
  if (patch.noPreview !== undefined) {
    if (patch.noPreview) next.noPreview = true; else delete next.noPreview;
  }
  if (patch.official !== undefined) {
    if (patch.official) next.official = true; else delete next.official;
  }
  if (patch.folderId !== undefined) {
    const f = patch.folderId ? patch.folderId.slice(0, 64) : "";
    if (f) next.folderId = f; else delete next.folderId;
  }
  store.set(id, next);
  persist();
  return next;
}

/** Drop a resource's metadata (call when it is deleted, to avoid orphans). */
export function deleteResourceMeta(id: string): void {
  if (store.delete(id)) persist();
}

/** Test-only: clear all resource metadata. */
export function __resetResourceMeta(): void {
  store.clear();
}

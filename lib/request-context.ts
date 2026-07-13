/**
 * Per-request identity, via AsyncLocalStorage. A route resolves the session
 * once (from the verified session cookie) and stashes it here; getViewer() reads
 * it, so deep synchronous access-control code sees the real authenticated member
 * without threading a viewer parameter through everything. enterWith() is safe:
 * it propagates to the request's continuations and stays isolated between
 * concurrent requests (verified). Server-only (node:async_hooks).
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { Identity } from "./identity-token";
import type { Viewer } from "./visibility";

export interface RequestSession {
  identity: Identity;
  viewer: Viewer;
}

const als = new AsyncLocalStorage<RequestSession>();

export function setRequestSession(s: RequestSession): void {
  als.enterWith(s);
}

export function getRequestSession(): RequestSession | undefined {
  return als.getStore();
}

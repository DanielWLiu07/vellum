/**
 * Boot gate for durable state. Importing this pulls in every store module so
 * their hydrators are registered, then re-exports ensureReady(). API routes
 * call `await ensureReady()` before touching any store, which loads each
 * store's snapshot exactly once per process.
 */

import "./assignments";
import "./audit";
import "./comments";
import "./decks";
import "./favorites";
import "./feedback";
import "./folders";
import "./moderation-queue";
import "./modules";
import "./profile";
import "./quiz-attempts";
import "./quizzes";
import "./resource-meta";
import "./resource-share";
// Missing this was a real bug, not a tidy-up. durable.ts short-circuits once
// __durHydrated is true, so a store whose hydrator registers later — when its
// route module first loads — never hydrates at all. Settings then read as
// defaults, and because the persist gate is a GLOBAL isHydrated() flag rather
// than a per-store one, the next write spread over those defaults and
// overwrote the saved values. An admin's change survived until the first cold
// start that happened to load another route first.
import "./settings";
import "./share-ban";
import "./study-activity";
import "./thumbnails";
import "./users";

import { warnIfEphemeralStorage } from "./storage";

// Blob storage has no snapshot to fail loudly, so a deployment with no object
// store silently loses every upload on its next cold start. Say so at boot.
warnIfEphemeralStorage();

export { ensureReady } from "./durable";

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
import "./share-ban";
import "./thumbnails";
import "./users";

export { ensureReady } from "./durable";

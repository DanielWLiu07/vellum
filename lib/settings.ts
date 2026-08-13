/**
 * Platform settings an admin can actually change.
 *
 * The Settings pane used to be three switches in component state: they moved,
 * nothing read them, and a refresh put them back. That is worse than having no
 * switches — it tells an admin they have turned something off when they
 * haven't. Same failure as the role dropdown that couldn't change a role.
 *
 * So only settings with a real enforcement point live here. "Enable General
 * skills", the third old toggle, is a build-time concern and is simply gone
 * rather than faked.
 *
 * DEFAULTS PRESERVE TODAY'S BEHAVIOUR. Turning a settings store on must not
 * quietly change how the platform works — `allowStudentUploads` starts true
 * because students can upload today, and `requireWatermark` starts false
 * because shares are currently un-watermarked unless asked for. An admin opts
 * into a change; the migration doesn't make one for them.
 */

import { persistMap } from "./durable";

export interface Settings {
  /** When false, students may not upload; teaching roles still can. */
  allowStudentUploads: boolean;
  /** When true, a share link always carries a watermark, even if none was given. */
  requireWatermark: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  allowStudentUploads: true,
  requireWatermark: false,
};

/** One row, keyed by a constant — persistMap gives durability for free. */
const KEY = "platform";
const g = globalThis as unknown as { __vitalsSettings?: Map<string, Settings> };
const store: Map<string, Settings> = (g.__vitalsSettings ??= new Map());
const { persist } = persistMap("settings", store);

export function getSettings(): Settings {
  // Spread over the defaults so a snapshot written before a new setting
  // existed doesn't come back with it undefined.
  return { ...DEFAULT_SETTINGS, ...(store.get(KEY) ?? {}) };
}

/** Apply a partial update. Unknown keys are ignored, not stored. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings() };
  if (typeof patch.allowStudentUploads === "boolean") {
    next.allowStudentUploads = patch.allowStudentUploads;
  }
  if (typeof patch.requireWatermark === "boolean") {
    next.requireWatermark = patch.requireWatermark;
  }
  store.set(KEY, next);
  persist();
  return next;
}

/**
 * Whether `role` may upload. Only students are ever restricted: a trainer,
 * advisor or admin uploading is the platform working, and a switch that could
 * lock out advisors would be a foot-gun rather than a control.
 */
export function canUpload(role: string): boolean {
  if (role !== "student") return true;
  return getSettings().allowStudentUploads;
}

/**
 * The watermark a share should carry. An explicit one always wins; the fallback
 * only applies when the setting demands one and the caller supplied nothing.
 * Identifying text is the entire point — an empty "watermark" is not one.
 */
export function resolveWatermark(requested: string, identity: string): string {
  const given = requested.trim();
  if (given) return given;
  if (!getSettings().requireWatermark) return "";
  return identity.trim() || "HOSA Vitals";
}

/** Test-only: forget stored settings. */
export function __resetSettings(): void {
  store.clear();
}

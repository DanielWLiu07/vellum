"use client";

import * as React from "react";

export type SaveStatus = "saved" | "saving" | "error";

/**
 * Google-Docs-style autosave. Watches `dirtyKey` (a string derived from the
 * edited content); when it changes, it debounces and calls `save()`. The very
 * first change after `enabled` turns true is ignored - that's the initial data
 * loading in, not a user edit. Returns a live status for the editor to show.
 */
export function useAutosave(
  save: () => Promise<boolean>,
  dirtyKey: string,
  { enabled, delay = 1200 }: { enabled: boolean; delay?: number },
): SaveStatus {
  const [status, setStatus] = React.useState<SaveStatus>("saved");
  const saveRef = React.useRef(save);
  React.useEffect(() => { saveRef.current = save; });
  const started = React.useRef(false);
  // True when a change is scheduled but not yet flushed - lets the unmount
  // handler flush a pending edit so navigating away within the debounce window
  // doesn't silently drop the last change.
  const dirty = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) return;
    // First run once enabled = the just-loaded content, not a user change.
    if (!started.current) {
      started.current = true;
      return;
    }
    setStatus("saving");
    dirty.current = true;
    const t = setTimeout(async () => {
      dirty.current = false; // this change is now being saved
      try {
        setStatus((await saveRef.current()) ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    }, delay);
    return () => clearTimeout(t);
  }, [dirtyKey, enabled, delay]);

  // Flush a pending (debounced-but-not-yet-sent) edit on unmount.
  React.useEffect(() => () => { if (dirty.current) void saveRef.current(); }, []);

  return status;
}

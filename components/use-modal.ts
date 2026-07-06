"use client";

// Modal behavior shared by the dashboard's dialogs and the share dialog.
// Extracted from dashboard.tsx so any component can host a proper dialog.

import { useEffect, useRef } from "react";

/** Close a modal/overlay when Escape is pressed. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

/**
 * Dialog focus management: Escape to close, Tab trapped within the modal,
 * first control focused on open, and focus restored to the trigger on close.
 * Returns a ref to attach to the modal's content element.
 */
export function useModal(onClose: () => void) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, []);
  return ref;
}

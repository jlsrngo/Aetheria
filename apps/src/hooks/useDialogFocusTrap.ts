import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab keyboard focus inside a modal container while open
 * and restores the previously focused element when closed.
 */
export function useDialogFocusTrap(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!isOpen) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (container) {
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !containerRef.current) return;
      const focusables = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === first || !containerRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !containerRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (prevFocused && typeof prevFocused.focus === "function") {
        prevFocused.focus();
      }
    };
  }, [isOpen, containerRef]);
}

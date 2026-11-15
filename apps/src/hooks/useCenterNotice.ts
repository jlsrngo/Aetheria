import { useSyncExternalStore } from "react";

export type CenterNoticeSeverity = "info" | "success" | "warning" | "error";

export interface CenterNoticePayload {
  id: string;
  severity: CenterNoticeSeverity;
  title: string;
  message: string;
  details?: string[];
  actionLabel?: string;
}

export interface CenterNoticeInput {
  severity: CenterNoticeSeverity;
  title: string;
  message: string;
  details?: string[];
  actionLabel?: string;
}

let activeNotice: CenterNoticePayload | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CenterNoticePayload | null {
  return activeNotice;
}

export const centerNoticeActions = {
  show(input: CenterNoticeInput): CenterNoticePayload {
    const payload: CenterNoticePayload = {
      id: `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      severity: input.severity,
      title: input.title,
      message: input.message,
      details: input.details?.filter((d) => d.trim().length > 0),
      actionLabel: input.actionLabel,
    };
    activeNotice = payload;
    emit();
    return payload;
  },

  dismiss(): void {
    if (!activeNotice) return;
    activeNotice = null;
    emit();
  },
};

export function useCenterNotice(): CenterNoticePayload | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

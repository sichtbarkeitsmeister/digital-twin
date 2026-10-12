"use client";

import { toast } from "sonner";

import type { HelpRecentError } from "@/lib/help/handbook";

const MAX_RECENT_ERRORS = 5;
const MAX_MESSAGE_CHARS = 300;

const recent: HelpRecentError[] = [];
let installed = false;

function messageOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  if (input && typeof input === "object" && "message" in input) {
    const m = (input as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** Remember a user-visible error so the help assistant can read it. */
export function recordHelpError(input: unknown): void {
  const message = messageOf(input).replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return;
  if (recent[0]?.message === message) return;
  recent.unshift({ at: new Date().toISOString(), message });
  if (recent.length > MAX_RECENT_ERRORS) recent.length = MAX_RECENT_ERRORS;
}

export function getRecentHelpErrors(): HelpRecentError[] {
  return [...recent];
}

/**
 * Capture error toasts and uncaught errors once per page load.
 * Only messages are kept, never stack traces or request bodies.
 */
export function installHelpErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = toast.error;
  const patched: typeof toast.error = (message, data) => {
    recordHelpError(typeof message === "function" ? "" : message);
    return original(message, data);
  };
  (toast as unknown as { error: typeof toast.error }).error = patched;

  window.addEventListener("error", (event) => {
    recordHelpError(event.message || event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordHelpError(event.reason);
  });
}

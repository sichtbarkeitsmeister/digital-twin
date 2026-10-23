/**
 * The human review of a draft (Standard v1.7: six points, documented). Pure.
 */

import { GROUNDING_REVIEW_CHECKLIST } from "@/lib/dt/prompts/grounding-page-standard";
import type { ReviewChecklist } from "@/lib/dt/seo/grounding-check/types";

export function checklistComplete(checklist: ReviewChecklist | null | undefined): boolean {
  return GROUNDING_REVIEW_CHECKLIST.every((item) => checklist?.[item.id] === true);
}

/** Only the six known points, as booleans. */
export function normalizeChecklist(raw: unknown): ReviewChecklist {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(GROUNDING_REVIEW_CHECKLIST.map((item) => [item.id, r[item.id] === true]));
}

/**
 * What a check concludes. Pure, so the rules are testable:
 * - no grounding page → create a draft;
 * - any substantive diff or v1.7 structure issue → update_required;
 * - nothing changed but the 3-month review is due (or overdue) → refresh_only: same page,
 *   new dates, still a human review;
 * - otherwise up_to_date.
 */

import type { GroundingPageStatus } from "@/lib/dt/seo/grounding-page-schedule";
import { type GroundingDiff, hasSubstantiveChanges } from "@/lib/dt/seo/grounding-check/diff";
import type { DtGroundingRunDecision } from "@/lib/dt/types";

export type GroundingDecision = {
  decision: DtGroundingRunDecision;
  /** German sentences for the run detail. */
  reasons: string[];
};

export function decideGroundingCheck(input: {
  pageExists: boolean;
  diff: GroundingDiff | null;
  scheduleStatus: GroundingPageStatus;
}): GroundingDecision {
  if (!input.pageExists) {
    return { decision: "create", reasons: ["Auf der Website wurde keine Grounding Page gefunden."] };
  }

  const reasons: string[] = [];
  const diff = input.diff;
  if (diff && hasSubstantiveChanges(diff)) {
    const { added, changed, removed } = diff.counts;
    const parts = [
      added ? `${added} neu` : null,
      changed ? `${changed} geändert` : null,
      removed ? `${removed} entfällt` : null,
    ].filter(Boolean);
    reasons.push(`Website und Grounding Page weichen ab (${parts.join(", ")}).`);
  }
  if (diff && diff.structural.length > 0) {
    reasons.push(
      `${diff.structural.length} ${diff.structural.length === 1 ? "Befund" : "Befunde"} zum Standard v1.7 (z. B. ${diff.structural[0]!.message.replace(/\.$/, "")}).`,
    );
  }
  if (reasons.length > 0) return { decision: "update_required", reasons };

  if (input.scheduleStatus === "overdue" || input.scheduleStatus === "due_soon" || input.scheduleStatus === "missing") {
    return {
      decision: "refresh_only",
      reasons: [
        input.scheduleStatus === "overdue"
          ? "Inhaltlich unverändert, aber die dreimonatige Prüfung ist überfällig."
          : input.scheduleStatus === "due_soon"
            ? "Inhaltlich unverändert, die dreimonatige Prüfung ist bald fällig."
            : "Inhaltlich unverändert, aber es ist kein Prüfdatum bekannt.",
        "Der Entwurf aktualisiert nur dateModified, „Stand“-Angaben und nach der Freigabe lastReviewed.",
      ],
    };
  }
  return { decision: "up_to_date", reasons: ["Website und Grounding Page stimmen überein; die Prüfung ist nicht fällig."] };
}

export const GROUNDING_DECISION_LABELS: Record<DtGroundingRunDecision, string> = {
  create: "Keine Grounding Page",
  update_required: "Aktualisierung empfohlen",
  refresh_only: "Nur Daten auffrischen",
  up_to_date: "Aktuell",
};

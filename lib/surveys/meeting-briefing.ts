/**
 * Prefills aus Kundengespräch / Meeting-Briefing (ohne server-only).
 * Meeting schlägt Crawl/KI — der Kunde soll das später nicht nochmal tippen.
 */

import type { CoreQuestionPrefillHint } from "@/lib/surveys/core-question-templates";
import type { PrefillDraft } from "@/lib/surveys/org-crawl-prefill";

export type MeetingBriefing = {
  /** Offizieller Firmenname aus dem Gespräch (falls abweichend von Org-Name). */
  legalCompanyName?: string | null;
  /** Inhaber / GF / Ansprechpartner. */
  ownerName?: string | null;
  /** Mitbewerber (Namen, Domains, Notizen). */
  competitors?: string | null;
  /** Gute Wettbewerber / Vorbilder. */
  goodCompetitors?: string | null;
  /** Genannte Seiten, URLs, Landingpages aus dem Gespräch. */
  pagesOrLinks?: string | null;
  /** Weitere Notizen (Fokus, USP, Region, …) — fließen in KI + ggf. Heuristik. */
  notes?: string | null;
  focus?: string | null;
  services?: string | null;
  usp?: string | null;
  region?: string | null;
  targetGroup?: string | null;
  employeeCount?: string | null;
  website?: string | null;
};

const MEETING_NOTE = "Aus Kundengespräch übernommen";

function trimOrNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : null;
}

/** Map structured meeting fields → core prefill keys. */
export function suggestPrefillsFromMeeting(input: {
  briefing: MeetingBriefing;
  hints: Array<{ key: string; hint?: CoreQuestionPrefillHint }>;
}): Record<string, PrefillDraft> {
  const b = input.briefing;
  const byHint: Partial<Record<CoreQuestionPrefillHint, string>> = {};

  const legal = trimOrNull(b.legalCompanyName);
  if (legal) byHint.org_name = legal;

  const website = trimOrNull(b.website);
  if (website) byHint.website = website;

  const owner = trimOrNull(b.ownerName);
  if (owner) byHint.owner_name = owner;

  const employees = trimOrNull(b.employeeCount);
  if (employees) byHint.employee_count = employees;

  const focus = trimOrNull(b.focus);
  if (focus) byHint.focus = focus;

  const services = trimOrNull(b.services);
  if (services) byHint.services = services;

  const usp = trimOrNull(b.usp);
  if (usp) byHint.usp = usp;

  const region = trimOrNull(b.region);
  if (region) byHint.region = region;

  const target = trimOrNull(b.targetGroup);
  if (target) byHint.target_group = target;

  const competitors = trimOrNull(b.competitors);
  if (competitors) byHint.competitors = competitors;

  const good = trimOrNull(b.goodCompetitors);
  if (good) byHint.good_competitors = good;

  const out: Record<string, PrefillDraft> = {};
  for (const item of input.hints) {
    if (!item.hint) continue;
    const value = byHint[item.hint];
    if (!value) continue;
    out[item.key] = {
      value: value.slice(0, 2000),
      source: "meeting",
      note: MEETING_NOTE,
    };
  }
  return out;
}

/** Freitext für KI/Heuristik: Notizen + Seiten/Links. */
export function meetingBriefingContextText(briefing: MeetingBriefing | null | undefined): string {
  if (!briefing) return "";
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const t = trimOrNull(value);
    if (t) parts.push(`${label}:\n${t}`);
  };
  push("Offizielle Firmenname", briefing.legalCompanyName);
  push("Inhaber / Ansprechpartner", briefing.ownerName);
  push("Mitbewerber", briefing.competitors);
  push("Gute Wettbewerber / Vorbilder", briefing.goodCompetitors);
  push("Genannte Seiten / Links", briefing.pagesOrLinks);
  push("Fokus", briefing.focus);
  push("Leistungen", briefing.services);
  push("USP", briefing.usp);
  push("Region", briefing.region);
  push("Zielgruppe", briefing.targetGroup);
  push("Mitarbeiterzahl", briefing.employeeCount);
  push("Website", briefing.website);
  push("Weitere Gesprächsnotizen", briefing.notes);
  return parts.join("\n\n");
}

export function meetingBriefingHasContent(briefing: MeetingBriefing | null | undefined): boolean {
  return meetingBriefingContextText(briefing).trim().length > 0;
}

/**
 * Prefills aus Kundengespräch / Meeting-Briefing (ohne server-only).
 * Meeting schlägt Crawl/KI — der Kunde soll das später nicht nochmal tippen.
 *
 * Freitext-Notizen mit Labels (Region:, USP:, …) werden auf Kernfragen
 * bzw. eigene Zusatzfragen aufgeteilt — nicht als ein Haufen belassen.
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
  /** Weitere Notizen (Fokus, USP, Region, …) — werden geparst und verteilt. */
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

export type MeetingExtraDraft = {
  id: string;
  title: string;
  description: string;
  answer: string;
};

export type ParsedMeetingBriefing = {
  byHint: Partial<Record<CoreQuestionPrefillHint, string>>;
  extras: MeetingExtraDraft[];
  pagesOrLinks: string | null;
  leftoverNotes: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : null;
}

function slugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "extra"
  );
}

type LabelRule = {
  match: RegExp;
  hint?: CoreQuestionPrefillHint;
  /** When no core hint — create this Zusatzfrage. */
  extraTitle?: string;
  extraId?: string;
};

/** Known labels from Erstgespräch notes (order = priority for overlapping names). */
const LABEL_RULES: LabelRule[] = [
  {
    match: /^(?:fokus[\s_-]?keywords?|fokus[\s_-]?key[\s_-]?words?|keywords?|seo[\s_-]?keywords?)$/i,
    extraTitle: "Welche Fokus-Keywords sind relevant?",
    extraId: "extra_meeting_focus_keywords",
  },
  {
    match: /^(?:gute\s+wettbewerber|vorbilder|benchmarks?)$/i,
    hint: "good_competitors",
  },
  {
    match: /^(?:mitbewerber|wettbewerber|konkurrenz|konkurrenten)$/i,
    hint: "competitors",
  },
  {
    match: /^(?:usp|alleinstellung|differenzierung|unterscheidung)$/i,
    hint: "usp",
  },
  {
    match: /^(?:region|regionen|einzugsgebiet|standort|marktgebiet|einsatzgebiet)$/i,
    hint: "region",
  },
  {
    match: /^(?:zielgruppe|zielgruppen|target\s*group|kundengruppe)$/i,
    hint: "target_group",
  },
  {
    match: /^(?:fokus|schwerpunkt|positionierung|kernleistung)$/i,
    hint: "focus",
  },
  {
    match: /^(?:leistungen|services|angebot|angebote|produkte)$/i,
    hint: "services",
  },
  {
    match: /^(?:mitarbeiter(?:zahl|innen)?|teamgr(?:ö|oe)sse|beschäftigte|personen)$/i,
    hint: "employee_count",
  },
  {
    match: /^(?:inhaber(?:in)?|geschäftsführer(?:in)?|ansprechpartner(?:in)?|gründer(?:in)?)$/i,
    hint: "owner_name",
  },
  {
    match: /^(?:firmenname|unternehmensname|offizieller\s+name|name\s+der\s+firma)$/i,
    hint: "org_name",
  },
  {
    match: /^(?:website|webseite|homepage|domain)$/i,
    hint: "website",
  },
  {
    match: /^(?:alltagsname|kurzname|spitzname)$/i,
    extraTitle: "Wie wird die Firma im Alltag genannt?",
    extraId: "extra_meeting_colloquial",
  },
  {
    match: /^(?:branche|gewerbe)$/i,
    extraTitle: "In welcher Branche ist die Firma unterwegs?",
    extraId: "extra_meeting_industry",
  },
  {
    match: /^(?:online[\s_-]?kan(?:ä|ae)le|kan(?:ä|ae)le\s+heute)$/i,
    extraTitle: "Welche Online-Kanäle werden aktuell genutzt?",
    extraId: "extra_meeting_online_channels",
  },
  {
    match: /^(?:wunschkunde|avatar)$/i,
    extraTitle: "Wie heißt oder beschreibt sich der Wunschkunde?",
    extraId: "extra_meeting_wunschkunde",
  },
  {
    match: /^(?:ziel\s+des\s+mandats|mandat|auftrag)$/i,
    extraTitle: "Was soll durch die Zusammenarbeit besser werden?",
    extraId: "extra_meeting_mandate",
  },
  {
    match: /^(?:rolle\s+gespr(?:ä|ae)chspartner|rolle)$/i,
    extraTitle: "Welche Rolle hat die Person im Erstgespräch?",
    extraId: "extra_meeting_owner_role",
  },
  {
    match: /^(?:seiten|links|landingpages?|urls?|genannte\s+seiten)$/i,
    extraTitle: "Welche Seiten, Landingpages oder Links wurden im Kundengespräch genannt?",
    extraId: "extra_meeting_pages_links",
  },
];

function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function findLabelRule(label: string): LabelRule | null {
  const n = normalizeLabel(label);
  for (const rule of LABEL_RULES) {
    if (rule.match.test(n)) return rule;
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Split free text into labeled blocks.
 * Supports:
 *   Region: Hamm …
 *   USP: …
 *   Fokuskeywords: …
 * and multi-line values until the next Label: line.
 */
export function extractLabeledSections(
  text: string,
): Array<{ label: string; value: string }> {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  const sections: Array<{ label: string; value: string }> = [];
  let current: { label: string; value: string } | null = null;

  const labelLine = /^([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9\s/_-]{0,60}?)\s*:\s*(.*)$/;

  for (const line of lines) {
    const m = line.match(labelLine);
    if (m) {
      const label = normalizeLabel(m[1] ?? "");
      const rest = (m[2] ?? "").trim();
      // Avoid treating URLs as labels (https:)
      if (/^https?$/i.test(label)) {
        if (current) current.value = `${current.value}\n${line}`.trim();
        else sections.push({ label: "_raw", value: line.trim() });
        continue;
      }
      if (current) sections.push(current);
      current = { label, value: rest };
      continue;
    }
    if (current) {
      current.value = current.value ? `${current.value}\n${line}` : line;
    } else if (line.trim()) {
      sections.push({ label: "_raw", value: line.trim() });
    }
  }
  if (current) sections.push(current);

  return sections
    .map((s) => ({ label: s.label, value: s.value.replace(/\s+\n/g, "\n").trim() }))
    .filter((s) => s.value.length > 0);
}

function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  const out: string[] = [];
  for (const u of found) {
    const clean = u.replace(/[.,;:!?)]+$/g, "");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function mergeHint(
  into: Partial<Record<CoreQuestionPrefillHint, string>>,
  hint: CoreQuestionPrefillHint,
  value: string,
) {
  const next = value.trim();
  if (!next) return;
  const prev = into[hint]?.trim();
  if (!prev) {
    into[hint] = next.slice(0, 2000);
    return;
  }
  if (prev.includes(next) || next.includes(prev)) {
    into[hint] = (prev.length >= next.length ? prev : next).slice(0, 2000);
    return;
  }
  into[hint] = `${prev}\n${next}`.slice(0, 2000);
}

function pushExtra(
  extras: MeetingExtraDraft[],
  draft: MeetingExtraDraft,
) {
  const existing = extras.find((e) => e.id === draft.id);
  if (existing) {
    if (!existing.answer.includes(draft.answer)) {
      existing.answer = `${existing.answer}\n${draft.answer}`.slice(0, 2000);
    }
    return;
  }
  extras.push({ ...draft, answer: draft.answer.slice(0, 2000) });
}

/**
 * Parse notes + pagesOrLinks into core hints, dedicated extras, clean links, leftover.
 */
export function parseMeetingBriefingContent(
  briefing: MeetingBriefing,
): ParsedMeetingBriefing {
  const byHint: Partial<Record<CoreQuestionPrefillHint, string>> = {};
  const extras: MeetingExtraDraft[] = [];
  const urlBucket: string[] = [];
  const leftoverParts: string[] = [];

  const applySections = (sections: Array<{ label: string; value: string }>) => {
    for (const section of sections) {
      if (section.label === "_raw") {
        const urls = extractUrls(section.value);
        for (const u of urls) {
          if (!urlBucket.includes(u)) urlBucket.push(u);
        }
        let rest = section.value;
        for (const u of urls) rest = rest.replace(u, " ");
        rest = rest.replace(/\s+/g, " ").trim();
        // Loose Zielgruppe mention without label
        const zg = rest.match(
          /(?:das hier ist )?(?:deren\s+)?zielgruppe\b[:\s,]*([\s\S]+)/i,
        );
        if (zg?.[1]) {
          mergeHint(byHint, "target_group", zg[1].trim());
          rest = rest.replace(zg[0], " ").replace(/\s+/g, " ").trim();
        } else if (/für die wir den frageb/i.test(rest)) {
          mergeHint(byHint, "target_group", rest);
          rest = "";
        }
        if (rest.length >= 8) leftoverParts.push(rest);
        continue;
      }

      const rule = findLabelRule(section.label);
      if (rule?.hint) {
        mergeHint(byHint, rule.hint, section.value);
        continue;
      }
      if (rule?.extraTitle && rule.extraId) {
        if (rule.extraId === "extra_meeting_pages_links") {
          const urls = extractUrls(section.value);
          if (urls.length) {
            for (const u of urls) if (!urlBucket.includes(u)) urlBucket.push(u);
          } else {
            pushExtra(extras, {
              id: rule.extraId,
              title: rule.extraTitle,
              description: "Direkt aus dem Meeting — prüfen und bei Bedarf kürzen.",
              answer: section.value,
            });
          }
          continue;
        }
        pushExtra(extras, {
          id: rule.extraId,
          title: rule.extraTitle,
          description: "Aus Kundengespräch übernommen — eigene Zusatzfrage.",
          answer: section.value,
        });
        continue;
      }

      // Unknown label → dedicated Zusatzfrage with that label
      pushExtra(extras, {
        id: `extra_meeting_${slugify(section.label)}`,
        title: `${section.label.trim()}?`,
        description: "Aus beschrifteter Meeting-Notiz erzeugt.",
        answer: section.value,
      });
    }
  };

  const notesText = trimOrNull(briefing.notes) ?? "";
  const pagesText = trimOrNull(briefing.pagesOrLinks) ?? "";

  if (notesText) applySections(extractLabeledSections(notesText));
  if (pagesText) applySections(extractLabeledSections(pagesText));

  // Explicit structured fields win / fill gaps
  const explicit: Array<[CoreQuestionPrefillHint, string | null | undefined]> = [
    ["org_name", briefing.legalCompanyName],
    ["website", briefing.website],
    ["owner_name", briefing.ownerName],
    ["employee_count", briefing.employeeCount],
    ["focus", briefing.focus],
    ["services", briefing.services],
    ["usp", briefing.usp],
    ["region", briefing.region],
    ["target_group", briefing.targetGroup],
    ["competitors", briefing.competitors],
    ["good_competitors", briefing.goodCompetitors],
  ];
  for (const [hint, value] of explicit) {
    const t = trimOrNull(value);
    if (t) byHint[hint] = t.slice(0, 2000); // explicit overrides parsed
  }

  // URLs from explicit pages field if no labels were used
  if (pagesText && !extractLabeledSections(pagesText).some((s) => s.label !== "_raw")) {
    for (const u of extractUrls(pagesText)) {
      if (!urlBucket.includes(u)) urlBucket.push(u);
    }
    // If pages field had only URLs + stray text already handled via _raw
  }

  const pagesOrLinks = urlBucket.length > 0 ? urlBucket.join("\n") : null;
  if (pagesOrLinks) {
    pushExtra(extras, {
      id: "extra_meeting_pages_links",
      title: "Welche Seiten, Landingpages oder Links wurden im Kundengespräch genannt?",
      description: "Direkt aus dem Meeting — prüfen und bei Bedarf kürzen.",
      answer: pagesOrLinks,
    });
  }

  const leftoverNotes = leftoverParts.length
    ? leftoverParts.join("\n").trim().slice(0, 2000)
    : null;

  return { byHint, extras, pagesOrLinks, leftoverNotes };
}

/** Map structured meeting fields (+ parsed notes) → core prefill keys. */
export function suggestPrefillsFromMeeting(input: {
  briefing: MeetingBriefing;
  hints: Array<{ key: string; hint?: CoreQuestionPrefillHint }>;
}): Record<string, PrefillDraft> {
  const parsed = parseMeetingBriefingContent(input.briefing);
  const out: Record<string, PrefillDraft> = {};
  for (const item of input.hints) {
    if (!item.hint) continue;
    const value = parsed.byHint[item.hint];
    if (!value) continue;
    out[item.key] = {
      value: value.slice(0, 2000),
      source: "meeting",
      note: MEETING_NOTE,
    };
  }
  return out;
}

/** Zusatzfragen from parsed meeting (keywords, links, unknown labels, leftover). */
export function buildMeetingExtraQuestions(
  briefing: MeetingBriefing | null | undefined,
): MeetingExtraDraft[] {
  if (!briefing) return [];
  const parsed = parseMeetingBriefingContent(briefing);
  const extras = [...parsed.extras];
  if (parsed.leftoverNotes) {
    pushExtra(extras, {
      id: "extra_meeting_notes",
      title: "Weitere relevante Punkte aus dem Kundengespräch",
      description: "Restnotiz, die keinem Label zugeordnet wurde — prüfen oder verteilen.",
      answer: parsed.leftoverNotes,
    });
  }
  return extras;
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

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
  alsoHint?: CoreQuestionPrefillHint;
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
    match: /^(?:region|regionen|einzugsgebiet|standort|marktgebiet|einsatzgebiet|praxissitz|firmensitz)$/i,
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
    match: /^(?:leistungen|services|angebot|angebote|produkte|leistungsgebiete)$/i,
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
    match: /^(?:firmenname|unternehmensname|offizieller\s+name|name\s+der\s+firma|praxisname)$/i,
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
    match: /^(?:online[\s_-]?kan(?:ä|ae)le|kan(?:ä|ae)le\s+heute|buchungsweg)$/i,
    hint: "online_channels",
    alsoHint: "typical_process",
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
  const lower = n.toLowerCase();
  if (/standort|praxissitz|firmensitz|einzugsgebiet/.test(lower)) {
    return { match: /./, hint: "region" };
  }
  if (/buchungsweg|doctolib|terminbuch/.test(lower)) {
    return { match: /./, hint: "online_channels", alsoHint: "typical_process" };
  }
  if (/unattraktiv|nicht zusammengearbeitet|passt nicht/.test(lower)) {
    return { match: /./, hint: "no_fit" };
  }
  if (/am liebsten|wunschkunden-typen|wunschpatient|patientengruppen/.test(lower)) {
    return { match: /./, hint: "target_group" };
  }
  if (/wachsen|zwei bis drei jahren|zukunft/.test(lower)) {
    return { match: /./, hint: "three_year_goal" };
  }
  if (/ansprechpartner/.test(lower)) {
    return { match: /./, hint: "owner_name" };
  }
  if (/schulungszentrum|alleinstell|was uns unterscheidet/.test(lower)) {
    return { match: /./, hint: "usp" };
  }
  if (/nächste schritte|website-korrektur|marketing/.test(lower)) {
    return { match: /./, hint: "marketing_plan" };
  }
  if (/team|kosmetikerin/.test(lower) && /gehört|mitarbeit/.test(lower)) {
    return { match: /./, hint: "team_members" };
  }
  return null;
}

function skipNoiseLabel(label: string): boolean {
  const n = normalizeLabel(label);
  return /(?:legende|kickoff|zusammenfassung|diezusammenfassung|block\s*\d|nächste schritte|sonstige offene|menüstruktur|ergebnis aus dem meeting|material wird nachgeliefert|ausschlussfrage|kurzer kontext)/i.test(
    n,
  );
}

const SERVICE_CATEGORY_LABEL =
  /^(?:medizinische\s+dermatologie|ästhetische\s+(?:medizin|dermatologie)|laserbehandlungen?|kinderdermatologie)$/i;

function personNameFromText(value: string): string | null {
  const m = value.match(/\b(Dr\.\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)\b/);
  return m?.[1] ?? null;
}

function channelLabelsFromText(value: string): string {
  const parts: string[] = [];
  const add = (label: string) => {
    if (!parts.some((p) => p.toLowerCase() === label.toLowerCase())) parts.push(label);
  };
  if (/doctolib/i.test(value)) add("Doctolib");
  if (/telefon/i.test(value)) add("Telefon");
  if (/e-?mail/i.test(value)) add("E-Mail");
  if (/whatsapp/i.test(value)) add("WhatsApp");
  if (/instagram/i.test(value)) add("Instagram");
  if (/facebook/i.test(value)) add("Facebook");
  if (/website|homepage/i.test(value)) add("eigene Website");
  return parts.join("\n");
}

/** Drop meeting chrome, mid-word leftovers and leaked next-section titles. */
export function cleanMeetingValue(raw: string): string {
  let t = raw
    .replace(/[✅💬🔍]/g, " ")
    .replace(/\bBlock\s+\d+\b[\s\S]*$/gim, "")
    .replace(
      /\b(?:Nächste Schritte|Wunschkunden-Definition|Ergebnis aus dem Meeting|Menüstruktur-Feedback|Konkrete Änderungen)\b[\s\S]*$/i,
      "",
    )
    .replace(/\bggf\.\s+im Fragebogen[\s\S]*$/i, "")
    .replace(/^Kurzer Kontext zur Praxis\s*(?:\([^)]*\))?\s*/i, "")
    .replace(/^(?:Wie|Was|Wo|Wer|Welche|Welcher|Welches|Wann|Warum)\b[^?]{0,80}\?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^[^A-ZÄÖÜa-zäöüß0-9„"]+/, "");
  t = t.replace(/^[a-zäöüß]{4,}\b\s+/, "");
  t = t.replace(/^[a-zäöüß]{3,}\)\s*/, "");
  return t.trim();
}

function isAbbreviationDot(blob: string, dotIndex: number): boolean {
  const before = blob.slice(Math.max(0, dotIndex - 16), dotIndex + 1);
  return /\b(?:Dr|ca|inkl|bzw|ggf|Nr|Abs|usw|etc|bzw)\.$/i.test(before) || /\b(?:z\.\s*B|u\.\s*a)\.$/i.test(before);
}

function lastBoundary(before: string): number {
  const marks = [before.lastIndexOf("•"), before.lastIndexOf("\n"), before.lastIndexOf("? ")];
  let lastDot = before.lastIndexOf(". ");
  while (lastDot >= 0 && isAbbreviationDot(before, lastDot)) {
    lastDot = before.lastIndexOf(". ", lastDot - 1);
  }
  marks.push(lastDot);
  return Math.max(...marks);
}

function sliceAround(blob: string, pattern: RegExp, radius = 220): string | null {
  const m = blob.match(pattern);
  if (!m || m.index == null) return null;
  const before = blob.slice(0, m.index);
  const bullet = lastBoundary(before);
  const start =
    bullet >= 0 ? bullet + (before.slice(bullet).startsWith(". ") || before.slice(bullet).startsWith("? ") ? 2 : 1) : Math.max(0, m.index);
  let end = m.index + m[0].length;
  const limit = Math.min(blob.length, end + radius + 160);
  while (end < limit) {
    const ch = blob[end];
    if ((ch === "." || ch === "!" || ch === "?") && (end + 1 >= blob.length || /\s/.test(blob[end + 1] ?? " "))) {
      if (ch === "." && isAbbreviationDot(blob, end)) {
        end += 1;
        continue;
      }
      end += 1;
      break;
    }
    if (ch === "•" || ch === "\n") break;
    end += 1;
  }
  return cleanMeetingValue(blob.slice(start, end).replace(/\s+/g, " "));
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  const out: string[] = [];
  for (const u of found) {
    const clean = u.replace(/[.,;:!?)]+$/g, "");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(/^\s+/, "")
    .replace(/^(?:[-*•]+|\d+[.)])\s+/, "")
    .replace(/^[✅💬🔍]\s+/, "")
    .replace(/^~~(.+?)~~\s*[–—-]\s*/, "$1 — ")
    .trim();
}

function matchHeading(line: string): { label: string; rest: string } | null {
  const t = stripBulletPrefix(line);
  if (!t) return null;
  const labeled = t.match(
    /^([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9\s/_()-]{0,70}?)\s*:\s*(.*)$/,
  );
  const label = labeled?.[1] ? normalizeLabel(labeled[1]) : "";
  if (label && !/^https?$/i.test(label) && !/[.?!]/.test(label) && label.length <= 70) {
    return { label, rest: (labeled?.[2] ?? "").trim() };
  }
  if (/^(?:wie|was|wo|wer|welche|welcher|welches|wann|warum)\b.{8,80}\?\s*$/i.test(t)) {
    return { label: t.replace(/\?\s*$/, "").trim(), rest: "" };
  }
  return null;
}

/**
 * Split free text into labeled blocks.
 * Supports:
 *   Region: Hamm …
 *   USP: …
 *   Fokuskeywords: …
 *   • ✅ Standort:
 *   • ✅ Welche Patienten sind ihr am liebsten?
 * and multi-line values until the next heading.
 */
export function extractLabeledSections(
  text: string,
): Array<{ label: string; value: string }> {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  const sections: Array<{ label: string; value: string }> = [];
  let current: { label: string; value: string } | null = null;

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      if (current) sections.push(current);
      current = { label: heading.label, value: heading.rest };
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

/** High-confidence facts from Kickoff-style prose, only filling empty hints. */
function applyNarrativeFacts(
  blob: string,
  byHint: Partial<Record<CoreQuestionPrefillHint, string>>,
) {
  const text = blob.replace(/\s+/g, " ").trim();
  if (text.length < 40) return;

  if (!byHint.region) {
    const m =
      text.match(/\b(?:ein\s+Standort|Sitz)\s+in\s+([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ-]{2,})/i) ||
      text.match(/\bStandort:\s*([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ-]{2,})/i);
    if (m?.[1]) mergeHint(byHint, "region", `Sitz in ${m[1]}, ein Standort.`);
  }

  if (!byHint.org_name) {
    const m = text.match(/umbenannt in\s+[„"]([^"“]{4,80})["“]/i);
    if (m?.[1]) mergeHint(byHint, "org_name", m[1].trim());
  }

  if (!byHint.colloquial_name) {
    const m = text.match(/steht dort weiterhin\s+[„"]([^"“]{4,80})["“]/i);
    if (m?.[1]) mergeHint(byHint, "colloquial_name", m[1].trim());
  }

  if (!byHint.online_channels && /doctolib/i.test(text)) {
    const parts = ["Doctolib"];
    if (/telefon/i.test(text)) parts.push("Telefon");
    if (/website|homepage/i.test(text)) parts.push("eigene Website");
    mergeHint(byHint, "online_channels", parts.join("\n"));
  }

  if (!byHint.typical_process && /doctolib|telefonisch gebucht/i.test(text)) {
    const slice = sliceAround(blob, /termine werden online über doctolib|doctolib oder telefonisch/i, 240);
    if (slice) mergeHint(byHint, "typical_process", slice);
  }

  if (!byHint.usp) {
    const slice = sliceAround(
      blob,
      /schulungszentrum|internationale expertin|bildet selbst fort/i,
      200,
    );
    if (slice) mergeHint(byHint, "usp", slice);
  }

  if (!byHint.qualifications && /schulungszentrum|fotona/i.test(text)) {
    const slice = sliceAround(blob, /fotona|schulungszentrum/i, 180);
    if (slice) mergeHint(byHint, "qualifications", slice);
  }

  if (!byHint.no_fit) {
    const bits: string[] = [];
    if (/keine[n]?\s+gesetzlich(?:en)?\s+versicherten/i.test(text)) {
      bits.push("Keine Behandlung gesetzlich Versicherter in diesem Sinne.");
    }
    const unattr = text.match(/selbstzahler[^.]{10,220}/i);
    if (unattr) bits.push(unattr[0].trim());
    if (bits.length) mergeHint(byHint, "no_fit", bits.join(" "));
  }

  if (!byHint.target_group) {
    const types = text.match(/zwei wunschkunden-typen[\s\S]{0,700}/i);
    if (types?.[0]) {
      mergeHint(byHint, "target_group", types[0].replace(/\s+/g, " ").slice(0, 900));
    }
  }

  if (!byHint.three_year_goal) {
    const slice = sliceAround(blob, /laser-behandlungen und ["„]?größere["“]? eingriffe|wo möchte sie wachsen/i, 200);
    if (slice) mergeHint(byHint, "three_year_goal", slice);
  }

  if (!byHint.why_stay) {
    const slice = sliceAround(blob, /privatpatienten, die regelmäßig|hautkrebsvorsorge als anlass/i, 220);
    if (slice) mergeHint(byHint, "why_stay", slice);
  }

  if (!byHint.team_members) {
    const people: string[] = [];
    const contact = text.match(/ansprechpartner(?:in)?[:\s]+(dr\.\s+[A-ZÄÖÜ][a-zäöüß]+)/i);
    if (contact?.[1]) people.push(`${contact[1]}, Inhaberin`);
    if (/kosmetikerin/i.test(text)) {
      people.push("Kosmetikerin in der Praxis (Leistungsangebot per Flyer, fehlt noch auf der Website)");
    }
    if (people.length) mergeHint(byHint, "team_members", people.join("\n"));
  }

  if (!byHint.owner_name) {
    const contact = text.match(/ansprechpartner(?:in)?[:\s]+(dr\.\s+[A-ZÄÖÜ][a-zäöüß]+)/i);
    if (contact?.[1]) mergeHint(byHint, "owner_name", contact[1]);
  }

  if (!byHint.owner_role && /ansprechpartnerin:\s*dr\./i.test(text)) {
    mergeHint(byHint, "owner_role", "Inhaberin / Ärztin, direkte Ansprechpartnerin");
  }

  if (!byHint.anything_else) {
    const todos: string[] = [];
    if (/polynukleotid|lachssperma/i.test(text)) {
      todos.push("Neuer Text zu Polynukleotiden unter ästhetischer Dermatologie.");
    }
    if (/kosmetikerin/i.test(text) && /flyer/i.test(text)) {
      todos.push("Kosmetikerin fehlt auf der Website; Flyer kommt.");
    }
    if (/kassen/i.test(text) && /hautkrebs/i.test(text)) {
      todos.push("Missverständlichen Kassen-Text zur Hautkrebsvorsorge von der Website nehmen.");
    }
    if (/umbenannt in/i.test(text) && /website/i.test(text)) {
      todos.push("Neuen Praxisnamen auf der Website sichtbar machen.");
    }
    if (todos.length) mergeHint(byHint, "anything_else", todos.join("\n"));
  }

  if (!byHint.marketing_plan) {
    const slice = sliceAround(blob, /website-korrekturen einplanen|nächste schritte/i, 280);
    if (slice) mergeHint(byHint, "marketing_plan", slice);
  }

  if (!byHint.company_history) {
    const slice = sliceAround(blob, /umbenannt in/i, 280);
    if (slice) mergeHint(byHint, "company_history", slice);
  }
}

export function mergeSourceTextIntoBriefing(
  briefing: MeetingBriefing | null | undefined,
  documentText: string | null | undefined,
): MeetingBriefing {
  const base = briefing ?? {};
  const extra = (documentText ?? "").trim();
  if (!extra) return base;
  const existing = (base.notes ?? "").trim();
  if (existing && existing.includes(extra.slice(0, 80))) return base;
  return {
    ...base,
    notes: [existing, extra].filter(Boolean).join("\n\n"),
  };
}

function mergeHint(
  into: Partial<Record<CoreQuestionPrefillHint, string>>,
  hint: CoreQuestionPrefillHint,
  value: string,
) {
  const next = cleanMeetingValue(value);
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
        if (rest.length >= 40 && !/beantwortet im meeting|kurzer kontext/i.test(rest)) {
          leftoverParts.push(rest);
        }
        continue;
      }

      if (skipNoiseLabel(section.label)) {
        continue;
      }
      if (SERVICE_CATEGORY_LABEL.test(normalizeLabel(section.label))) {
        mergeHint(byHint, "services", section.value);
        continue;
      }
      const rule = findLabelRule(section.label);
      if (rule?.hint === "online_channels") {
        const channels = channelLabelsFromText(section.value);
        if (channels) mergeHint(byHint, "online_channels", channels);
        if (rule.alsoHint) mergeHint(byHint, rule.alsoHint, cleanMeetingValue(section.value));
        continue;
      }
      if (rule?.hint) {
        mergeHint(byHint, rule.hint, section.value);
        if (rule.alsoHint) mergeHint(byHint, rule.alsoHint, section.value);
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

      // Unknown label → Zusatzfrage only when it is a real question, not meeting chrome.
      if (section.label.length > 80 || skipNoiseLabel(section.label)) continue;
      pushExtra(extras, {
        id: `extra_meeting_${slugify(section.label)}`,
        title: `${section.label.trim()}?`,
        description: "Aus beschrifteter Meeting-Notiz erzeugt.",
        answer: cleanMeetingValue(section.value),
      });
    }
  };

  const notesText = trimOrNull(briefing.notes) ?? "";
  const pagesText = trimOrNull(briefing.pagesOrLinks) ?? "";

  if (notesText) applySections(extractLabeledSections(notesText));
  if (pagesText) applySections(extractLabeledSections(pagesText));
  if (notesText) applyNarrativeFacts(notesText, byHint);
  if (pagesText) applyNarrativeFacts(pagesText, byHint);

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
    if (t) byHint[hint] = cleanMeetingValue(t).slice(0, 2000) || t.slice(0, 2000);
  }

  if (byHint.owner_name) {
    const name = personNameFromText(byHint.owner_name);
    if (name) byHint.owner_name = name;
  }
  if (byHint.online_channels && /termine werden|rezeption|sprachassistent/i.test(byHint.online_channels)) {
    const channels = channelLabelsFromText(byHint.online_channels);
    if (channels) byHint.online_channels = channels;
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
  const leftover = parsed.leftoverNotes ? cleanMeetingValue(parsed.leftoverNotes) : "";
  if (
    leftover.length >= 80 &&
    !/beantwortet im meeting/i.test(leftover) &&
    !/^wunschpatienten\b/i.test(leftover)
  ) {
    pushExtra(extras, {
      id: "extra_meeting_notes",
      title: "Weitere relevante Punkte aus dem Kundengespräch",
      description: "Restnotiz, die keinem Label zugeordnet wurde — prüfen oder verteilen.",
      answer: leftover,
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

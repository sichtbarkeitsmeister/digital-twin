/**
 * Heuristische Prefills aus Org-/Crawl-Kontext (ohne DB / server-only).
 * Testbar mit: npx tsx scripts/test-org-crawl-prefill.ts
 */

import type { CoreQuestionPrefillHint } from "@/lib/surveys/core-question-templates";

export type OrgCrawlContext = {
  organisationId: string;
  organisationName: string;
  websiteUrl: string | null;
  pageCount: number;
  snippets: Array<{ url: string; title: string | null; snippet: string }>;
  /** Longer crawl excerpts for extraction (not only short snippets). */
  pageExcerpts: Array<{ url: string; title: string | null; text: string }>;
  summaryText: string;
};

export type PrefillSource = "organisation" | "website" | "crawl" | "ai" | "meeting";

export type PrefillDraft = {
  value: string;
  source: PrefillSource;
  note: string;
};

function fullCrawlBlob(context: OrgCrawlContext): string {
  return [
    context.summaryText,
    ...context.pageExcerpts.map((p) => p.text),
    ...context.snippets.map((s) => s.snippet),
  ].join("\n");
}

function firstSentenceAround(
  blob: string,
  patterns: RegExp[],
  maxLen = 220,
): string | null {
  for (const pattern of patterns) {
    const m = blob.match(pattern);
    if (!m?.[0]) continue;
    let start = Math.max(0, (m.index ?? 0) - 40);
    let end = Math.min(blob.length, (m.index ?? 0) + m[0].length + 160);
    // Snap to sentence-ish boundaries.
    const before = blob.slice(Math.max(0, start - 80), start);
    const dot = before.lastIndexOf(".");
    if (dot >= 0) start = start - (before.length - dot - 1);
    const after = blob.slice(end, Math.min(blob.length, end + 80));
    const dot2 = after.search(/[.!?]/);
    if (dot2 >= 0) end = end + dot2 + 1;
    const slice = blob.slice(start, end).replace(/\s+/g, " ").trim();
    if (slice.length >= 24) return slice.slice(0, maxLen);
  }
  return null;
}

function extractEmployeeCount(blob: string): string | null {
  const patterns = [
    /(\d{1,4})\s*(?:[-–]\s*\d{1,4}\s*)?(?:mitarbeiter(?:innen)?|beschäftigte|personen|teammitglieder|angestellte|kolleg(?:en|innen))/i,
    /team\s*(?:von|mit)?\s*(\d{1,4})\s*(?:personen|mitarbeiter|leuten)?/i,
    /wir\s+sind\s+(\d{1,4})/i,
  ];
  for (const p of patterns) {
    const m = blob.match(p);
    if (m?.[1]) return `${m[1]} Personen (aus Website-Crawl, bitte prüfen)`;
  }
  return null;
}

function extractMetaLead(context: OrgCrawlContext): string | null {
  for (const p of context.pageExcerpts) {
    const lead = p.text.split(" · ")[0]?.trim() || "";
    if (lead.length >= 40 && lead.length <= 240) return lead;
  }
  return null;
}

const KNOWN_REGIONS =
  /(?:NRW|Nordrhein-Westfalen|Bayern|Baden-Württemberg|Berlin|Hamburg|Hessen|Sachsen|Niedersachsen|Rheinland-Pfalz|Schleswig-Holstein|Brandenburg|Thüringen|Sachsen-Anhalt|Mecklenburg-Vorpommern|Saarland|Bremen|Österreich|Schweiz|DACH|Deutschland|Europaweit|Bundesweit)/i;

function extractRegion(blob: string): string | null {
  const sentence = firstSentenceAround(blob, [
    /(?:standort|region|einzugsgebiet|bundesweit|deutschlandweit|mit\s+sitz\s+in|ansässig\s+in|tätig\s+in)[^.!?\n]{4,160}[.!?]?/i,
  ]);
  if (sentence) return sentence;

  const known = blob.match(
    new RegExp(
      `(?:in|aus|für)\\s+(${KNOWN_REGIONS.source})\\b|\\b(${KNOWN_REGIONS.source})\\b`,
      "i",
    ),
  );
  if (known?.[1] || known?.[2]) {
    const name = (known[1] || known[2] || "").trim();
    if (name) return `${name} (Signal aus Crawl — bitte präzisieren)`;
  }

  if (/deutschland|bundesweit|europaweit/i.test(blob)) {
    return "Deutschland (Signal aus Crawl — bitte präzisieren)";
  }
  return null;
}

function looksLikePersonName(value: string): boolean {
  const t = value.trim();
  if (t.length < 4 || t.length > 80) return false;
  if (/[.!?]{2,}|https?:|www\.|gmbh|ug\b|ag\b|e\.?\s*k\.?/i.test(t)) return false;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => /^[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ'-]{1,30}$/.test(p));
}

function extractOwnerName(blob: string): string | null {
  const patterns = [
    /(?:geschäftsführer(?:in)?|inhaber(?:in)?|founder|gründer(?:in)?|inhaberin|geschaeftsfuehrer(?:in)?)\s*[:\-]?\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß'-]+){1,3})/i,
    /([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß'-]+){1,3})\s*[,\-]?\s*(?:geschäftsführer(?:in)?|inhaber(?:in)?|gründer(?:in)?)/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    const candidate = (m?.[1] || "").trim();
    if (candidate && looksLikePersonName(candidate)) return candidate;
  }
  return null;
}

function extractCompetitors(blob: string): string | null {
  const sentence = firstSentenceAround(
    blob,
    [
      /(?:mitbewerber|wettbewerber|konkurrenz|vergleichen\s+uns\s+mit|ähnlich\s+wie)[^.!?\n]{8,220}[.!?]?/i,
    ],
    280,
  );
  return sentence;
}

/**
 * Heuristic prefill from org config + crawl text.
 * Conservative: only fills when a signal is present; UI can edit/delete.
 */
export function suggestPrefillsFromCrawl(input: {
  context: OrgCrawlContext;
  hints: Array<{ key: string; hint?: CoreQuestionPrefillHint }>;
}): Record<string, PrefillDraft> {
  const out: Record<string, PrefillDraft> = {};
  const blob = fullCrawlBlob(input.context);
  const metaLead = extractMetaLead(input.context);

  for (const item of input.hints) {
    if (!item.hint) continue;

    if (item.hint === "org_name" && input.context.organisationName) {
      out[item.key] = {
        value: input.context.organisationName,
        source: "organisation",
        note: "Aus Organisationsname übernommen",
      };
      continue;
    }

    if (item.hint === "website" && input.context.websiteUrl) {
      out[item.key] = {
        value: input.context.websiteUrl,
        source: "website",
        note: "Aus SEO-/Org-Konfiguration übernommen",
      };
      continue;
    }

    if (item.hint === "employee_count") {
      const value = extractEmployeeCount(blob);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Aus Crawl-Text geschätzt — bitte prüfen",
        };
      }
      continue;
    }

    if (item.hint === "owner_name") {
      const value = extractOwnerName(blob);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Name aus Crawl/Impressum-Signal — bitte prüfen",
        };
      }
      continue;
    }

    if (item.hint === "competitors") {
      const value = extractCompetitors(blob);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Mitbewerber-Hinweis aus Crawl — meist besser aus dem Gespräch",
        };
      }
      continue;
    }

    if (item.hint === "focus") {
      const value =
        firstSentenceAround(blob, [
          /(?:wir\s+(?:sind|stehen|fokussieren|spezialisieren)|unser\s+fokus|schwerpunkt|spezialisiert\s+auf)[^.!?\n]{12,180}[.!?]?/i,
        ]) || metaLead;
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Aus Website/Crawl abgeleitet — bitte prüfen",
        };
      }
      continue;
    }

    if (item.hint === "services") {
      const value = firstSentenceAround(blob, [
        /(?:unsere\s+leistungen|wir\s+bieten|angebot(?:e)?|leistungen|services)[^.!?\n]{12,200}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Leistungs-Hinweis aus Crawl — bitte ergänzen/kürzen",
        };
      }
      continue;
    }

    if (item.hint === "usp") {
      const value = firstSentenceAround(blob, [
        /(?:was\s+uns\s+unterscheidet|alleinstellung|usp|philosophie|darum\s+wir|warum\s+wir|wettbewerbsvorteil)[^.!?\n]{12,200}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Differenzierung aus Crawl — bitte prüfen",
        };
      }
      continue;
    }

    if (item.hint === "region") {
      const value = extractRegion(blob);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Region aus Crawl — bitte präzisieren",
        };
      }
      continue;
    }

    if (item.hint === "target_group") {
      const value = firstSentenceAround(blob, [
        /(?:für\s+(?:unternehmen|kunden|familien|praxen|kanzleien)|zielgruppe|unsere\s+kunden)[^.!?\n]{12,180}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = {
          value,
          source: "crawl",
          note: "Zielgruppen-Hinweis aus Crawl — bitte prüfen",
        };
      }
    }
  }

  return out;
}

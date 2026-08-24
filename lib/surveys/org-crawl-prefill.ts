/**
 * Heuristische Prefills aus Org-/Crawl-Kontext (ohne DB / server-only).
 * Testbar mit: npx tsx scripts/test-org-crawl-prefill.ts
 */

import type { CoreQuestionPrefillHint } from "@/lib/surveys/core-question-templates";

export type OrgCrawlSeoMetrics = {
  periodMonth: string;
  impressions: number;
  totalClicks: number;
  aiClicks: number;
  rankingsTop10: number;
  rankingsTop3: number;
  visibilityIndex: number | null;
  topKeywords: string[];
};

export type OrgCrawlContext = {
  organisationId: string;
  organisationName: string;
  websiteUrl: string | null;
  pageCount: number;
  snippets: Array<{ url: string; title: string | null; snippet: string }>;
  /** Longer crawl excerpts for extraction (not only short snippets). */
  pageExcerpts: Array<{ url: string; title: string | null; text: string }>;
  summaryText: string;
  seoStatsText?: string;
  seoMetrics?: OrgCrawlSeoMetrics | null;
};

export type PrefillSource = "organisation" | "website" | "crawl" | "ai" | "meeting" | "upload";

export type PrefillDraft = {
  value: string;
  source: PrefillSource;
  note: string;
};

export type CrawlPageKind = "press" | "about" | "team" | "services" | "other";

/** Rank crawled pages so press, about, team and services are used first. */
export function classifyCrawlPage(url: string, title: string | null): CrawlPageKind {
  const hay = `${url} ${title ?? ""}`.toLowerCase();
  if (
    /presse|pressemitteilung|press[-_]?release|newsroom|aktuelles|medien|blog/.test(hay)
  ) {
    return "press";
  }
  if (/\/team\b|mitarbeiter|unser[-_]?team|kolleg/.test(hay)) return "team";
  if (/ueber[-_]?uns|uber[-_]?uns|about|philosophie|geschichte|impressum/.test(hay)) {
    return "about";
  }
  if (/leistung|angebot|service|portfolio|leistungen/.test(hay)) return "services";
  return "other";
}

export function crawlPagePriority(kind: CrawlPageKind): number {
  if (kind === "press") return 5;
  if (kind === "about" || kind === "team") return 4;
  if (kind === "services") return 4;
  return 1;
}

export function crawlPageKindLabel(kind: CrawlPageKind): string {
  if (kind === "press") return "Presse";
  if (kind === "about") return "Über uns";
  if (kind === "team") return "Team";
  if (kind === "services") return "Leistungen";
  return "Weitere Seite";
}

function fullCrawlBlob(context: OrgCrawlContext): string {
  return [
    context.summaryText,
    context.seoStatsText ?? "",
    ...context.pageExcerpts.map((p) => `${p.url}\n${p.title ?? ""}\n${p.text}`),
    ...context.snippets.map((s) => `${s.url}\n${s.snippet}`),
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

export function extractEmployeeCount(blob: string): string | null {
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

function extractFoundingYear(blob: string): string | null {
  const patterns = [
    /(?:gegründet|bestehen\s+seit|seit)\s+(?:dem\s+)?((?:19|20)\d{2})/i,
    /((?:19|20)\d{2})\s+(?:gegründet|eröffnet)/i,
    /gründung\s*[:\-]?\s*((?:19|20)\d{2})/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractTeamMembers(blob: string): string | null {
  const found: string[] = [];
  const push = (name: string, role?: string) => {
    const n = name.trim();
    if (!looksLikePersonName(n)) return;
    const line = role?.trim() ? `${n}, ${role.trim()}` : n;
    if (!found.some((x) => x.toLowerCase().includes(n.toLowerCase()))) {
      found.push(line);
    }
  };

  const roleName =
    /(?:geschäftsführer(?:in)?|inhaber(?:in)?|gründer(?:in)?|founder|teamleitung|praxisinhaber(?:in)?)\s*[:\-]?\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß'-]+){1,3})/gi;
  let m: RegExpExecArray | null;
  while ((m = roleName.exec(blob))) {
    push(m[1] ?? "", m[0]?.split(/[:\-]/)[0]);
  }

  const nameRole =
    /([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß'-]+){1,3})\s*[,\-–]\s*(Geschäftsführer(?:in)?|Inhaber(?:in)?|Beratung|Assistenz|Marketing|Zahnarzt|Zahnärztin)/g;
  while ((m = nameRole.exec(blob))) {
    push(m[1] ?? "", m[2]);
  }

  return found.length ? found.slice(0, 8).join("\n") : null;
}

function extractAddress(blob: string): string | null {
  const street = blob.match(
    /((?:[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ.-]+(?:straße|strasse|weg|platz|allee|ring|gasse))\s+\d+[a-zA-Z]?(?:\s*,\s*|\s+)\d{5}\s+[A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ-]+)/,
  );
  if (street?.[1]) return street[1].replace(/\s+/g, " ").trim();

  const sentence = firstSentenceAround(blob, [
    /(?:impressum|adresse|anschrift|sitz)[^.!?\n]{8,180}[.!?]?/i,
  ]);
  return sentence;
}

function extractOpeningHours(blob: string): string | null {
  const sentence = firstSentenceAround(
    blob,
    [
      /(?:öffnungszeiten|geöffnet|mo[\s.–-]*fr|montag\s*[-–]\s*freitag)[^.!?\n]{6,180}[.!?]?/i,
    ],
    280,
  );
  return sentence;
}

function extractGbpUrl(blob: string): string | null {
  const m = blob.match(
    /https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps[^\s<>"')\]]*|maps\.google\.[^\s<>"')\]]*|g\.page\/[^\s<>"')\]]+)/i,
  );
  return m?.[0]?.replace(/[.,;:!?)]+$/g, "") ?? null;
}

function extractReviews(blob: string): string | null {
  const stars = blob.match(
    /(\d{1,2}(?:[.,]\d)?)\s*(?:von\s*5\s*)?(?:sterne|sternchen|★)/i,
  );
  const count = blob.match(
    /(\d{1,4})\s*(?:google[\s-]?)?(?:bewertungen|rezensionen|reviews)/i,
  );
  if (!stars && !count) {
    return firstSentenceAround(blob, [
      /(?:bewertungen|rezensionen|google[\s-]?bewert)[^.!?\n]{8,180}[.!?]?/i,
    ]);
  }
  const parts: string[] = ["Google"];
  if (count?.[1]) parts.push(`${count[1]} Bewertungen`);
  if (stars?.[1]) parts.push(`Durchschnitt ${stars[1]}`);
  return `${parts.join(" · ")} (aus Crawl — bitte prüfen)`;
}

function extractSocialChannels(blob: string, websiteUrl: string | null): string | null {
  const hits: string[] = [];
  const push = (label: string) => {
    if (!hits.includes(label)) hits.push(label);
  };
  if (websiteUrl) push("eigene Website");
  if (/instagram\.com|instagram/i.test(blob)) push("Instagram");
  if (/facebook\.com|facebook/i.test(blob)) push("Facebook");
  if (/linkedin\.com|linkedin/i.test(blob)) push("LinkedIn");
  if (/youtube\.com|youtu\.be/i.test(blob)) push("YouTube");
  if (/tiktok\.com|tiktok/i.test(blob)) push("TikTok");
  if (/newsletter|mailchimp|brevo/i.test(blob)) push("Newsletter");
  if (/google[\s-]?ads|google[\s-]?anzeigen/i.test(blob)) push("Google-Anzeigen");
  return hits.length ? hits.join("\n") : null;
}

function extractPortfolioLinks(context: OrgCrawlContext): string | null {
  const urls: string[] = [];
  const push = (url: string | null | undefined) => {
    const t = (url ?? "").trim();
    if (!t) return;
    if (!urls.includes(t)) urls.push(t);
  };
  push(context.websiteUrl);
  for (const p of context.pageExcerpts) {
    if (/leistung|angebot|service|portfolio|flyer|pdf/i.test(`${p.url} ${p.title ?? ""}`)) {
      push(p.url);
    }
  }
  return urls.length ? urls.join("\n") : null;
}

function extractCompanyHistory(blob: string): string | null {
  const year = extractFoundingYear(blob);
  if (year) return `${year} – Firma gegründet (aus Crawl — bitte prüfen)`;
  return firstSentenceAround(blob, [
    /(?:gegründet|firmengeschichte|meilenstein)[^.!?\n]{8,180}[.!?]?/i,
  ]);
}

const SERVICE_STOPWORDS =
  /^(?:unsere\s+)?(?:leistungen|angebot|angebote|services|portfolio|startseite|home|kontakt|impressum|datenschutz|mehr\s+erfahren|jetzt\s+anfragen|über\s+uns|ueber\s+uns|team|aktuelles|news|blog)$/i;

export function splitListItems(text: string): string[] {
  return text
    .split(/\n+|;\s+|\s+[•·]\s+/)
    .map((line) =>
      line
        .replace(/^[-*•–]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.,;:]+$/, ""),
    )
    .filter((line) => line.length >= 3 && line.length <= 80);
}

function looksLikeServiceLabel(value: string): boolean {
  const t = value.trim();
  if (t.length < 3 || t.length > 70) return false;
  if (SERVICE_STOPWORDS.test(t)) return false;
  if (/https?:|www\.|@/.test(t)) return false;
  if (/[.!?]{2,}/.test(t)) return false;
  const sentenceEndings = (t.match(/[.!?]/g) || []).length;
  if (sentenceEndings >= 2) return false;
  if (sentenceEndings === 1 && t.length > 40) return false;
  return true;
}

function pushUniqueLabel(target: string[], value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!looksLikeServiceLabel(cleaned)) return;
  if (target.some((item) => item.toLowerCase() === cleaned.toLowerCase())) return;
  target.push(cleaned);
}

function splitOfferedServices(sentence: string): string[] {
  const out: string[] = [];
  const parts = sentence
    .replace(/\s+und\s+/gi, ", ")
    .replace(/\s+sowie\s+/gi, ", ")
    .split(/,\s+/);
  for (const part of parts) pushUniqueLabel(out, part);
  return out;
}

export function parseServiceLabelList(text: string): string[] {
  const labels: string[] = [];
  const push = (value: string) => {
    const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (!looksLikeServiceLabel(cleaned)) return;
    if (labels.some((item) => item.toLowerCase() === cleaned.toLowerCase())) return;
    labels.push(cleaned);
  };
  for (const line of splitListItems(text)) {
    if (/,/.test(line) && line.length > 36) {
      for (const part of splitOfferedServices(line)) push(part);
    } else {
      push(line);
    }
  }
  return labels.slice(0, 8);
}

export function extractServiceLabels(context: OrgCrawlContext): string[] {
  const labels: string[] = [];
  const pages = [
    ...context.pageExcerpts.map((page) => ({
      url: page.url,
      title: page.title,
      text: page.text,
    })),
    ...context.snippets.map((snippet) => ({
      url: snippet.url,
      title: snippet.title,
      text: snippet.snippet,
    })),
  ].sort((a, b) => {
    const ka = classifyCrawlPage(a.url, a.title);
    const kb = classifyCrawlPage(b.url, b.title);
    if (ka === "services" && kb !== "services") return -1;
    if (kb === "services" && ka !== "services") return 1;
    return crawlPagePriority(kb) - crawlPagePriority(ka);
  });

  const servicePages = pages.filter(
    (page) => classifyCrawlPage(page.url, page.title) === "services",
  );
  const preferred = servicePages.length > 0 ? servicePages : pages;

  for (const page of preferred) {
    const blob = `${page.title ?? ""}\n${page.text}`;
    for (const line of splitListItems(blob)) {
      pushUniqueLabel(labels, line);
    }
    const offer = blob.match(
      /(?:wir\s+bieten(?:\s+ihnen)?|unsere\s+leistungen(?:\s+sind)?|angebot(?:e)?)\s*[:–-]?\s+([^.\n]{8,220})/i,
    );
    if (offer?.[1]) {
      for (const item of splitOfferedServices(offer[1])) pushUniqueLabel(labels, item);
    }
    if (labels.length >= 8) break;
  }

  if (labels.length < 2) {
    const blob = fullCrawlBlob(context);
    const offer = blob.match(
      /(?:wir\s+bieten(?:\s+ihnen)?|unsere\s+leistungen)\s*[:–-]?\s+([^.\n]{8,220})/i,
    );
    if (offer?.[1]) {
      for (const item of splitOfferedServices(offer[1])) pushUniqueLabel(labels, item);
    }
  }

  return labels.slice(0, 8);
}

export function extractLegalCompanyName(blob: string): string | null {
  const patterns = [
    /(?:impressum|handelsregisterangaben|firma)\s*[:\n]\s*([A-ZÄÖÜ][^\n]{2,90}(?:GmbH|UG\b|AG\b|GbR|e\.?\s*K\.?|PartG(?:\s*mbB)?|Partnerschaft)[^\n]{0,30})/i,
    /\b([A-ZÄÖÜ][^.\n]{2,80}(?:GmbH|Unternehmergesellschaft|Aktiengesellschaft|GbR|e\.?\s*K\.?|PartG(?:\s*mbB)?))\b/,
  ];
  for (const re of patterns) {
    const match = blob.match(re);
    const raw = (match?.[1] || "").replace(/\s+/g, " ").trim();
    if (raw.length >= 5 && raw.length <= 120) return raw;
  }
  return null;
}

export type ImpressumFacts = {
  legalName: string | null;
  address: string | null;
  ownerName: string | null;
};

export function extractImpressumFacts(blob: string): ImpressumFacts {
  return {
    legalName: extractLegalCompanyName(blob),
    address: extractAddress(blob),
    ownerName: extractOwnerName(blob),
  };
}

export function formatSeoMetricsAnswer(metrics: OrgCrawlSeoMetrics): string {
  const month = metrics.periodMonth;
  const lines = [
    `Impressionen (${month}): ${metrics.impressions}`,
    `Klicks gesamt (${month}): ${metrics.totalClicks}`,
    `KI-Klicks (${month}): ${metrics.aiClicks}`,
    `Top-10-Rankings: ${metrics.rankingsTop10}`,
    `Top-3-Rankings: ${metrics.rankingsTop3}`,
  ];
  if (metrics.visibilityIndex != null) {
    lines.push(`Sistrix-Sichtbarkeit: ${Number(metrics.visibilityIndex).toFixed(1)}`);
  }
  if (metrics.topKeywords.length) {
    lines.push(`Top-Keywords: ${metrics.topKeywords.slice(0, 8).join(", ")}`);
  }
  return lines.join("\n");
}

function crawlDraft(value: string, note: string): PrefillDraft {
  return { value: value.slice(0, 2000), source: "crawl", note };
}

/**
 * Heuristic prefill from org config + crawl text + optional SEO monthly stats.
 * Conservative: only fills when a signal is present; UI can edit/delete.
 */
export function suggestPrefillsFromCrawl(input: {
  context: OrgCrawlContext;
  hints: Array<{ key: string; hint?: CoreQuestionPrefillHint }>;
}): Record<string, PrefillDraft> {
  const out: Record<string, PrefillDraft> = {};
  const blob = fullCrawlBlob(input.context);
  const metaLead = extractMetaLead(input.context);
  const employeeCount = extractEmployeeCount(blob);
  const foundingYear = extractFoundingYear(blob);

  for (const item of input.hints) {
    if (!item.hint) continue;

    if (item.hint === "org_name") {
      const legal = extractLegalCompanyName(blob);
      if (legal) {
        out[item.key] = crawlDraft(legal, "Aus Impressum/Crawl — bitte prüfen");
      } else if (input.context.organisationName) {
        out[item.key] = {
          value: input.context.organisationName,
          source: "organisation",
          note: "Aus Organisationsname übernommen",
        };
      }
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

    if (item.hint === "portfolio_links") {
      const value = extractPortfolioLinks(input.context);
      if (value) {
        out[item.key] = {
          value,
          source: input.context.websiteUrl ? "website" : "crawl",
          note: "Links aus Website/Crawl — bitte prüfen",
        };
      }
      continue;
    }

    if (item.hint === "employee_count") {
      if (employeeCount) {
        out[item.key] = crawlDraft(employeeCount, "Aus Crawl-Text geschätzt — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "years_staff") {
      const parts: string[] = [];
      if (foundingYear) parts.push(`gegründet ${foundingYear}`);
      if (employeeCount) parts.push(employeeCount.replace(" (aus Website-Crawl, bitte prüfen)", ""));
      if (parts.length) {
        out[item.key] = crawlDraft(
          `${parts.join(", ")} (aus Crawl — bitte prüfen und Kunden-/Mitarbeiterzahlen ergänzen)`,
          "Jahre/Teamgröße aus Crawl — bitte prüfen",
        );
      }
      continue;
    }

    if (item.hint === "team_members") {
      const value = extractTeamMembers(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Namen aus Crawl/Impressum-Signal — bitte prüfen");
      } else if (employeeCount) {
        out[item.key] = crawlDraft(
          employeeCount,
          "Teamgröße aus Crawl — Namen bitte im Gespräch ergänzen",
        );
      }
      continue;
    }

    if (item.hint === "owner_name") {
      const value = extractOwnerName(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Name aus Crawl/Impressum-Signal — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "competitors") {
      const value = extractCompetitors(blob);
      if (value) {
        out[item.key] = crawlDraft(
          value,
          "Mitbewerber-Hinweis aus Crawl — meist besser aus dem Gespräch",
        );
      }
      continue;
    }

    if (item.hint === "focus") {
      const value =
        firstSentenceAround(blob, [
          /(?:wir\s+(?:sind|stehen|fokussieren|spezialisieren)|unser\s+fokus|schwerpunkt|spezialisiert\s+auf)[^.!?\n]{12,180}[.!?]?/i,
        ]) || metaLead;
      if (value) {
        out[item.key] = crawlDraft(value, "Aus Website/Crawl abgeleitet — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "services") {
      const labels = extractServiceLabels(input.context);
      if (labels.length > 0) {
        out[item.key] = crawlDraft(
          labels.join("\n"),
          "Leistungen aus Website/Crawl — bitte in den Checkboxen prüfen",
        );
      } else {
        const value = firstSentenceAround(blob, [
          /(?:unsere\s+leistungen|wir\s+bieten|angebot(?:e)?|leistungen|services)[^.!?\n]{12,200}[.!?]?/i,
        ]);
        if (value) {
          out[item.key] = crawlDraft(value, "Leistungs-Hinweis aus Crawl — bitte ergänzen/kürzen");
        }
      }
      continue;
    }

    if (item.hint === "usp") {
      const value = firstSentenceAround(blob, [
        /(?:was\s+uns\s+unterscheidet|alleinstellung|usp|philosophie|darum\s+wir|warum\s+wir|wettbewerbsvorteil)[^.!?\n]{12,200}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = crawlDraft(value, "Differenzierung aus Crawl — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "region") {
      const value = extractRegion(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Region aus Crawl — bitte präzisieren");
      }
      continue;
    }

    if (item.hint === "target_group") {
      const value = firstSentenceAround(blob, [
        /(?:für\s+(?:unternehmen|kunden|familien|praxen|kanzleien)|zielgruppe|unsere\s+kunden)[^.!?\n]{12,180}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = crawlDraft(value, "Zielgruppen-Hinweis aus Crawl — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "colloquial_name") {
      const value = firstSentenceAround(blob, [
        /(?:wir\s+sind\s+die|bekannt\s+als|kurz\s+[A-ZÄÖÜ])[^.!?\n]{6,120}[.!?]?/i,
      ]);
      if (value) {
        out[item.key] = crawlDraft(value, "Alltagsname-Signal aus Crawl — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "known_for") {
      const value =
        firstSentenceAround(blob, [
          /(?:bekannt\s+(?:für|als)|darauf\s+sind\s+wir\s+stolz|unsere\s+kunden\s+schätzen)[^.!?\n]{10,180}[.!?]?/i,
        ]) || metaLead;
      if (value) {
        out[item.key] = crawlDraft(value, "Bekanntheits-Hinweis aus Crawl — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "elevator_pitch") {
      const value = metaLead;
      if (value) {
        out[item.key] = crawlDraft(value, "Kurzbeschreibung aus Website/Meta — bitte prüfen");
      }
      continue;
    }

    if (item.hint === "seo_metrics" && input.context.seoMetrics) {
      out[item.key] = {
        value: formatSeoMetricsAnswer(input.context.seoMetrics),
        source: "organisation",
        note: "Monatliche SEO-Zahlen — bitte prüfen, keine erfundenen Werte",
      };
      continue;
    }

    if (item.hint === "online_channels") {
      const value = extractSocialChannels(blob, input.context.websiteUrl);
      if (value) {
        out[item.key] = crawlDraft(value, "Kanäle aus Crawl-Links — bitte abhaken");
      }
      continue;
    }

    if (item.hint === "gbp_link") {
      const value = extractGbpUrl(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Maps-/GBP-Link aus Crawl");
      }
      continue;
    }

    if (item.hint === "opening_hours") {
      const value = extractOpeningHours(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Öffnungszeiten aus Crawl — bitte mit GBP abgleichen");
      }
      continue;
    }

    if (item.hint === "reviews") {
      const value = extractReviews(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Bewertungssignal aus Crawl — bitte Zahlen prüfen");
      }
      continue;
    }

    if (item.hint === "nap_address") {
      const value = extractAddress(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Adress-Signal aus Crawl/Impressum — NAP prüfen");
      }
      continue;
    }

    if (item.hint === "company_history") {
      const value = extractCompanyHistory(blob);
      if (value) {
        out[item.key] = crawlDraft(value, "Meilenstein aus Crawl — bitte ergänzen");
      }
    }
  }

  return out;
}

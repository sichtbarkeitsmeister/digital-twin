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

export type CrawlPageKind = "press" | "about" | "team" | "services" | "legal" | "other";

const LEGAL_PAGE_RE =
  /impressum|datenschutz|datenschutzerkl|agb\b|\/agb|cookie(?:s|richtlinie|policy)|widerruf|haftungsausschluss|legal[-_]?notice/;

const NAV_OR_LEGAL_LABEL_RE =
  /^(?:unsere\s+)?(?:leistungen|angebot|angebote|services|portfolio|startseite|home|kontakt|impressum|datenschutz|agb|cookies?|mehr\s+erfahren|jetzt\s+anfragen|über\s+uns|ueber\s+uns|team|aktuelles|news|blog|karriere|login|menü|menu)$/i;

const PAGE_KIND_TITLE_PREFIX_RE =
  /^(?:Presse|Über uns|Team|Leistungen|Impressum|Weitere Seite):\s*/i;

const PRICE_OR_TREATMENT_LIST_RE =
  /€|eur\b|ab\s*ca\.|ab\s+\d|pro\s+(?:sitzung|ampulle|region|behandlung|zone)|injektionen?\s*:/i;

const LEGAL_FORM_RE =
  /\b(?:GmbH|mbH|UG(?:\s*\(haftungsbeschränkt\))?|AG|SE|GbR|OHG|KG|e\.\s*K\.|PartG(?:\s*mbB)?|Partnerschaftsgesellschaft|Rechtsanwaltsgesellschaft(?:\s*mbH)?|Unternehmergesellschaft|Aktiengesellschaft)\b/i;

const KNOWN_REGIONS =
  /(?:NRW|Nordrhein-Westfalen|Bayern|Baden-Württemberg|Berlin|Hamburg|Hessen|Sachsen|Niedersachsen|Rheinland-Pfalz|Schleswig-Holstein|Brandenburg|Thüringen|Sachsen-Anhalt|Mecklenburg-Vorpommern|Saarland|Bremen|Österreich|Schweiz|DACH|Deutschland|Europaweit|Bundesweit)/i;

/** Rank crawled pages so press, about, team and services are used first. */
export function classifyCrawlPage(url: string, title: string | null): CrawlPageKind {
  const hay = `${url} ${title ?? ""}`.toLowerCase();
  if (LEGAL_PAGE_RE.test(hay)) return "legal";
  if (
    /presse|pressemitteilung|press[-_]?release|newsroom|aktuelles|medien|blog/.test(hay)
  ) {
    return "press";
  }
  if (/\/team\b|mitarbeiter|unser[-_]?team|kolleg/.test(hay)) return "team";
  if (/ueber[-_]?uns|uber[-_]?uns|about|philosophie|geschichte/.test(hay)) {
    return "about";
  }
  if (/leistung|angebot|service|portfolio|leistungen|behandlung/.test(hay)) return "services";
  return "other";
}

export function crawlPagePriority(kind: CrawlPageKind): number {
  if (kind === "press") return 5;
  if (kind === "about" || kind === "team" || kind === "legal") return 4;
  if (kind === "services") return 4;
  return 1;
}

export function crawlPageKindLabel(kind: CrawlPageKind): string {
  if (kind === "press") return "Presse";
  if (kind === "about") return "Über uns";
  if (kind === "team") return "Team";
  if (kind === "services") return "Leistungen";
  if (kind === "legal") return "Impressum";
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

export function looksLikePriceOrTreatmentList(value: string): boolean {
  return PRICE_OR_TREATMENT_LIST_RE.test(value);
}

export function looksLikeTruncatedSnippet(value: string): boolean {
  const t = value.trim();
  if (t.length < 8) return true;
  if (/\s+[A-Za-zÄÖÜäöüß]$/.test(t)) return true;
  if (/:\s*[A-ZÄÖÜa-zäöüß]{1,4}$/.test(t) && t.length < 80) return true;
  return false;
}

function stripPageKindPrefix(value: string): string {
  return value.replace(PAGE_KIND_TITLE_PREFIX_RE, "").trim();
}

function looksLikeSiteChromeTitle(value: string): boolean {
  const t = stripPageKindPrefix(value);
  const left = t.split(/\s+[-–|]\s+/)[0]?.trim() ?? t;
  if (NAV_OR_LEGAL_LABEL_RE.test(t) || NAV_OR_LEGAL_LABEL_RE.test(left)) return true;
  if (LEGAL_PAGE_RE.test(t)) return true;
  return false;
}

function hasPlaceSignal(value: string): boolean {
  if (/\d{5}\s+[A-ZÄÖÜ]/.test(value)) return true;
  if (KNOWN_REGIONS.test(value)) return true;
  if (/\b(?:sitz\s+in|ansässig\s+in|standort|einzugsgebiet|aus\s+der\s+region)\b/i.test(value)) {
    return true;
  }
  return false;
}

/**
 * Drop crawl/AI snippets that do not match the question.
 * Company name must not be a treatment line; location must not be a price list.
 */
export function isPlausiblePrefill(
  hint: CoreQuestionPrefillHint | undefined,
  value: string,
): boolean {
  if (hint === "services") {
    return parseServiceLabelList(value).length > 0;
  }
  const t = value.replace(/\s+/g, " ").trim();
  if (!t || t.length < 3) return false;
  if (!hint) return !looksLikeTruncatedSnippet(t);

  if (hint === "org_name") {
    if (looksLikePriceOrTreatmentList(t) || looksLikeTruncatedSnippet(t)) return false;
    if (looksLikeSiteChromeTitle(t)) return false;
    if (LEGAL_FORM_RE.test(t)) return t.length >= 5 && t.length <= 140;
    if (/^(?:dr\.|praxis|kanzlei|institut|klinik)\b/i.test(t) && t.length <= 120) return true;
    if (t.length <= 80 && !/[:;]/.test(t) && !NAV_OR_LEGAL_LABEL_RE.test(t)) return true;
    return false;
  }

  if (hint === "region" || hint === "nap_address") {
    if (looksLikePriceOrTreatmentList(t) || looksLikeTruncatedSnippet(t)) return false;
    if (looksLikeSiteChromeTitle(t)) return false;
    return hasPlaceSignal(t) || (hint === "nap_address" && /\d/.test(t));
  }

  if (
    hint === "usp" ||
    hint === "focus" ||
    hint === "elevator_pitch" ||
    hint === "colloquial_name" ||
    hint === "known_for" ||
    hint === "target_group"
  ) {
    if (looksLikePriceOrTreatmentList(t) || looksLikeTruncatedSnippet(t)) return false;
    if (looksLikeSiteChromeTitle(t)) return false;
    return t.length >= 8 && t.length <= 500;
  }

  if (hint === "owner_name") return looksLikePersonName(t);
  if (hint === "team_members") return t.split("\n").some((line) => looksLikePersonName(line.split(",")[0] ?? line));

  return !looksLikeTruncatedSnippet(t);
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
    const kind = classifyCrawlPage(p.url, p.title);
    if (kind === "legal") continue;
    const lead = p.text.split(" · ")[0]?.trim() || "";
    if (lead.length < 40 || lead.length > 240) continue;
    if (looksLikePriceOrTreatmentList(lead) || looksLikeTruncatedSnippet(lead)) continue;
    if (looksLikeSiteChromeTitle(lead)) continue;
    return lead;
  }
  return null;
}

function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(/\d{5}\s+([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ-]+(?:\s+[A-ZÄÖÜ][a-zäöüß-]+)?)/);
  const city = m?.[1]?.trim();
  return city && city.length >= 3 ? city : null;
}

function extractRegion(blob: string, address?: string | null): string | null {
  const city = cityFromAddress(address);
  if (city) {
    const catchment = blob.match(
      /\b(?:die\s+meisten\s+(?:kunden|patienten|mandanten)|einzugsgebiet|aus\s+der\s+(?:region|umgebung))\s+[^.\n]{4,80}/i,
    );
    const extra = catchment?.[0]?.replace(/\s+/g, " ").trim();
    if (extra && !looksLikePriceOrTreatmentList(extra)) {
      return `Sitz in ${city}, ${extra}`;
    }
    return `Sitz in ${city}`;
  }

  const sentence = firstSentenceAround(blob, [
    /(?:mit\s+sitz\s+in|ansässig\s+in|standort(?:e)?\s+in|einzugsgebiet|aus\s+der\s+region)[^.!?\n]{4,120}[.!?]?/i,
  ]);
  if (sentence && isPlausiblePrefill("region", sentence)) return sentence;

  const known = blob.match(
    new RegExp(
      `(?:in|aus|für)\\s+(${KNOWN_REGIONS.source})\\b`,
      "i",
    ),
  );
  if (known?.[1]) {
    const name = known[1].trim();
    if (name && !looksLikePriceOrTreatmentList(name)) {
      return `${name} (Signal aus Crawl — bitte präzisieren)`;
    }
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

const SERVICE_STOPWORDS = NAV_OR_LEGAL_LABEL_RE;

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
  const t = stripPageKindPrefix(value.replace(/\s+/g, " ").trim());
  if (t.length < 3 || t.length > 70) return false;
  if (NAV_OR_LEGAL_LABEL_RE.test(t)) return false;
  if (looksLikeSiteChromeTitle(t)) return false;
  if (/https?:|www\.|@/.test(t)) return false;
  if (looksLikePriceOrTreatmentList(t)) return false;
  if (/[.!?]{2,}/.test(t)) return false;
  const sentenceEndings = (t.match(/[.!?]/g) || []).length;
  if (sentenceEndings >= 2) return false;
  if (sentenceEndings === 1 && t.length > 40) return false;
  return true;
}

function looksLikePricedServiceName(name: string): boolean {
  if (name.length > 48) return false;
  if (/\s[A-ZÄÖÜa-zäöüß]\s/.test(` ${name} `)) return false;
  if (/^(?:pro|ab|ca\.?|eine|ein|und|oder|weitere)\b/i.test(name)) return false;
  return looksLikeServiceLabel(name);
}

function serviceLabelFromTitle(title: string | null): string | null {
  const stripped = stripPageKindPrefix(title ?? "");
  if (!stripped) return null;
  const left = stripped.split(/\s+[-–|]\s+/)[0]?.trim() ?? stripped;
  const candidate = left.length >= 3 && left.length <= 55 ? left : stripped;
  return looksLikeServiceLabel(candidate) ? candidate : null;
}

const PRICED_SERVICE_NAME =
  "[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9+/&-]*(?:[ -][A-Za-zÄÖÜäöüß0-9+/&-]{2,}){0,5}";

/**
 * Turn “Botox-Injektionen: ab ca. 200 € pro Region” into “Botox-Injektionen”.
 * Dermatology and similar sites often only list offers this way, concatenated.
 */
export function extractPricedServiceNames(text: string): string[] {
  const names: string[] = [];
  const prepared = text.replace(
    new RegExp(`\\s+(?=${PRICED_SERVICE_NAME}:\\s*(?:ab\\s*)?(?:ca\\.?\\s*)?\\d)`, "g"),
    "\n",
  );
  const re = new RegExp(
    `(${PRICED_SERVICE_NAME})\\s*:\\s*(?:ab\\s*)?(?:ca\\.?\\s*)?\\d{1,5}(?:[.,]\\d+)?\\s*(?:€|EUR)`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(prepared))) {
    const name = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (!looksLikePricedServiceName(name)) continue;
    if (names.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  return names;
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
  for (const name of extractPricedServiceNames(text)) push(name);
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
  ]
    .filter((page) => classifyCrawlPage(page.url, page.title) !== "legal")
    .sort((a, b) => {
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

  const collectFromPage = (page: { url: string; title: string | null; text: string }, useTitle: boolean) => {
    if (useTitle) {
      const title = serviceLabelFromTitle(page.title);
      if (title) pushUniqueLabel(labels, title);
    }
    for (const name of extractPricedServiceNames(page.text)) {
      pushUniqueLabel(labels, name);
    }
    for (const line of splitListItems(page.text)) {
      pushUniqueLabel(labels, line);
    }
    const offer = page.text.match(
      /(?:wir\s+bieten(?:\s+ihnen)?|unsere\s+leistungen(?:\s+sind)?|angebot(?:e)?)\s*[:–-]?\s+([^.\n]{8,220})/i,
    );
    if (offer?.[1]) {
      for (const item of splitOfferedServices(offer[1])) pushUniqueLabel(labels, item);
    }
  };

  for (const page of pages) {
    for (const name of extractPricedServiceNames(page.text)) {
      pushUniqueLabel(labels, name);
    }
  }

  for (const page of preferred) {
    const kind = classifyCrawlPage(page.url, page.title);
    const titleLooksLikeService = looksLikeServiceLabel(stripPageKindPrefix(page.title ?? ""));
    collectFromPage(page, kind === "services" || (kind === "other" && titleLooksLikeService));
    if (labels.length >= 8) break;
  }

  if (labels.length < 2) {
    for (const page of pages) {
      collectFromPage(page, false);
      if (labels.length >= 8) break;
    }
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
    /(?:impressum|handelsregisterangaben|firmenname|firma)\s*[:\n]\s*([^\n]{5,120})/i,
    new RegExp(
      `\\b([A-ZÄÖÜ][^\\n]{2,80}${LEGAL_FORM_RE.source})\\b`,
    ),
  ];
  for (const re of patterns) {
    const match = blob.match(re);
    const raw = (match?.[1] || "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (!isPlausiblePrefill("org_name", raw)) continue;
    if (LEGAL_FORM_RE.test(raw) || /^(?:dr\.|praxis|kanzlei)\b/i.test(raw)) return raw;
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

function assignCrawlPrefill(
  out: Record<string, PrefillDraft>,
  key: string,
  hint: CoreQuestionPrefillHint,
  value: string | null | undefined,
  note: string,
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (!isPlausiblePrefill(hint, trimmed)) return;
  out[key] = crawlDraft(trimmed, note);
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
  const address = extractAddress(blob);
  const metaLead = extractMetaLead(input.context);
  const employeeCount = extractEmployeeCount(blob);
  const foundingYear = extractFoundingYear(blob);

  for (const item of input.hints) {
    if (!item.hint) continue;

    if (item.hint === "org_name") {
      const legal = extractLegalCompanyName(blob);
      if (legal && isPlausiblePrefill("org_name", legal)) {
        out[item.key] = crawlDraft(legal, "Aus Impressum/Crawl — bitte prüfen");
      } else if (
        input.context.organisationName &&
        isPlausiblePrefill("org_name", input.context.organisationName)
      ) {
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
      assignCrawlPrefill(out, item.key, "focus", value, "Aus Website/Crawl abgeleitet — bitte prüfen");
      continue;
    }

    if (item.hint === "services") {
      const labels = extractServiceLabels(input.context);
      if (labels.length > 0) {
        assignCrawlPrefill(
          out,
          item.key,
          "services",
          labels.join("\n"),
          "Leistungen aus Website/Crawl — bitte in den Checkboxen prüfen",
        );
      }
      continue;
    }

    if (item.hint === "usp") {
      assignCrawlPrefill(
        out,
        item.key,
        "usp",
        firstSentenceAround(blob, [
          /(?:was\s+uns\s+unterscheidet|alleinstellung|usp|philosophie|darum\s+wir|warum\s+wir|wettbewerbsvorteil)[^.!?\n]{12,200}[.!?]?/i,
        ]),
        "Differenzierung aus Crawl — bitte prüfen",
      );
      continue;
    }

    if (item.hint === "region") {
      assignCrawlPrefill(
        out,
        item.key,
        "region",
        extractRegion(blob, address),
        "Region aus Crawl — bitte präzisieren",
      );
      continue;
    }

    if (item.hint === "target_group") {
      assignCrawlPrefill(
        out,
        item.key,
        "target_group",
        firstSentenceAround(blob, [
          /(?:für\s+(?:unternehmen|kunden|familien|praxen|kanzleien)|zielgruppe|unsere\s+kunden)[^.!?\n]{12,180}[.!?]?/i,
        ]),
        "Zielgruppen-Hinweis aus Crawl — bitte prüfen",
      );
      continue;
    }

    if (item.hint === "colloquial_name") {
      assignCrawlPrefill(
        out,
        item.key,
        "colloquial_name",
        firstSentenceAround(blob, [
          /(?:wir\s+sind\s+die|bekannt\s+als|kurz\s+[A-ZÄÖÜ])[^.!?\n]{6,120}[.!?]?/i,
        ]),
        "Alltagsname-Signal aus Crawl — bitte prüfen",
      );
      continue;
    }

    if (item.hint === "known_for") {
      const value =
        firstSentenceAround(blob, [
          /(?:bekannt\s+(?:für|als)|darauf\s+sind\s+wir\s+stolz|unsere\s+kunden\s+schätzen)[^.!?\n]{10,180}[.!?]?/i,
        ]) || metaLead;
      assignCrawlPrefill(out, item.key, "known_for", value, "Bekanntheits-Hinweis aus Crawl — bitte prüfen");
      continue;
    }

    if (item.hint === "elevator_pitch") {
      assignCrawlPrefill(
        out,
        item.key,
        "elevator_pitch",
        metaLead,
        "Kurzbeschreibung aus Website/Meta — bitte prüfen",
      );
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
      assignCrawlPrefill(
        out,
        item.key,
        "nap_address",
        address,
        "Adress-Signal aus Crawl/Impressum — NAP prüfen",
      );
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

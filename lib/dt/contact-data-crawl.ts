/**
 * Kontaktdaten from the organisation's own website, the pure parts: which crawled pages to
 * read (Impressum, Kontakt, Startseite), what their live HTML says through its links (tel:,
 * mailto:, social profiles, Google links and Maps iframes; the crawl stores plain text only,
 * so links are lost there) and what the text says (address, phone, fax, e-mail, opening
 * hours, owner), with the heuristics of the survey prefill (`org-crawl-prefill.ts`).
 *
 * Every value must be on the page: the optional extraction call on the cheap model
 * (`contactExtractionSpec`) is accepted only where its value appears in the text it read.
 * `contact-data-fill.ts` fetches the pages and saves.
 */

import type Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

import { phoneDigits, type ContactFieldKey } from "@/lib/dt/contact-data";
import {
  extractGoogleProfileUrls,
  extractImpressumFacts,
  extractOpeningHours,
} from "@/lib/surveys/org-crawl-prefill";

export type ContactPageKind = "impressum" | "kontakt" | "start";

export const CONTACT_PAGE_LABELS: Record<ContactPageKind, string> = {
  impressum: "Impressum",
  kontakt: "Kontakt",
  start: "Startseite",
};

export type CrawledContactPage = { url: string; title: string | null; h1: string | null; text_content: string | null };
export type ContactPageChoice = { kind: ContactPageKind; page: CrawledContactPage };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return "";
  }
}

const IMPRESSUM_RE = /impressum|imprint|legal[-_ ]?notice|anbieterkennzeichnung/i;
const KONTAKT_RE = /kontakt|contact|anfahrt|standort/i;
const NOT_KONTAKT_RE = /datenschutz|privacy|danke|thank|formular-gesendet/i;

/**
 * Impressum, Kontakt and Startseite among the crawled pages, each at most once. The shortest
 * path wins („/kontakt“ before „/kontakt/anfahrt“). The Startseite is the root or, without
 * one, the page with the fewest path segments.
 */
export function pickContactPages(rows: readonly CrawledContactPage[]): ContactPageChoice[] {
  const byPath = [...rows].sort((a, b) => pathOf(a.url).length - pathOf(b.url).length);
  const hay = (p: CrawledContactPage) => `${pathOf(p.url)} ${p.title ?? ""} ${p.h1 ?? ""}`;
  const impressum = byPath.find((p) => IMPRESSUM_RE.test(pathOf(p.url))) ?? byPath.find((p) => IMPRESSUM_RE.test(hay(p)));
  const kontakt =
    byPath.find((p) => KONTAKT_RE.test(pathOf(p.url)) && !NOT_KONTAKT_RE.test(hay(p)) && p !== impressum) ??
    byPath.find((p) => KONTAKT_RE.test(hay(p)) && !NOT_KONTAKT_RE.test(hay(p)) && p !== impressum);
  const start =
    byPath.find((p) => pathOf(p.url) === "/") ??
    [...rows].sort((a, b) => pathOf(a.url).split("/").length - pathOf(b.url).split("/").length)[0];
  const out: ContactPageChoice[] = [];
  const add = (kind: ContactPageKind, page: CrawledContactPage | undefined) => {
    if (page && !out.some((c) => c.page.url === page.url)) out.push({ kind, page });
  };
  add("impressum", impressum);
  add("kontakt", kontakt);
  add("start", start);
  return out;
}

// --- links of the live HTML -------------------------------------------------------------------------

export type ContactLinks = {
  phones: string[];
  emails: string[];
  google: string[];
  facebook: string[];
  instagram: string[];
  linkedin: string[];
  youtube: string[];
  /** XING, TikTok, X/Twitter, Pinterest. */
  otherSocial: string[];
};


function pushUnique(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

/** Share and login links are no profile. */
const SOCIAL_NOISE_RE = /\/(?:sharer|share|intent|dialog|plugins|login|shareArticle|hashtag)\b|[?&](?:u|url|text)=/i;

function socialKind(url: URL): keyof Pick<ContactLinks, "facebook" | "instagram" | "linkedin" | "youtube" | "otherSocial"> | null {
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|de-de|de)\./, "");
  if (host === "facebook.com" || host === "fb.com") return "facebook";
  if (host === "instagram.com") return "instagram";
  if (host === "linkedin.com") return "linkedin";
  if (host === "youtube.com" || host === "youtu.be") return "youtube";
  if (["xing.com", "tiktok.com", "x.com", "twitter.com", "pinterest.com", "pinterest.de"].includes(host)) return "otherSocial";
  return null;
}

function cleanPhone(raw: string): string {
  return decodeURIComponent(raw)
    .replace(/^tel:/i, "")
    .replace(/[^\d+()/ \-.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEmail(raw: string): string {
  const value = decodeURIComponent(raw).replace(/^mailto:/i, "").split("?")[0]!.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value) ? value : "";
}

/**
 * The links of one page: tel: and mailto: links, social profiles, Google profile and map
 * links, also as iframe src (an embedded map). `baseUrl` resolves relative links.
 */
export function extractContactLinks(html: string, baseUrl: string): ContactLinks {
  const $ = cheerio.load(html);
  const links: ContactLinks = {
    phones: [],
    emails: [],
    google: [],
    facebook: [],
    instagram: [],
    linkedin: [],
    youtube: [],
    otherSocial: [],
  };
  const attrs: string[] = [];
  $("a[href]").each((_, el) => {
    attrs.push($(el).attr("href") ?? "");
  });
  $("iframe[src], iframe[data-src]").each((_, el) => {
    attrs.push($(el).attr("src") ?? $(el).attr("data-src") ?? "");
  });
  for (const raw of attrs) {
    const href = raw.trim();
    if (!href) continue;
    if (/^tel:/i.test(href)) {
      pushUnique(links.phones, cleanPhone(href));
      continue;
    }
    if (/^mailto:/i.test(href)) {
      pushUnique(links.emails, cleanEmail(href));
      continue;
    }
    for (const google of extractGoogleProfileUrls(href)) pushUnique(links.google, google);
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const kind = socialKind(url);
    if (!kind || SOCIAL_NOISE_RE.test(`${url.pathname}${url.search}`) || url.pathname.replace(/\/+$/, "") === "") continue;
    url.hash = "";
    // Tracking and language parameters are no part of a profile („?hl=de“, „?ref=…“); a YouTube video keeps its id.
    if (!(kind === "youtube" && url.pathname === "/watch")) url.search = "";
    pushUnique(links[kind], url.toString().replace(/\/$/, ""));
  }
  // Data attributes and inline scripts sometimes carry the map link (cookie-blocked iframes).
  for (const google of extractGoogleProfileUrls(html)) pushUnique(links.google, google);
  return links;
}

export function mergeContactLinks(list: readonly ContactLinks[]): ContactLinks {
  const out: ContactLinks = {
    phones: [],
    emails: [],
    google: [],
    facebook: [],
    instagram: [],
    linkedin: [],
    youtube: [],
    otherSocial: [],
  };
  for (const links of list) {
    for (const key of Object.keys(out) as Array<keyof ContactLinks>) {
      for (const value of links[key]) pushUnique(out[key], value);
    }
  }
  return out;
}

/** How good a Google link is as „Google-Profil“: a profile or place link first, a map embed last. */
export function googleLinkRank(url: string): number {
  if (/g\.page\/|share\.google\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\//i.test(url)) return 0;
  if (/\/maps\/place\/|[?&]cid=|\/maps\?cid=/i.test(url)) return 1;
  if (/search\.google\.[a-z.]+\/local\//i.test(url)) return 2;
  if (/\/maps\/embed/i.test(url)) return 4;
  return 3;
}

export function bestGoogleLink(urls: readonly string[]): string | null {
  return [...urls].sort((a, b) => googleLinkRank(a) - googleLinkRank(b))[0] ?? null;
}

// --- the text -------------------------------------------------------------------------------------------

/** German mobile numbers: 015x, 016x, 017x (also as +49 15…). */
export function isMobileNumber(phone: string): boolean {
  const digits = phone.replace(/[^\d+]/g, "").replace(/^\+49/, "0").replace(/^0049/, "0");
  return /^01[567]\d/.test(digits);
}


const PHONE_VALUE = String.raw`(\+?\d[\d ()/.\-]{5,22}\d)`;

function labelledNumber(text: string, labels: string): string | null {
  const m = text.match(new RegExp(`(?:^|[\\s,;|·])(?:${labels})\\s*[.:]{0,2}\\s*(?:\\+|\\d|\\()`, "i"));
  if (!m || m.index == null) return null;
  const rest = text.slice(m.index + m[0].length - 1);
  const value = rest.match(new RegExp(`^${PHONE_VALUE}`));
  return value?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

const ADDRESS_SOURCE =
  String.raw`([A-ZÄÖÜ][\p{L}.\- ]{1,60}?(?:[Ss]tra(?:ße|sse)|[Ss]tr\.|[Ww]eg|[Pp]latz|[Aa]llee|[Rr]ing|[Gg]asse|[Dd]amm|[Uu]fer|[Cc]haussee|[Mm]arkt|[Hh]of|[Ss]teig|[Pp]fad|[Bb]erg|[Ff]eld|[Gg]arten|[Pp]ark)\s*\d{1,4}\s?[a-zA-Z]?(?:\s?[-–/]\s?\d{1,4}[a-zA-Z]?)?)\s*[,\n|·]?\s*(?:D-)?(\d{5})\s+([A-ZÄÖÜ][\p{L}\-]+(?:[ \-][A-ZÄÖÜ(][\p{L}.()\-]+){0,3})`;

/** „Musterstraße 12, 12345 Musterstadt“ → its parts; null when it is no street address. */
export function splitAddress(address: string | null | undefined): { strasse: string; plz: string; ort: string } | null {
  const m = unglue(address ?? "").match(new RegExp(ADDRESS_SOURCE, "u"));
  if (!m) return null;
  return { strasse: m[1]!.replace(/\s+/g, " ").trim(), plz: m[2]!, ort: m[3]!.replace(/\s+/g, " ").trim() };
}

/**
 * Words that put an address of someone else right before it on an Impressum: the chamber, the
 * supervisory authority, the insurer, the court, the web agency or host.
 */
const THIRD_PARTY_RE =
  /kammer|aufsicht|behörde|kassen(?:zahn)?ärztliche|versicherung|haftpflicht|gericht|schlichtung|verband|verbraucher|webdesign|agentur|hosting|hoster|provider|bildnachweis|fotograf/i;

/** The first street address of the text that is not someone else's (chamber, authority, insurer, agency …). */
export function findCompanyAddress(text: string): { strasse: string; plz: string; ort: string } | null {
  const flat = unglue(text);
  for (const m of flat.matchAll(new RegExp(ADDRESS_SOURCE, "gu"))) {
    const at = m.index ?? 0;
    const before = flat.slice(Math.max(0, at - 160), at);
    if (THIRD_PARTY_RE.test(before)) continue;
    return { strasse: m[1]!.replace(/\s+/g, " ").trim(), plz: m[2]!, ort: m[3]!.replace(/\s+/g, " ").trim() };
  }
  return null;
}

/**
 * The crawl stores some pages with their elements glued together („47798 KrefeldTelefon:
 * 02151 …“). A line break goes where a lower-case letter or a digit meets a capitalised word.
 */
export function unglue(text: string): string {
  return text.replace(/([a-zäöüß])([A-ZÄÖÜ][a-zäöüß])/g, "$1\n$2").replace(/(\d)([A-ZÄÖÜ][a-zäöüß])/g, "$1\n$2");
}

/** Domain endings of German small-business sites; a longer last label is cut back to one („deimpressum“ → „de“). */
const KNOWN_TLDS = ["de", "com", "net", "org", "info", "eu", "at", "ch", "biz", "online", "email", "nrw", "koeln", "berlin", "hamburg", "bayern", "ruhr", "io", "co", "shop", "gmbh", "team", "praxis", "dental", "law", "legal"];

export function cleanTextEmail(raw: string): string {
  const email = raw.toLowerCase();
  const dot = email.lastIndexOf(".");
  const tld = email.slice(dot + 1);
  if (KNOWN_TLDS.includes(tld)) return email;
  const prefix = KNOWN_TLDS.filter((t) => tld.startsWith(t)).sort((a, b) => b.length - a.length)[0];
  return prefix ? `${email.slice(0, dot + 1)}${prefix}` : email;
}

const EMAIL_IN_TEXT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Addresses nobody writes to from a website text: privacy and technical mailboxes. */
function isPublicEmail(email: string): boolean {
  return !/^(?:datenschutz|privacy|dsb|noreply|no-reply|webmaster|postmaster|abuse)@/i.test(email);
}

export type ContactTextFacts = Partial<Record<"firmenname" | "ansprechpartner" | "strasse" | "plz" | "ort" | "telefon" | "mobil" | "fax" | "email" | "oeffnungszeiten", string>>;

/** What the text of the Impressum, Kontakt and Startseite says, by the survey prefill's heuristics. */
export function extractContactTextFacts(text: string): ContactTextFacts {
  const facts: ContactTextFacts = {};
  const flat = unglue(text.replace(/\u00a0/g, " "));
  const impressum = extractImpressumFacts(flat);
  if (impressum.legalName) facts.firmenname = impressum.legalName;
  // The owner pattern spans whitespace; on one line per element it must not run into the next line.
  const owner = extractImpressumFacts(flat.replace(/[ \t]*\n\s*/g, " · ")).ownerName;
  if (owner) facts.ansprechpartner = owner;
  const address = findCompanyAddress(flat) ?? splitAddress(impressum.address);
  if (address) Object.assign(facts, address);
  const phone = labelledNumber(flat, "telefon|tel|fon|phone");
  if (phone) facts[isMobileNumber(phone) ? "mobil" : "telefon"] = phone;
  const mobile = labelledNumber(flat, "mobil|mobile|handy|mobiltelefon");
  if (mobile) facts.mobil = mobile;
  const fax = labelledNumber(flat, "telefax|fax");
  if (fax) facts.fax = fax;
  const email = [...flat.matchAll(EMAIL_IN_TEXT_RE)].map((m) => cleanTextEmail(m[0])).find(isPublicEmail);
  if (email) facts.email = email;
  const hours = extractOpeningHours(flat);
  if (hours && /\d/.test(hours)) facts.oeffnungszeiten = hours.replace(/\s+/g, " ").trim();
  return facts;
}

/**
 * The values the crawl found, by field, from the pages' text and live links. Links win over
 * the text for phone and e-mail (a tel: link is what the site itself dials), in the text's
 * spelling when it names the same number; the first phone that is no mobile number is Telefon.
 */
export function contactValuesFromCrawl(input: { texts: readonly string[]; links: ContactLinks }): Partial<Record<ContactFieldKey, string>> {
  const out: Partial<Record<ContactFieldKey, string>> = {};
  for (const textValue of input.texts) {
    const facts = extractContactTextFacts(textValue);
    for (const [key, value] of Object.entries(facts) as Array<[keyof ContactTextFacts, string]>) {
      // The company name stays the Firmenprofil's Anzeigename: on real Impressum pages the legal-form
      // pattern also hits the liability insurer or the web agency („R+V Versicherung AG“).
      if (key === "firmenname") continue;
      if (value && !out[key]) out[key] = value;
    }
  }
  const { links } = input;
  const landline = links.phones.find((p) => !isMobileNumber(p) && phoneDigits(p) !== phoneDigits(out.fax ?? ""));
  const mobile = links.phones.find((p) => isMobileNumber(p));
  // The same number in the text keeps the site's own spelling („0221 12345678“ rather than „+4922112345678“).
  if (landline && phoneDigits(landline) !== phoneDigits(out.telefon ?? "")) out.telefon = landline;
  if (mobile && phoneDigits(mobile) !== phoneDigits(out.mobil ?? "")) out.mobil = mobile;
  if (out.mobil && out.telefon && phoneDigits(out.mobil) === phoneDigits(out.telefon)) delete out.telefon;
  const email = links.emails.find(isPublicEmail);
  if (email) out.email = email;
  const google = bestGoogleLink([...links.google, ...input.texts.flatMap((t) => extractGoogleProfileUrls(t))]);
  if (google) out.google_profil = google;
  if (links.facebook[0]) out.facebook = links.facebook[0];
  if (links.instagram[0]) out.instagram = links.instagram[0];
  if (links.linkedin[0]) out.linkedin = links.linkedin[0];
  if (links.youtube[0]) out.youtube = links.youtube[0];
  if (links.otherSocial.length > 0) out.social_sonstige = links.otherSocial.slice(0, 4).join("\n");
  return out;
}

// --- the optional extraction call on the cheap model -------------------------------------------------------

/** The cheap model for the one extraction call; the Texte check models follow as fallbacks. */
export const CONTACT_EXTRACTION_MODEL = "claude-haiku-4-5-20251001";
export const CONTACT_EXTRACTION_MAX_TOKENS = 1_200;
const MAX_EXTRACTION_TEXT_CHARS = 12_000;

const EXTRACTION_KEYS = ["ansprechpartner", "strasse", "plz", "ort", "telefon", "mobil", "fax", "email", "oeffnungszeiten"] as const;

export const CONTACT_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "submit_kontaktdaten",
  description: "Kontaktdaten genau so, wie sie im Text stehen. Leer lassen, was nicht dasteht.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(EXTRACTION_KEYS.map((key) => [key, { type: "string" }])),
    required: [...EXTRACTION_KEYS],
  },
};

export function contactExtractionPrompt(pages: ReadonlyArray<{ label: string; text: string }>): { system: string; user: string } {
  let budget = MAX_EXTRACTION_TEXT_CHARS;
  const parts: string[] = [];
  for (const page of pages) {
    if (budget <= 0) break;
    const body = page.text.trim().slice(0, budget);
    budget -= body.length;
    parts.push(`## ${page.label}\n${body}`);
  }
  return {
    system:
      "Du liest Impressum- und Kontaktseiten einer deutschen Firmenwebsite und überträgst die Kontaktdaten der Firma in die Felder. Nur, was wörtlich im Text steht; nichts ergänzen, nichts raten, keine Daten Dritter (Webdesigner, Hoster, Aufsichtsbehörde, Kammer). ansprechpartner: Inhaber oder Geschäftsführer mit Namen. oeffnungszeiten: kurz, z. B. „Mo–Fr 8–17 Uhr“. Leer lassen, was fehlt.",
    user: parts.join("\n\n"),
  };
}

function loose(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}@.]+/gu, "");
}

/**
 * The model's answer, field by field, kept only where the value is on the page: a phone by its
 * digits, everything else by its letters and digits. Nothing invented gets in.
 */
export function acceptExtractedContactValues(json: unknown, sourceText: string): ContactTextFacts {
  const r = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const hay = loose(sourceText);
  const hayDigits = sourceText.replace(/\D/g, "");
  const out: ContactTextFacts = {};
  for (const key of EXTRACTION_KEYS) {
    const value = typeof r[key] === "string" ? (r[key] as string).replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (!value) continue;
    if (key === "telefon" || key === "mobil" || key === "fax") {
      const digits = value.replace(/\D/g, "");
      if (digits.length >= 6 && hayDigits.includes(digits.replace(/^49/, ""))) out[key] = value;
      continue;
    }
    if (key === "oeffnungszeiten") {
      // Short forms („Mo–Fr 8–17 Uhr“) are a summary: every number in it must be on the page.
      const numbers = value.match(/\d+/g) ?? [];
      if (numbers.length > 0 && numbers.every((n) => hayDigits.includes(n))) out[key] = value;
      continue;
    }
    if (hay.includes(loose(value))) out[key] = value;
  }
  return out;
}

/** Fields of the extraction that the code may still fill (the cheap model never decides links). */
export function isExtractionField(key: string): key is (typeof EXTRACTION_KEYS)[number] {
  return (EXTRACTION_KEYS as readonly string[]).includes(key);
}


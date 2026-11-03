/**
 * The Google-Profil by web search, the pure parts. Only when the crawl found no Google link,
 * the field is empty and „Kein Google-Profil“ is not set: one search per organisation
 * (automatically after the crawl, or with the button „Google-Profil suchen“), at most 3 web
 * searches and 2 web fetches.
 *
 * The query is built from the public company name and the place only, never from internal
 * data. The model reports the profile it found with the name, address and phone shown there;
 * the code accepts it only when
 *   - the link is a Google Maps or business-profile link (no map search link) that the web
 *     search or fetch actually returned, and
 *   - the name matches the Kontaktdaten and so does the address (PLZ or street) or the phone,
 *     which the model was not told.
 * An accepted link is saved with source „websuche“ („aus Websuche – bitte prüfen“).
 */

import type Anthropic from "@anthropic-ai/sdk";

import { contactFieldText, phoneDigits, type OrgContactData } from "@/lib/dt/contact-data";
import { DT_WEB_RESEARCH_TOOLS } from "@/lib/dt/seo/web-research";
import { extractGoogleProfileUrls } from "@/lib/surveys/org-crawl-prefill";

export const GOOGLE_SEARCH_MAX_SEARCHES = 3;
export const GOOGLE_SEARCH_MAX_FETCHES = 2;
export const GOOGLE_SEARCH_MAX_TOKENS = 1_500;

/** The web tools of the Aktualitätsprüfung with the small limits of this search. */
export const GOOGLE_SEARCH_TOOLS: Anthropic.ToolUnion[] = DT_WEB_RESEARCH_TOOLS.map((tool) => {
  if ((tool as { name?: string }).name === "web_search") return { ...tool, max_uses: GOOGLE_SEARCH_MAX_SEARCHES } as Anthropic.ToolUnion;
  if ((tool as { name?: string }).name === "web_fetch") return { ...tool, max_uses: GOOGLE_SEARCH_MAX_FETCHES } as Anthropic.ToolUnion;
  return tool;
});

export type GoogleSearchInput = { name: string; place: string };

/** Name and place for the query, or why the search cannot run. */
export function googleSearchInput(data: Pick<OrgContactData, "fields">): { ok: true; input: GoogleSearchInput } | { ok: false; reason: string } {
  const name = contactFieldText(data, "firmenname");
  const place = contactFieldText(data, "ort") || contactFieldText(data, "plz");
  if (!name || !place) {
    return { ok: false, reason: "Für die Suche fehlen Firmenname und Ort in den Kontaktdaten." };
  }
  if (!contactFieldText(data, "strasse") && !contactFieldText(data, "plz") && !contactFieldText(data, "telefon") && !contactFieldText(data, "mobil")) {
    return { ok: false, reason: "Ein Treffer ließe sich nicht prüfen: In den Kontaktdaten fehlen Adresse und Telefon." };
  }
  return { ok: true, input: { name, place } };
}

/** The only search text: public name and place. */
export function googleSearchQuery(input: GoogleSearchInput): string {
  return `${input.name} ${input.place}`.replace(/\s+/g, " ").trim();
}

export function googleSearchPrompt(input: GoogleSearchInput): { system: string; user: string; maxTokens: number } {
  const query = googleSearchQuery(input);
  return {
    maxTokens: GOOGLE_SEARCH_MAX_TOKENS,
    system: [
      "Du suchst das Google-Unternehmensprofil (Google Maps) einer Firma. Du hast höchstens 3 Websuchen und 2 Web-Abrufe.",
      `Suchanfragen enthalten nur den Firmennamen und den Ort, z. B. „${query}“ oder „${query} Google Maps“. Keine anderen Angaben.`,
      "Gesucht ist ein Link auf das Profil oder den Ort bei Google Maps (google.com/maps/place/…, maps.app.goo.gl/…, g.page/…, maps.google.com/?cid=…). Kein Link auf eine Kartensuche, keine Bewertungsportale, keine Branchenverzeichnisse.",
      "Übernimm nur einen Link, den die Websuche oder der Web-Abruf wörtlich geliefert hat. Erfinde keinen Link und baue keinen zusammen.",
      'Antworte zum Schluss mit genau einer Zeile JSON: {"url": "…", "name": "…", "address": "…", "phone": "…"} mit Name, Adresse und Telefon, wie sie beim Profil stehen. Hast du kein Profil gefunden: {"url": ""}.',
    ].join("\n"),
    user: `Firma: ${input.name}\nOrt: ${input.place}`,
  };
}

export type GoogleCandidate = { url: string; name: string; address: string; phone: string };

/** The last JSON object of the answer; null when there is none or it has no link. */
export function parseGoogleSearchAnswer(text: string): GoogleCandidate | null {
  const matches = [...text.matchAll(/\{[^{}]*"url"[^{}]*\}/g)];
  for (const match of matches.reverse()) {
    try {
      const r = JSON.parse(match[0]) as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!url) return null;
      const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
      return { url, name: s(r.name), address: s(r.address), phone: s(r.phone) };
    } catch {
      continue;
    }
  }
  return null;
}

/** A Google Maps or business-profile link; a map search („/maps/search“, „?q=“ only) is none. */
export function isGoogleProfileLink(url: string): boolean {
  const found = extractGoogleProfileUrls(url)[0];
  if (!found) return false;
  if (/\/maps\/(?:search|dir)\b/i.test(found)) return false;
  if (/maps\.google\.[a-z.]+\/?(?:maps)?\?(?:.*&)?q=/i.test(found) && !/[?&]cid=/i.test(found)) return false;
  return true;
}

/**
 * The Google links the research returned: result and fetched URLs that are Google links, and
 * Google links inside the text of a fetched page (a directory or the company's own social
 * profile often links the Maps entry). Never a link the model only wrote.
 */
export function googleLinksFromResearch(blocks: readonly unknown[], returnedUrls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const url of returnedUrls) for (const link of extractGoogleProfileUrls(url)) out.add(link);
  for (const raw of blocks) {
    const block = raw as { type?: string; content?: { type?: string; content?: { source?: { data?: unknown } } } } | null;
    if (block?.type !== "web_fetch_tool_result" || block.content?.type !== "web_fetch_result") continue;
    const data = block.content.content?.source?.data;
    if (typeof data === "string") for (const link of extractGoogleProfileUrls(data)) out.add(link);
  }
  return [...out];
}

function sameLink(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/^https?:\/\/(?:www\.)?/i, "").replace(/[/#]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

const LEGAL_WORDS = new Set(["gmbh", "mbh", "ug", "ag", "kg", "ohg", "gbr", "ek", "e", "k", "co", "und", "partg", "mbb", "inh", "inhaber", "haftungsbeschränkt", "the"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !LEGAL_WORDS.has(t));
}

/** Most of the significant words of our name appear in the profile's name. */
export function googleNameMatches(ours: string, theirs: string): boolean {
  const mine = nameTokens(ours);
  const other = new Set(nameTokens(theirs));
  if (mine.length === 0 || other.size === 0) return false;
  const hits = mine.filter((t) => other.has(t)).length;
  return hits >= Math.max(1, Math.ceil(mine.length * 0.6));
}

function streetName(street: string): string {
  return street.toLowerCase().replace(/str(?:aße|asse|\.)/g, "str").replace(/[^\p{L}]+/gu, "");
}

export function googleAddressMatches(data: Pick<OrgContactData, "fields">, address: string): boolean {
  if (!address.trim()) return false;
  const plz = contactFieldText(data, "plz");
  const street = contactFieldText(data, "strasse");
  if (plz && address.includes(plz)) return true;
  const streetKey = streetName(street);
  return streetKey.length >= 5 && streetName(address).includes(streetKey);
}

export function googlePhoneMatches(data: Pick<OrgContactData, "fields">, phone: string): boolean {
  const theirs = phoneDigits(phone);
  if (theirs.length < 6) return false;
  return (["telefon", "mobil"] as const).some((key) => {
    const ours = phoneDigits(contactFieldText(data, key));
    return ours.length >= 6 && (ours.endsWith(theirs.slice(-7)) || theirs.endsWith(ours.slice(-7)));
  });
}

/**
 * Whether the reported profile may be saved. `returnedUrls` are the URLs the web search and
 * fetch returned (`inspectResearchBlocks`); the answer text is not one of them.
 */
export function acceptGoogleCandidate(
  candidate: GoogleCandidate | null,
  data: Pick<OrgContactData, "fields">,
  returnedUrls: readonly string[],
): { ok: true; url: string } | { ok: false; reason: string } {
  if (!candidate) return { ok: false, reason: "Nicht gefunden." };
  if (!isGoogleProfileLink(candidate.url)) {
    return { ok: false, reason: "Der Treffer ist kein Link auf ein Google-Profil oder Google Maps." };
  }
  if (!returnedUrls.some((u) => sameLink(u, candidate.url))) {
    return { ok: false, reason: "Der Link stammt nicht aus den Suchergebnissen." };
  }
  if (!googleNameMatches(contactFieldText(data, "firmenname"), candidate.name)) {
    return { ok: false, reason: `Der Name im Profil („${candidate.name || "—"}“) passt nicht zum Firmennamen.` };
  }
  if (!googleAddressMatches(data, candidate.address) && !googlePhoneMatches(data, candidate.phone)) {
    return { ok: false, reason: "Adresse und Telefon im Profil passen nicht zu den Kontaktdaten." };
  }
  return { ok: true, url: extractGoogleProfileUrls(candidate.url)[0] ?? candidate.url };
}

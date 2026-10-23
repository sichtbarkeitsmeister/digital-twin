/**
 * Reads an existing grounding page (HTML, JSON-LD, <dl> fact lists, FAQ) and its llms.txt
 * into the fact model, and checks the page against the v1.7 structure. Deterministic and
 * pure: the semantic comparison of descriptions happens later with Claude.
 */

import * as cheerio from "cheerio";

import {
  deriveGroundingPageLiveFacts,
  extractGroundingPageHtml,
} from "@/lib/dt/seo/detect-grounding-page-date";
import {
  GROUNDING_LEGACY_PATTERNS,
  GROUNDING_STANDARD_VERSION,
} from "@/lib/dt/prompts/grounding-page-standard";
import {
  DEFAULT_ONTOLOGY_CLASS,
  DEFAULT_SCHEMA_TYPE,
  FACT_KEY_DEFS,
  GROUNDING_FACT_MODEL_VERSION,
  type EntityKind,
  type FactKey,
  type GroundingEntity,
  type GroundingFact,
  type GroundingFactModel,
  type GroundingFaq,
  LOCAL_BUSINESS_TYPES,
  factKeyAllowed,
  isVolatileKey,
  looseText,
  normalizeLegalForm,
  slugify,
} from "@/lib/dt/seo/grounding-check/fact-model";
import {
  type JsonLdNode,
  hasType,
  parseJsonLdFromHtml,
  textOf,
  typesOf,
  valuesOf,
} from "@/lib/dt/seo/grounding-check/jsonld";
import { looseName, normalizeFactValue, splitStand } from "@/lib/dt/seo/grounding-check/normalize";
import { jsonLdValuesNotVisible } from "@/lib/dt/seo/grounding-check/validate";

export type StructuralIssue = {
  code: string;
  message: string;
  severity: "high" | "medium" | "low";
};

const ORG_TYPES = ["Organization", "Corporation", "NGO", "EducationalOrganization", ...LOCAL_BUSINESS_TYPES];

/** Keys that hold several values; their <dd> is split at „·“, „;“ and line breaks. */
const MULTI_KEYS = new Set<FactKey>([
  "alternateName",
  "founder",
  "managingDirector",
  "owner",
  "areaServed",
  "certification",
  "award",
  "membership",
  "sameAs",
  "feature",
  "expertise",
  "qualification",
  "scope",
]);

// --- entity builder ----------------------------------------------------------------------------

type Draft = GroundingEntity & { aliases: Set<string> };

class EntityBook {
  readonly drafts: Draft[] = [];
  private readonly ids = new Set<string>();

  constructor(private readonly organisationName: string) {}

  find(name: string, kind?: EntityKind): Draft | null {
    const key = looseName(name);
    if (!key) return null;
    if (kind === "organization" || key === looseName(this.organisationName)) {
      const org = this.drafts.find((d) => d.kind === "organization");
      if (org && (kind === "organization" || org.aliases.has(key))) return org;
    }
    return this.drafts.find((d) => d.aliases.has(key) && (!kind || d.kind === kind || kind === "other")) ?? null;
  }

  get(name: string, kind: EntityKind, schemaType?: string): Draft {
    const existing = this.find(name, kind);
    if (existing) {
      existing.aliases.add(looseName(name));
      return existing;
    }
    let id = kind === "organization" && !this.drafts.some((d) => d.kind === "organization") ? "organisation" : slugify(name) || "entitaet";
    for (let n = 2; this.ids.has(id); n++) id = `${slugify(name)}-${n}`;
    this.ids.add(id);
    const draft: Draft = {
      id,
      kind,
      ontologyClass: DEFAULT_ONTOLOGY_CLASS[kind],
      schemaType: schemaType ?? DEFAULT_SCHEMA_TYPE[kind],
      name,
      definition: "",
      definitionSourceUrl: null,
      disambiguation: [],
      facts: [],
      included: true,
      aliases: new Set([looseName(name)]),
    };
    if (kind === "organization") this.drafts.unshift(draft);
    else this.drafts.push(draft);
    return draft;
  }

  addFact(entity: Draft, key: FactKey, rawValue: string, sourceUrl: string, quote: string) {
    if (!factKeyAllowed(key, entity.kind)) return;
    const stand = splitStand(rawValue);
    const value = (key === "legalForm" ? normalizeLegalForm(stand.value) : stand.value).trim().slice(0, 600);
    if (!value) return;
    const norm = normalizeFactValue(FACT_KEY_DEFS[key].valueType, value);
    if (entity.facts.some((f) => f.key === key && normalizeFactValue(FACT_KEY_DEFS[key].valueType, f.value) === norm)) return;
    const volatile = isVolatileKey(key) || stand.asOf !== null;
    const fact: GroundingFact = {
      id: `${entity.id}-${key}-${entity.facts.filter((f) => f.key === key).length + 1}`,
      key,
      value,
      sourceUrl,
      quote: quote.replace(/\s+/g, " ").trim().slice(0, 400),
      volatile,
      asOf: volatile ? stand.asOf : null,
      included: true,
    };
    entity.facts.push(fact);
  }

  setDefinition(entity: Draft, text: string, sourceUrl: string) {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && !entity.definition) {
      entity.definition = t.slice(0, 1200);
      entity.definitionSourceUrl = sourceUrl;
    }
  }

  addDisambiguation(entity: Draft, text: string) {
    const t = text.replace(/\s+/g, " ").trim().slice(0, 600);
    if (t && entity.disambiguation.length < 6 && !entity.disambiguation.some((d) => looseText(d) === looseText(t))) {
      entity.disambiguation.push(t);
    }
  }

  entities(): GroundingEntity[] {
    return this.drafts.map((d) => {
      const { aliases: _aliases, ...entity } = d;
      void _aliases;
      return entity;
    });
  }
}

// --- JSON-LD -----------------------------------------------------------------------------------

/** Top-level nodes (documents and @graph members) merged by @id. */
function primaryNodes(documents: unknown[]): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const byId = new Map<string, JsonLdNode>();
  const push = (node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const n = node as JsonLdNode;
    if (Array.isArray(n["@graph"])) {
      for (const member of n["@graph"] as unknown[]) push(member);
      return;
    }
    if (!n["@type"]) return;
    const id = typeof n["@id"] === "string" ? n["@id"] : null;
    if (id && byId.has(id)) {
      const prev = byId.get(id)!;
      for (const [k, v] of Object.entries(n)) if (prev[k] === undefined) prev[k] = v;
      return;
    }
    const copy = { ...n };
    if (id) byId.set(id, copy);
    out.push(copy);
  };
  for (const doc of documents) {
    if (Array.isArray(doc)) doc.forEach(push);
    else push(doc);
  }
  return out;
}

function kindOfNode(node: JsonLdNode, hasOrg: boolean, origin: string): EntityKind | null {
  if (hasType(node, ["Person"])) return "person";
  if (hasType(node, ["Service"])) return "service";
  if (hasType(node, ["Product", "SoftwareApplication"])) return "product";
  if (hasType(node, ["DefinedTerm", "HowTo"])) return "method";
  if (hasType(node, ORG_TYPES)) {
    const id = typeof node["@id"] === "string" ? node["@id"] : "";
    if (!hasOrg || id === `${origin}/#organization`) return "organization";
    return hasType(node, LOCAL_BUSINESS_TYPES) ? "location" : null;
  }
  if (hasType(node, ["Place"])) return "location";
  return null;
}

function addressText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const street = typeof a.streetAddress === "string" ? a.streetAddress.trim() : "";
  const city = [a.postalCode, a.addressLocality].filter((x) => typeof x === "string" && x.trim()).join(" ");
  return [street, city].filter(Boolean).join(", ") || null;
}

const NODE_PROPERTY_KEYS: Array<[string, FactKey]> = [
  ["legalName", "legalName"],
  ["alternateName", "alternateName"],
  ["vatID", "vatId"],
  ["foundingDate", "foundingDate"],
  ["founder", "founder"],
  ["telephone", "phone"],
  ["faxNumber", "fax"],
  ["email", "email"],
  ["url", "website"],
  ["openingHours", "openingHours"],
  ["areaServed", "areaServed"],
  ["numberOfEmployees", "employeeCount"],
  ["keywords", "industry"],
  ["hasCertification", "certification"],
  ["award", "award"],
  ["memberOf", "membership"],
  ["sameAs", "sameAs"],
  ["priceRange", "priceRange"],
  ["amenityFeature", "feature"],
  ["jobTitle", "jobTitle"],
  ["knowsAbout", "expertise"],
  ["hasCredential", "qualification"],
  ["serviceType", "serviceType"],
  ["category", "serviceType"],
  ["audience", "audience"],
];

function readNode(book: EntityBook, entity: Draft, node: JsonLdNode, sourceUrl: string) {
  const add = (key: FactKey, value: string | null, prop: string) => {
    if (value) book.addFact(entity, key, value, sourceUrl, `JSON-LD ${prop}: ${value}`);
  };
  for (const [prop, key] of NODE_PROPERTY_KEYS) {
    for (const v of valuesOf(node, prop)) add(key, textOf(v), prop);
  }
  for (const v of valuesOf(node, "address")) add("address", addressText(v), "address");
  for (const v of valuesOf(node, "identifier")) {
    // PropertyValue: the number is in `value`, `name`/`propertyID` say which register.
    const text = v && typeof v === "object" ? (textOf((v as JsonLdNode).value) ?? textOf(v)) : textOf(v);
    const label = v && typeof v === "object" ? `${textOf((v as JsonLdNode).propertyID) ?? ""} ${textOf((v as JsonLdNode).name) ?? ""}` : "";
    if (text && (/hr[ab]|handelsregister|register/i.test(label) || /\bHR[AB]\b/i.test(text))) {
      add("registerEntry", /\bHR[AB]\b/i.test(text) ? text : `HRB ${text}`, "identifier");
    }
  }
  for (const v of valuesOf(node, "employee")) {
    const name = textOf(v);
    const title = v && typeof v === "object" ? textOf((v as JsonLdNode).jobTitle) ?? "" : "";
    add(/inhaber/i.test(title) ? "owner" : "managingDirector", name, "employee");
  }
  for (const v of valuesOf(node, "offers")) {
    if (!v || typeof v !== "object") continue;
    const o = v as JsonLdNode;
    const price = textOf(o.price);
    add("price", price ? `${price}${typeof o.priceCurrency === "string" ? ` ${o.priceCurrency}` : ""}` : textOf(o.description), "offers");
  }
  for (const v of valuesOf(node, "hasOfferCatalog")) {
    if (!v || typeof v !== "object") continue;
    for (const item of valuesOf(v as JsonLdNode, "itemListElement")) {
      const offered = item && typeof item === "object" ? ((item as JsonLdNode).itemOffered ?? item) : item;
      const name = textOf(offered);
      if (!name) continue;
      if (entity.kind === "service" || entity.kind === "product") add("scope", name, "hasOfferCatalog");
      else if (entity.kind === "organization") book.get(name, "service");
    }
  }
  for (const v of valuesOf(node, "aggregateRating")) {
    if (!v || typeof v !== "object") continue;
    const r = v as JsonLdNode;
    const value = textOf(r.ratingValue);
    if (value) add("rating", `${value}${r.bestRating ? ` von ${textOf(r.bestRating)}` : ""}`, "aggregateRating");
  }
  const description = textOf(node.description);
  if (description) book.setDefinition(entity, description, sourceUrl);
  const disambiguation = textOf(node.disambiguatingDescription);
  if (disambiguation) book.addDisambiguation(entity, disambiguation);
}

// --- HTML <dl> -----------------------------------------------------------------------------------

const LABEL_KEYS: Array<[RegExp, FactKey]> = [
  [/^(offizieller name|firmierung|firma|vollständiger firmenname|rechtlicher name)$/, "legalName"],
  [/^(auch bekannt als|kurzname|abkürzung|kurzform|markenname)$/, "alternateName"],
  [/^rechtsform$/, "legalForm"],
  [/^(handelsregister|registernummer|registergericht|register|hrb|handelsregisternummer)$/, "registerEntry"],
  [/^(umsatzsteuer-?id|ust-?idnr\.?|ust-?id|umsatzsteuer-identifikationsnummer)$/, "vatId"],
  [/^(gründung|gegründet|gründungsjahr|gründungsdatum|seit)$/, "foundingDate"],
  [/^(gründer|gründerin|gründung durch)$/, "founder"],
  [/^(geschäftsführer|geschäftsführerin|geschäftsführung|vertreten durch|vertretungsberechtigt)$/, "managingDirector"],
  [/^(inhaber|inhaberin)$/, "owner"],
  [/^(anschrift|adresse|sitz|hauptsitz|hauptstandort|standort|postanschrift)$/, "address"],
  [/^(telefon|tel\.?|telefonnummer|telefon direkt|phone)$/, "phone"],
  [/^(fax|telefax)$/, "fax"],
  [/^(e-?mail|e-?mail direkt|mail)$/, "email"],
  [/^(website|webseite|url|internet|homepage|seite|teamseite|profilseite)$/, "website"],
  [/^(öffnungszeiten|bürozeiten|sprechzeiten|geschäftszeiten|erreichbarkeit)$/, "openingHours"],
  [/^(einzugsgebiet|marktgebiet|region|tätigkeitsgebiet|servicegebiet|einsatzgebiet)$/, "areaServed"],
  [/^(mitarbeiter|mitarbeiterzahl|mitarbeitende|teamgröße|beschäftigte|anzahl mitarbeiter)$/, "employeeCount"],
  [/^(branche|tätigkeitsfeld|wirtschaftszweig)$/, "industry"],
  [/^(zertifizierung|zertifizierungen|zertifikat|zertifikate)$/, "certification"],
  [/^(auszeichnung|auszeichnungen|preise)$/, "award"],
  [/^(mitgliedschaft|mitgliedschaften|verband|partnerprogramm|partnerstatus|partner)$/, "membership"],
  [/^(soziale profile|profile|social media|linkedin|xing|instagram|facebook|youtube)$/, "sameAs"],
  [/^(google-bewertung|bewertung|bewertungen|bewertungsstand|kundenbewertung)$/, "rating"],
  [/^(preisspanne)$/, "priceRange"],
  [/^(ausstattung|merkmale|barrierefreiheit|parken)$/, "feature"],
  [/^(funktion|position|rolle|tätigkeit)$/, "jobTitle"],
  [/^(expertise|fachgebiet|fachgebiete|schwerpunkt|schwerpunkte)$/, "expertise"],
  [/^(qualifikation|qualifikationen|ausbildung|abschluss)$/, "qualification"],
  [/^(art|leistungsart|typ)$/, "serviceType"],
  [/^(leistungsumfang|leistungsinhalt|leistungen|umfang|bestandteile)$/, "scope"],
  [/^(zielgruppe|zielgruppen|kundenprofil)$/, "audience"],
  [/^(preis|preise|kosten)$/, "price"],
];

export function labelToFactKey(label: string): FactKey | null {
  const t = looseText(label).replace(/[:.]$/, "").trim();
  for (const [pattern, key] of LABEL_KEYS) if (pattern.test(t)) return key;
  return null;
}

const HEADING_CLASS_PREFIX: Record<string, EntityKind> = {
  methode: "method",
  konzept: "method",
  verfahren: "method",
  ort: "location",
  standort: "location",
  filiale: "location",
  produkt: "product",
  leistung: "service",
  dienstleistung: "service",
  person: "person",
  referenz: "other",
  zielgruppe: "other",
  marktsegment: "other",
  wissensgebiet: "other",
  standard: "other",
  metrik: "other",
};

const GENERIC_HEADING =
  /^(kernfakten|kerndaten|fakten|steckbrief|überblick|abgrenzung|faq|häufige fragen|vertrauenssignale|entitätszusammenfassung|nicht identisch mit|stabile .*|quellen.*|weiterführende informationen)$/i;

/** The entity a heading talks about, by the patterns grounding pages use. */
export function entityFromHeading(heading: string, organisationName: string): { name: string; kind: EntityKind | null } {
  const text = heading.replace(/\s+/g, " ").trim();
  const m = text.match(/^(.+?):\s*(.+)$/);
  if (m) {
    const a = m[1]!.trim();
    const b = m[2]!.trim();
    const prefixKind = HEADING_CLASS_PREFIX[looseText(a)];
    if (prefixKind) return { name: b, kind: prefixKind };
    if (GENERIC_HEADING.test(b)) return { name: a, kind: null };
    if (looseName(a) === looseName(organisationName)) return { name: b, kind: null };
    return { name: a, kind: null };
  }
  const of = text.match(/^(kerndaten|kernfakten|fakten|steckbrief|leistungen|abgrenzung|geschichte|standorte|häufige fragen)\s+(von|zu|der|des|über)\s+(.+)$/i);
  if (of) return { name: of[3]!.trim(), kind: null };
  return { name: text, kind: null };
}

function guessKind(labels: FactKey[]): EntityKind {
  if (labels.includes("jobTitle") || labels.includes("expertise") || labels.includes("qualification")) return "person";
  if (labels.includes("scope") || labels.includes("serviceType") || labels.includes("audience") || labels.includes("price")) return "service";
  if (labels.includes("openingHours") || labels.includes("address")) return "location";
  return "other";
}

function splitMulti(value: string): string[] {
  return value
    .split(/\s+·\s+|;\s*|\n+|\s+\|\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function readHtml(book: EntityBook, html: string, sourceUrl: string, organisationName: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, nav, footer, template, svg").remove();
  const root = $("main").length ? $("main").first() : $("body");
  let heading = organisationName;

  for (const el of root.find("h1, h2, h3, h4, dl").toArray()) {
    if (el.tagName !== "dl") {
      heading = $(el).text().replace(/\s+/g, " ").trim() || heading;
      continue;
    }
    const pairs: Array<{ label: string; key: FactKey; text: string; hrefs: string[] }> = [];
    for (const dt of $(el).find("dt").toArray()) {
      const label = $(dt).text().replace(/\s+/g, " ").trim();
      const key = labelToFactKey(label);
      const dd = $(dt).nextAll("dd").first();
      if (!key || !dd.length) continue;
      const hrefs = dd
        .find("a[href]")
        .toArray()
        .map((a) => ($(a).attr("href") ?? "").trim())
        .filter((h) => /^https?:\/\//i.test(h));
      $(dd).find(".stand").each((_, s) => {
        $(s).replaceWith(` (${$(s).text().replace(/^[\s(]+|[\s)]+$/g, "")})`);
      });
      pairs.push({ label, key, text: dd.text().replace(/\s+/g, " ").trim(), hrefs });
    }
    if (pairs.length === 0) continue;

    const target = entityFromHeading(heading, organisationName);
    const isOrg = looseName(target.name) === looseName(organisationName);
    const kind: EntityKind = isOrg ? "organization" : (target.kind ?? guessKind(pairs.map((p) => p.key)));
    const entity = book.get(isOrg ? organisationName : target.name, kind);
    for (const pair of pairs) {
      const values =
        pair.key === "sameAs" && pair.hrefs.length > 0 ? pair.hrefs : MULTI_KEYS.has(pair.key) ? splitMulti(pair.text) : [pair.text];
      for (const value of values) book.addFact(entity, pair.key, value, sourceUrl, `${pair.label}: ${pair.text}`);
    }
  }
}

/** FAQ from FAQPage JSON-LD and from the visible „FAQ“ / „Häufige Fragen“ section. */
function readFaq(html: string, nodes: JsonLdNode[], sourceUrl: string): GroundingFaq[] {
  const out: GroundingFaq[] = [];
  const push = (question: string, answer: string) => {
    const q = question.replace(/\s+/g, " ").trim();
    const a = answer.replace(/\s+/g, " ").trim();
    if (q.length < 5 || a.length < 5 || out.some((f) => looseText(f.question) === looseText(q))) return;
    out.push({ id: `faq-${slugify(q).slice(0, 50)}-${out.length + 1}`, question: q.slice(0, 300), answer: a.slice(0, 1200), sourceUrl, quote: q.slice(0, 400), included: true });
  };
  for (const node of nodes.filter((n) => hasType(n, ["FAQPage"]))) {
    for (const q of valuesOf(node, "mainEntity")) {
      if (!q || typeof q !== "object") continue;
      const question = textOf((q as JsonLdNode).name);
      const answer = textOf((q as JsonLdNode).acceptedAnswer);
      if (question && answer) push(question, answer);
    }
  }

  const $ = cheerio.load(html);
  $("script, style, noscript, header, nav, footer").remove();
  const items = $("h1, h2, h3, h4, h5, p").toArray();
  let faqLevel = 0;
  let question: string | null = null;
  let answer: string[] = [];
  const flush = () => {
    if (question && answer.length > 0) push(question, answer.join(" "));
    question = null;
    answer = [];
  };
  for (const el of items) {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/^h\d$/.test(tag)) {
      const level = Number(tag[1]);
      if (/\b(faq|häufige fragen|häufig gestellte fragen)\b/i.test(text)) {
        flush();
        faqLevel = level;
        continue;
      }
      if (faqLevel && level <= faqLevel) {
        flush();
        faqLevel = 0;
        continue;
      }
      if (faqLevel) {
        flush();
        question = text;
      }
      continue;
    }
    if (faqLevel && question && text) answer.push(text);
  }
  flush();
  return out.slice(0, 20);
}

/** Abgrenzung sections: paragraphs under a heading about distinction. */
function readDisambiguation(book: EntityBook, html: string, organisationName: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, nav, footer").remove();
  let current: Draft | null = null;
  for (const el of $("h1, h2, h3, h4, p, dd").toArray()) {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/^h\d$/i.test(el.tagName)) {
      current = null;
      if (/abgrenzung|nicht identisch|nicht zu verwechseln/i.test(text)) {
        const target = entityFromHeading(text, organisationName);
        current = book.find(target.name) ?? book.find(organisationName, "organization");
      }
      continue;
    }
    if (current && text) book.addDisambiguation(current, text);
  }
}

// --- llms.txt ------------------------------------------------------------------------------------

const LLMS_CLASS_KIND: Array<[RegExp, EntityKind]> = [
  [/^(organi[sz]ation|localbusiness|professionalservice)$/, "organization"],
  [/^person$/, "person"],
  [/^service$/, "service"],
  [/^(product|tool\/platform|tool|platform)$/, "product"],
  [/^(place|location|standort)$/, "location"],
  [/^(method|concept|concept\/method|methode|konzept)$/, "method"],
];

/** House-style sections say more than „class:“ (a branch is class Organization under STANDORTE). */
const LLMS_SECTION_KIND: Array<[RegExp, EntityKind]> = [
  [/^organi[sz]ation/, "organization"],
  [/^person/, "person"],
  [/^(leistungen|dienstleistungen|services)/, "service"],
  [/^produkte/, "product"],
  [/^standort/, "location"],
  [/^(methoden|konzepte)/, "method"],
];

const LLMS_KEY_ALIASES: Record<string, FactKey> = {
  name_official: "legalName",
  legal_name: "legalName",
  name_short: "alternateName",
  name_abbreviation: "alternateName",
  alternate_name: "alternateName",
  partner: "membership",
  partner_status: "membership",
  google_rating: "rating",
  website: "website",
  opening_hours: "openingHours",
  area_served: "areaServed",
  region: "areaServed",
  size: "employeeCount",
  ceo: "managingDirector",
  phone_direct: "phone",
  email_direct: "email",
  linkedin: "sameAs",
};

function llmsKeyToFactKey(key: string): FactKey | null {
  const k = key.toLowerCase();
  if (LLMS_KEY_ALIASES[k]) return LLMS_KEY_ALIASES[k]!;
  if (k.startsWith("social_")) return "sameAs";
  if (k.startsWith("address")) return "address";
  for (const [factKey, def] of Object.entries(FACT_KEY_DEFS)) {
    if (def.llmsKey === k) return factKey as FactKey;
  }
  return null;
}

/**
 * House-style llms.txt: blocks of „key: value“ lines that start with „entity:“ and „class:“,
 * separated by „---“ or „## SECTION“; „  - item“ lines continue the previous key.
 */
function readLlmsTxt(book: EntityBook, text: string, sourceUrl: string) {
  let entity: Draft | null = null;
  let entityName: string | null = null;
  let lastKey: string | null = null;
  let pending: Array<[string, string]> = [];
  let sectionKind: EntityKind | null = null;

  const apply = (target: Draft, key: string, value: string) => {
    if (key === "disambiguation") return book.addDisambiguation(target, value);
    if (key === "description" || key === "definition" || key === "concept") return book.setDefinition(target, value, sourceUrl);
    const factKey = llmsKeyToFactKey(key);
    if (factKey) book.addFact(target, factKey, value, sourceUrl, `${key}: ${value}`);
  };
  /** Create the entity of the current block (once its class is known) and apply what waited. */
  const open = (name: string, kind: EntityKind): Draft => {
    const target = book.get(name, kind);
    for (const [key, value] of pending) apply(target, key, value);
    pending = [];
    return target;
  };
  const close = () => {
    if (!entity && entityName) open(entityName, "other");
    entity = null;
    entityName = null;
    lastKey = null;
    pending = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      close();
      const title = section[1]!.toLowerCase();
      sectionKind = LLMS_SECTION_KIND.find(([re]) => re.test(title))?.[1] ?? null;
      continue;
    }
    if (/^\s*---\s*$/.test(line)) {
      close();
      continue;
    }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && lastKey) {
      const value = item[1]!.replace(/\s*\(url:[^)]*\)\s*$/, "").trim();
      if (entity) apply(entity, lastKey, value);
      else if (entityName) pending.push([lastKey, value]);
      continue;
    }
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (key === "entity") {
      close();
      entityName = value;
      continue;
    }
    lastKey = key;
    if (!entityName) continue;
    if (key === "class" && !entity) {
      const cls = value.toLowerCase();
      const classKind = LLMS_CLASS_KIND.find(([re]) => re.test(cls))?.[1] ?? "other";
      entity = open(entityName, sectionKind && sectionKind !== "organization" ? sectionKind : classKind);
      continue;
    }
    if (!value) continue;
    if (entity) apply(entity, key, value);
    else pending.push([key, value]);
  }
  close();
}

// --- public API ----------------------------------------------------------------------------------

export type ExistingPageInput = {
  pageUrl: string;
  html: string | null;
  llmsUrl: string | null;
  llmsTxt: string | null;
  organisationName: string;
  websiteUrl: string;
};

/** The existing grounding page and llms.txt as a fact model (source = page or llms.txt URL). */
export function parseExistingGroundingPage(input: ExistingPageInput): GroundingFactModel {
  const origin = (() => {
    try {
      return new URL(input.websiteUrl).origin;
    } catch {
      return input.websiteUrl;
    }
  })();
  const book = new EntityBook(input.organisationName);
  let faq: GroundingFaq[] = [];

  if (input.html) {
    const parsed = parseJsonLdFromHtml(input.html);
    const nodes = primaryNodes(parsed.documents);
    let hasOrg = false;
    for (const node of nodes) {
      const kind = kindOfNode(node, hasOrg, origin);
      const name = textOf(node.name);
      if (!kind || !name) continue;
      const types = typesOf(node);
      const schemaType = types.find((t) => t !== "Organization") ?? types[0];
      const entity = book.get(kind === "organization" ? input.organisationName : name, kind, schemaType);
      if (kind === "organization") {
        hasOrg = true;
        book.addFact(entity, "legalName", name, input.pageUrl, `JSON-LD name: ${name}`);
      }
      readNode(book, entity, node, input.pageUrl);
    }
    readHtml(book, input.html, input.pageUrl, input.organisationName);
    readDisambiguation(book, input.html, input.organisationName);
    faq = readFaq(input.html, parsed.nodes, input.pageUrl);
    // The lead paragraph defines the organisation when JSON-LD has no description.
    const org = book.find(input.organisationName, "organization");
    if (org && !org.definition) {
      const $ = cheerio.load(input.html);
      $("script, style, noscript, header, nav, footer").remove();
      const lead = $("h1").first().nextAll("p").first().text() || $("main p, body p").first().text();
      book.setDefinition(org, lead, input.pageUrl);
    }
  }
  if (input.llmsTxt && input.llmsUrl) readLlmsTxt(book, input.llmsTxt, input.llmsUrl);
  if (!book.find(input.organisationName, "organization")) book.get(input.organisationName, "organization");

  return {
    version: GROUNDING_FACT_MODEL_VERSION,
    organisationName: input.organisationName,
    websiteUrl: input.websiteUrl,
    pageUrl: input.pageUrl,
    language: "de-DE",
    entities: book.entities().slice(0, 60),
    faq,
    openPoints: [],
    prose: null,
  };
}

function versionLess(version: string | null, min: string): boolean {
  if (!version) return true;
  const [a1, a2] = version.split(".").map(Number);
  const [b1, b2] = min.split(".").map(Number);
  return (a1 ?? 0) < (b1 ?? 0) || ((a1 ?? 0) === (b1 ?? 0) && (a2 ?? 0) < (b2 ?? 0));
}

/** Where the existing page falls short of v1.7. Each finding alone makes an update necessary. */
export function checkExistingPageStructure(html: string, input: { pageUrl: string; websiteUrl: string }): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const add = (code: string, severity: StructuralIssue["severity"], message: string) => issues.push({ code, severity, message });
  const origin = (() => {
    try {
      return new URL(input.websiteUrl).origin;
    } catch {
      return "";
    }
  })();

  const jsonLd = parseJsonLdFromHtml(html);
  if (jsonLd.scriptCount === 0) add("no_jsonld", "high", "Kein JSON-LD auf der Seite: die strukturierte Spiegelung fehlt.");
  if (jsonLd.invalidScripts.length > 0) {
    add("jsonld_invalid", "high", `JSON-LD-Block ${jsonLd.invalidScripts.join(", ")} lässt sich nicht lesen (ungültiges JSON).`);
  }
  const webPage = jsonLd.nodes.find((n) => hasType(n, ["WebPage", "AboutPage", "ProfilePage", "FAQPage"]) && !hasType(n, ["FAQPage"]));
  if (jsonLd.scriptCount > 0 && !webPage) add("missing_webpage", "medium", "Kein WebPage-Objekt im JSON-LD (für dateModified, lastReviewed, reviewedBy).");
  if (webPage && typeof webPage.dateModified !== "string") add("missing_date_modified", "medium", "dateModified fehlt im WebPage-Objekt.");
  const org = jsonLd.nodes.find((n) => hasType(n, ORG_TYPES));
  if (org && origin && org["@id"] !== `${origin}/#organization`) {
    add("org_id", "low", `Die Organisation hat nicht die stabile @id ${origin}/#organization.`);
  }

  const live = deriveGroundingPageLiveFacts(extractGroundingPageHtml(html));
  if (!live.lastReviewed || !live.reviewedBy) {
    add("missing_review", "high", "reviewedBy und lastReviewed fehlen: keine dokumentierte menschliche Faktenprüfung (Pflicht seit v1.7).");
  }
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const visible = $("body").text().replace(/\s+/g, " ");
  if (!/Zuletzt von einem Menschen geprüft/i.test(visible)) {
    add("missing_review_notice", "high", "Sichtbarer Prüfhinweis „Fakten geprüft von … · Zuletzt von einem Menschen geprüft: …“ fehlt.");
  }
  if (live.reviewMismatch) add("review_mismatch", "high", "Prüfer oder Prüfdatum im sichtbaren Hinweis weichen vom JSON-LD ab.");
  if (versionLess(live.standardVersion, GROUNDING_STANDARD_VERSION)) {
    add(
      "standard_version",
      "medium",
      live.standardVersion
        ? `Die Seite nennt Grounding Page Standard v${live.standardVersion}, aktuell ist v${GROUNDING_STANDARD_VERSION}.`
        : "Die Seite nennt keine Version des Grounding Page Standards.",
    );
  }

  for (const legacy of GROUNDING_LEGACY_PATTERNS) {
    if (legacy.pattern.test(visible)) add(legacy.code, legacy.code === "ai_wording" ? "medium" : "high", legacy.message);
  }

  const headings = $("h1, h2, h3").toArray().map((h) => $(h).text().replace(/\s+/g, " ").trim());
  const h1 = $("h1").toArray();
  if (h1.length !== 1) add("h1", "medium", h1.length === 0 ? "Keine H1 mit dem Namen der Entität." : `${h1.length} H1-Überschriften statt einer.`);
  else if (/grounding/i.test($(h1[0]).text())) add("h1", "medium", "Die H1 nennt „Grounding“ statt nur den Namen der Entität.");

  const hasDisambiguation =
    headings.some((h) => /abgrenzung|nicht identisch|nicht zu verwechseln/i.test(h)) ||
    jsonLd.nodes.some((n) => typeof n.disambiguatingDescription === "string");
  if (!hasDisambiguation) add("missing_abgrenzung", "medium", "Keine Abgrenzung („was die Entität nicht ist“).");
  const hasFaq = headings.some((h) => /\b(faq|häufige fragen|häufig gestellte fragen)\b/i.test(h)) || jsonLd.nodes.some((n) => hasType(n, ["FAQPage"]));
  if (!hasFaq) add("missing_faq", "medium", "Kein FAQ-Abschnitt.");
  if (!headings.some((h) => /weiterführende informationen|quellen/i.test(h))) {
    add("missing_further_info", "low", "Kein Abschnitt „Weiterführende Informationen“ mit Quellen am Seitenende.");
  }
  if ($('meta[name="robots"]').toArray().some((m) => /noindex/i.test($(m).attr("content") ?? ""))) {
    add("noindex", "high", "Die Seite ist auf noindex gesetzt.");
  }

  const invisible = jsonLdValuesNotVisible(html);
  if (invisible.length > 0) {
    add(
      "mirror",
      "medium",
      `JSON-LD enthält ${invisible.length} ${invisible.length === 1 ? "Angabe" : "Angaben"}, die nicht sichtbar ${invisible.length === 1 ? "ist" : "sind"} (z. B. ${invisible
        .slice(0, 3)
        .map((v) => `${v.path}: „${v.value.slice(0, 60)}“`)
        .join("; ")}).`,
    );
  }
  return issues;
}

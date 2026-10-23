/**
 * The fact model of the Grounding check: entities with sourced facts, FAQ and open points.
 * The website, the existing grounding page and its llms.txt are all read into this shape,
 * so the diff, the HTML template, the llms.txt and the validator share one vocabulary.
 * Pure: no network, no Supabase.
 */

import { z } from "zod";

import {
  GROUNDING_ONTOLOGY_CLASS_NAMES,
  type GroundingOntologyClass,
} from "@/lib/dt/prompts/grounding-page-standard";

export const GROUNDING_FACT_MODEL_VERSION = 1;

export const ENTITY_KINDS = ["organization", "location", "person", "service", "product", "method", "other"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** How a value is compared in the diff. */
export type FactValueType = "text" | "name" | "phone" | "email" | "url" | "address" | "date" | "number";

type FactKeyDef = {
  label: string;
  /** Label for a kind where the default reads oddly. */
  labelByKind?: Partial<Record<EntityKind, string>>;
  llmsKey: string;
  kinds: readonly EntityKind[];
  valueType: FactValueType;
  /** Always carries „Stand: <Monat Jahr>“. */
  volatile?: boolean;
  /** Visible only, never in JSON-LD (self-serving ratings). */
  visibleOnly?: boolean;
};

const BUSINESS: readonly EntityKind[] = ["organization", "location"];
const OFFER: readonly EntityKind[] = ["service", "product"];

/**
 * Every fact key the model may use. A key only exists if it has a JSON-LD counterpart on
 * every kind it allows (see render-html.ts), so HTML and JSON-LD can mirror each other.
 */
export const FACT_KEY_DEFS = {
  legalName: { label: "Firmierung", llmsKey: "name_official", kinds: ["organization"], valueType: "name" },
  alternateName: { label: "Auch bekannt als", llmsKey: "name_short", kinds: [...BUSINESS, ...OFFER, "method"], valueType: "name" },
  legalForm: { label: "Rechtsform", llmsKey: "legal_form", kinds: ["organization"], valueType: "text" },
  registerEntry: { label: "Handelsregister", llmsKey: "register", kinds: ["organization"], valueType: "text" },
  vatId: { label: "USt-IdNr.", llmsKey: "vat_id", kinds: ["organization"], valueType: "text" },
  foundingDate: { label: "Gegründet", llmsKey: "founded", kinds: BUSINESS, valueType: "date" },
  founder: { label: "Gründung durch", llmsKey: "founder", kinds: ["organization"], valueType: "name" },
  managingDirector: { label: "Geschäftsführung", llmsKey: "managing_director", kinds: BUSINESS, valueType: "name" },
  owner: { label: "Inhaber", llmsKey: "owner", kinds: BUSINESS, valueType: "name" },
  address: { label: "Anschrift", llmsKey: "address", kinds: BUSINESS, valueType: "address" },
  phone: { label: "Telefon", llmsKey: "phone", kinds: [...BUSINESS, "person"], valueType: "phone" },
  fax: { label: "Fax", llmsKey: "fax", kinds: BUSINESS, valueType: "phone" },
  email: { label: "E-Mail", llmsKey: "email", kinds: [...BUSINESS, "person"], valueType: "email" },
  website: {
    label: "Website",
    labelByKind: { service: "Seite", product: "Seite", method: "Seite", other: "Seite", person: "Profilseite" },
    llmsKey: "url",
    kinds: ENTITY_KINDS,
    valueType: "url",
  },
  openingHours: { label: "Öffnungszeiten", llmsKey: "hours", kinds: BUSINESS, valueType: "text" },
  areaServed: { label: "Einzugsgebiet", llmsKey: "market_area", kinds: [...BUSINESS, "service"], valueType: "text" },
  employeeCount: { label: "Mitarbeitende", llmsKey: "employees", kinds: ["organization"], valueType: "number", volatile: true },
  industry: { label: "Branche", llmsKey: "industry", kinds: BUSINESS, valueType: "text" },
  certification: { label: "Zertifizierung", llmsKey: "certification", kinds: [...BUSINESS, "service", "person"], valueType: "text" },
  award: { label: "Auszeichnung", llmsKey: "award", kinds: [...BUSINESS, "person", "service", "product"], valueType: "text" },
  membership: { label: "Mitgliedschaft", llmsKey: "member_of", kinds: [...BUSINESS, "person"], valueType: "name" },
  sameAs: { label: "Profil", llmsKey: "same_as", kinds: ["organization", "location", "person"], valueType: "url" },
  rating: { label: "Bewertung", llmsKey: "rating", kinds: BUSINESS, valueType: "text", volatile: true, visibleOnly: true },
  priceRange: { label: "Preisspanne", llmsKey: "price_range", kinds: BUSINESS, valueType: "text", volatile: true },
  feature: { label: "Ausstattung", llmsKey: "features", kinds: ["location"], valueType: "text" },
  jobTitle: { label: "Funktion", llmsKey: "role", kinds: ["person"], valueType: "text" },
  expertise: { label: "Fachgebiet", llmsKey: "expertise", kinds: ["person"], valueType: "text" },
  qualification: { label: "Qualifikation", llmsKey: "qualification", kinds: ["person"], valueType: "text" },
  serviceType: { label: "Art", llmsKey: "type", kinds: OFFER, valueType: "text" },
  scope: { label: "Leistungsumfang", llmsKey: "scope", kinds: OFFER, valueType: "text" },
  audience: { label: "Zielgruppe", llmsKey: "target_audience", kinds: OFFER, valueType: "text" },
  price: { label: "Preis", llmsKey: "price", kinds: OFFER, valueType: "text", volatile: true },
} as const satisfies Record<string, FactKeyDef>;

export type FactKey = keyof typeof FACT_KEY_DEFS;
export const FACT_KEYS = Object.keys(FACT_KEY_DEFS) as [FactKey, ...FactKey[]];

export function factKeyDef(key: FactKey): FactKeyDef {
  return FACT_KEY_DEFS[key];
}

export function factLabel(key: FactKey, kind: EntityKind): string {
  const def: FactKeyDef = FACT_KEY_DEFS[key];
  return def.labelByKind?.[kind] ?? def.label;
}

export function factKeyAllowed(key: FactKey, kind: EntityKind): boolean {
  return (FACT_KEY_DEFS[key].kinds as readonly EntityKind[]).includes(kind);
}

export function isVolatileKey(key: FactKey): boolean {
  return (FACT_KEY_DEFS[key] as FactKeyDef).volatile === true;
}

export function isVisibleOnlyKey(key: FactKey): boolean {
  return (FACT_KEY_DEFS[key] as FactKeyDef).visibleOnly === true;
}

/** Schema.org types per kind. LocalBusiness and its subtypes are Places as well. */
export const LOCAL_BUSINESS_TYPES = [
  "LocalBusiness",
  "ProfessionalService",
  "LegalService",
  "Attorney",
  "Notary",
  "AccountingService",
  "FinancialService",
  "InsuranceAgency",
  "RealEstateAgent",
  "EmploymentAgency",
  "TravelAgency",
  "MedicalBusiness",
  "MedicalClinic",
  "Physician",
  "Dentist",
  "Optician",
  "Pharmacy",
  "HealthAndBeautyBusiness",
  "HomeAndConstructionBusiness",
  "GeneralContractor",
  "Electrician",
  "Plumber",
  "HVACBusiness",
  "RoofingContractor",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "AutomotiveBusiness",
  "AutoRepair",
  "Store",
  "FoodEstablishment",
  "Restaurant",
  "LodgingBusiness",
  "Hotel",
  "SportsActivityLocation",
  "ChildCare",
  "EntertainmentBusiness",
] as const;

const ORGANIZATION_TYPES = ["Organization", "Corporation", "NGO", "EducationalOrganization", ...LOCAL_BUSINESS_TYPES] as const;

export const SCHEMA_TYPES_BY_KIND: Record<EntityKind, readonly string[]> = {
  organization: ORGANIZATION_TYPES,
  location: LOCAL_BUSINESS_TYPES,
  person: ["Person"],
  service: ["Service"],
  product: ["Product"],
  method: ["DefinedTerm"],
  other: ["DefinedTerm"],
};

export const DEFAULT_SCHEMA_TYPE: Record<EntityKind, string> = {
  organization: "Organization",
  location: "LocalBusiness",
  person: "Person",
  service: "Service",
  product: "Product",
  method: "DefinedTerm",
  other: "DefinedTerm",
};

export const DEFAULT_ONTOLOGY_CLASS: Record<EntityKind, GroundingOntologyClass> = {
  organization: "Organization Entity Class",
  location: "Organization Entity Class",
  person: "Person Entity Class",
  service: "Service Entity Class",
  product: "Product Entity Class",
  method: "Method Entity Class",
  other: "Concept Entity Class",
};

export function isLocalBusinessType(schemaType: string): boolean {
  return (LOCAL_BUSINESS_TYPES as readonly string[]).includes(schemaType);
}

// --- schema ------------------------------------------------------------------------------------

const urlString = z.string().trim().min(8).max(2000);

export const groundingFactSchema = z.object({
  id: z.string().min(1).max(160),
  key: z.enum(FACT_KEYS),
  value: z.string().trim().min(1).max(600),
  sourceUrl: urlString,
  quote: z.string().trim().max(400),
  volatile: z.boolean(),
  /** YYYY-MM for volatile values. */
  asOf: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  included: z.boolean(),
});

export const groundingEntitySchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(ENTITY_KINDS),
  ontologyClass: z.enum(GROUNDING_ONTOLOGY_CLASS_NAMES),
  schemaType: z.string().min(2).max(60),
  name: z.string().trim().min(1).max(200),
  definition: z.string().trim().max(1200),
  definitionSourceUrl: urlString.nullable(),
  disambiguation: z.array(z.string().trim().min(1).max(600)).max(6),
  facts: z.array(groundingFactSchema).max(80),
  included: z.boolean(),
});

export const groundingFaqSchema = z.object({
  id: z.string().min(1).max(120),
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(5).max(1200),
  sourceUrl: urlString,
  quote: z.string().trim().max(400),
  included: z.boolean(),
});

export const OPEN_POINT_REASONS = [
  "missing_on_website",
  "internal_only",
  "conflict",
  "unverified",
  "not_publishable",
] as const;
export type OpenPointReason = (typeof OPEN_POINT_REASONS)[number];

export const groundingOpenPointSchema = z.object({
  id: z.string().min(1).max(120),
  reason: z.enum(OPEN_POINT_REASONS),
  text: z.string().trim().min(1).max(800),
  entityName: z.string().max(200).nullable(),
  source: z.string().max(400).nullable(),
});

export const groundingProseSchema = z.object({
  pageTitle: z.string().trim().min(1).max(160),
  metaDescription: z.string().trim().max(320),
  lead: z.array(z.string().trim().min(1).max(1200)).max(3),
});

export const groundingFactModelSchema = z.object({
  version: z.literal(GROUNDING_FACT_MODEL_VERSION),
  organisationName: z.string().trim().min(1).max(200),
  websiteUrl: urlString,
  pageUrl: urlString,
  language: z.literal("de-DE"),
  entities: z.array(groundingEntitySchema).max(60),
  faq: z.array(groundingFaqSchema).max(20),
  openPoints: z.array(groundingOpenPointSchema).max(80),
  /** Written in the generate step; null until then. */
  prose: groundingProseSchema.nullable(),
});

export type GroundingFact = z.infer<typeof groundingFactSchema>;
export type GroundingEntity = z.infer<typeof groundingEntitySchema>;
export type GroundingFaq = z.infer<typeof groundingFaqSchema>;
export type GroundingOpenPoint = z.infer<typeof groundingOpenPointSchema>;
export type GroundingProse = z.infer<typeof groundingProseSchema>;
export type GroundingFactModel = z.infer<typeof groundingFactModelSchema>;

/** Stored JSON back into a model; null when it does not parse (old or broken rows). */
export function parseGroundingFactModel(raw: unknown): GroundingFactModel | null {
  const parsed = groundingFactModelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// --- small helpers -----------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** „2026-10“ → „Oktober 2026“. */
export function monthLabel(asOf: string): string {
  const m = asOf.match(/^(\d{4})-(\d{2})$/);
  if (!m) return asOf;
  const month = MONTHS_DE[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : asOf;
}

/** „23. Oktober 2026“ for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return day;
  const month = MONTHS_DE[Number(m[2]) - 1];
  return month ? `${Number(m[3])}. ${month} ${m[1]}` : day;
}

/** Day (YYYY-MM-DD) in Germany — the date a reviewer would write down. */
export function berlinDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function berlinMonth(now: Date = new Date()): string {
  return berlinDay(now).slice(0, 7);
}

const LEGAL_FORMS: Array<[RegExp, string]> = [
  [/gesellschaft mit beschr(ä|ae)nkter haftung\s*&\s*co\.?\s*(kommanditgesellschaft|kg)/i, "GmbH & Co. KG"],
  [/unternehmergesellschaft\s*\(?haftungsbeschr(ä|ae)nkt\)?/i, "UG (haftungsbeschränkt)"],
  [/gesellschaft mit beschr(ä|ae)nkter haftung/i, "GmbH"],
  [/aktiengesellschaft/i, "AG"],
  [/kommanditgesellschaft/i, "KG"],
  [/offene handelsgesellschaft/i, "OHG"],
  [/gesellschaft b(ü|ue)rgerlichen rechts/i, "GbR"],
  [/partnerschaftsgesellschaft/i, "PartG"],
  [/eingetragene(r)? kaufmann|eingetragene kauffrau/i, "e. K."],
  [/eingetragener verein/i, "e. V."],
];

/** Long legal forms become the short form that also appears in the Firmierung. */
export function normalizeLegalForm(value: string): string {
  const trimmed = value.trim();
  const short = trimmed.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  for (const [pattern, abbreviation] of LEGAL_FORMS) {
    if (pattern.test(trimmed)) return abbreviation;
  }
  return short && short.length <= 30 ? short : trimmed;
}

/** Collapse whitespace, unify quotes and dashes, lowercase — for quote and value matching. */
export function looseText(text: string): string {
  return text
    .replace(/[­​]/g, "")
    .replace(/[„“”"«»‚‘’']/g, "")
    .replace(/[–—‑]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokens(text: string): string[] {
  return looseText(text)
    .split(/[^\p{L}\p{N}@.+]+/u)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
    .filter((t) => t.length >= 2);
}

/**
 * True when the quote is on the page: verbatim (after loosening) or with at least 80 % of its
 * words present. Models trim quotes; they must not invent them.
 */
export function quoteFoundIn(quote: string, pageText: string): boolean {
  const q = looseText(quote);
  if (!q) return false;
  const hay = looseText(pageText);
  if (hay.includes(q)) return true;
  const words = tokens(q);
  if (words.length < 3) return false;
  const pageWords = new Set(tokens(hay));
  const hits = words.filter((w) => pageWords.has(w)).length;
  return hits / words.length >= 0.8;
}

export function normaliseSourceUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "/";
    return `${u.hostname}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

// --- normalising the model's answer ------------------------------------------------------------

export type ExtractionContext = {
  organisationName: string;
  websiteUrl: string;
  pageUrl: string;
  /** Current month (YYYY-MM) for volatile facts without a date. */
  month: string;
  /** Page text by normalised URL (normaliseSourceUrl). Facts must quote one of these. */
  pageTexts: Map<string, string>;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(rec) : [];
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function strList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v, maxChars)).filter(Boolean).slice(0, maxItems);
}

function isKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

function isFactKey(value: unknown): value is FactKey {
  return typeof value === "string" && value in FACT_KEY_DEFS;
}

function isOntologyClass(value: unknown): value is GroundingOntologyClass {
  return typeof value === "string" && (GROUNDING_ONTOLOGY_CLASS_NAMES as readonly string[]).includes(value);
}

function uniqueId(base: string, used: Set<string>): string {
  const root = base || "entitaet";
  let id = root;
  for (let n = 2; used.has(id); n++) id = `${root}-${n}`;
  used.add(id);
  return id;
}

/**
 * Turn the extraction tool's answer into a fact model. A fact survives only when its source
 * is a crawled page and its quote is on that page; everything else becomes an open point.
 * Ratings stay off the page until a person turns them on (no self-serving review markup).
 */
export function normalizeExtractedFactModel(raw: unknown, ctx: ExtractionContext): GroundingFactModel {
  const r = rec(raw);
  const openPoints: GroundingOpenPoint[] = [];
  const openIds = new Set<string>();
  const addOpen = (point: Omit<GroundingOpenPoint, "id">) => {
    if (openPoints.length >= 80) return;
    openPoints.push({ ...point, id: uniqueId(`offen-${slugify(point.text).slice(0, 40)}`, openIds) });
  };

  const entityIds = new Set<string>();
  const entities: GroundingEntity[] = [];

  for (const e of list(r.entities)) {
    const kind: EntityKind = isKind(e.kind) ? e.kind : "other";
    const name = str(e.name, 200);
    if (!name) continue;
    const allowedTypes = SCHEMA_TYPES_BY_KIND[kind];
    const schemaTypeRaw = str(e.schemaType, 60);
    const schemaType = allowedTypes.includes(schemaTypeRaw) ? schemaTypeRaw : DEFAULT_SCHEMA_TYPE[kind];
    const id = uniqueId(kind === "organization" && entities.every((x) => x.kind !== "organization") ? "organisation" : slugify(name), entityIds);

    const factIds = new Set<string>();
    const facts: GroundingFact[] = [];
    for (const f of list(e.facts)) {
      const value = str(f.value, 600);
      if (!value) continue;
      if (!isFactKey(f.key) || !factKeyAllowed(f.key, kind)) {
        addOpen({ reason: "unverified", text: `${name}: Angabe ohne passendes Feld – ${str(f.key, 40) || "?"}: ${value}`, entityName: name, source: str(f.sourceUrl, 400) || null });
        continue;
      }
      const key = f.key;
      const sourceUrl = str(f.sourceUrl, 2000);
      const quote = str(f.quote, 400);
      const pageText = ctx.pageTexts.get(normaliseSourceUrl(sourceUrl));
      if (!pageText || !quote || !quoteFoundIn(quote, pageText)) {
        addOpen({
          reason: "unverified",
          text: `${name}: ${factLabel(key, kind)} „${value}“ – ${pageText ? "Zitat steht nicht auf der Quellseite" : "Quelle gehört nicht zu den gelesenen Seiten"}; bitte prüfen.`,
          entityName: name,
          source: sourceUrl || null,
        });
        continue;
      }
      const volatile = isVolatileKey(key) || f.volatile === true;
      const asOfRaw = str(f.asOf, 10);
      const asOf = volatile ? (/^\d{4}-\d{2}$/.test(asOfRaw) ? asOfRaw : ctx.month) : null;
      const included = !isVisibleOnlyKey(key);
      if (!included) {
        addOpen({
          reason: "not_publishable",
          text: `${name}: ${factLabel(key, kind)} „${value}“ ist ausgeblendet. Nur aufnehmen, wenn die Bewertung öffentlich prüfbar ist (z. B. Google-Profil); Bewertungs-Markup für die eigene Firma ist nicht erlaubt.`,
          entityName: name,
          source: sourceUrl,
        });
      }
      facts.push({
        id: uniqueId(`${id}-${key}`, factIds),
        key,
        value: key === "legalForm" ? normalizeLegalForm(value) : value,
        sourceUrl,
        quote,
        volatile,
        asOf,
        included,
      });
    }

    const definitionSourceUrl = str(e.definitionSourceUrl, 2000) || null;
    entities.push({
      id,
      kind,
      ontologyClass: isOntologyClass(e.ontologyClass) ? e.ontologyClass : DEFAULT_ONTOLOGY_CLASS[kind],
      schemaType,
      name,
      definition: str(e.definition, 1200),
      definitionSourceUrl:
        definitionSourceUrl && ctx.pageTexts.has(normaliseSourceUrl(definitionSourceUrl)) ? definitionSourceUrl : null,
      disambiguation: strList(e.disambiguation, 6, 600),
      facts,
      included: true,
    });
  }

  // The organisation comes first and always exists.
  let orgIndex = entities.findIndex((e) => e.kind === "organization");
  if (orgIndex < 0) {
    entities.unshift({
      id: uniqueId("organisation", entityIds),
      kind: "organization",
      ontologyClass: "Organization Entity Class",
      schemaType: "Organization",
      name: ctx.organisationName,
      definition: "",
      definitionSourceUrl: null,
      disambiguation: [],
      facts: [],
      included: true,
    });
    orgIndex = 0;
  } else if (orgIndex > 0) {
    const [org] = entities.splice(orgIndex, 1);
    entities.unshift(org!);
  }

  const faqIds = new Set<string>();
  const faq: GroundingFaq[] = [];
  for (const f of list(r.faq)) {
    const question = str(f.question, 300);
    const answer = str(f.answer, 1200);
    const sourceUrl = str(f.sourceUrl, 2000);
    const quote = str(f.quote, 400);
    if (question.length < 5 || answer.length < 5) continue;
    const pageText = ctx.pageTexts.get(normaliseSourceUrl(sourceUrl));
    if (!pageText || !quote || !quoteFoundIn(quote, pageText)) {
      addOpen({ reason: "unverified", text: `FAQ „${question}“ – Antwort nicht auf der Quellseite belegt.`, entityName: null, source: sourceUrl || null });
      continue;
    }
    faq.push({ id: uniqueId(`faq-${slugify(question).slice(0, 50)}`, faqIds), question, answer, sourceUrl, quote, included: true });
    if (faq.length >= 12) break;
  }

  for (const p of list(r.openPoints)) {
    const text = str(p.text, 800);
    if (!text) continue;
    const reason = (OPEN_POINT_REASONS as readonly string[]).includes(p.reason as string) ? (p.reason as OpenPointReason) : "missing_on_website";
    addOpen({ reason, text, entityName: str(p.entityName, 200) || null, source: str(p.source, 400) || null });
  }

  return {
    version: GROUNDING_FACT_MODEL_VERSION,
    organisationName: entities[0]!.name || ctx.organisationName,
    websiteUrl: ctx.websiteUrl,
    pageUrl: ctx.pageUrl,
    language: "de-DE",
    entities: entities.slice(0, 60),
    faq,
    openPoints,
    prose: null,
  };
}

/** Included entities and their included facts — what the page shows. */
export function visibleEntities(model: GroundingFactModel): GroundingEntity[] {
  return model.entities
    .filter((e) => e.included)
    .map((e) => ({ ...e, facts: e.facts.filter((f) => f.included) }));
}

export function organisationEntity(model: GroundingFactModel): GroundingEntity {
  return model.entities.find((e) => e.kind === "organization") ?? model.entities[0]!;
}

export type FactToggle = { entityId: string; factId?: string | null; included: boolean };
export type FaqToggle = { faqId: string; included: boolean };

/** Apply the reviewer's switches. The organisation itself cannot be switched off. */
export function applyFactToggles(
  model: GroundingFactModel,
  toggles: { facts?: FactToggle[]; faq?: FaqToggle[] },
): GroundingFactModel {
  const entities = model.entities.map((entity) => {
    let next = entity;
    for (const t of toggles.facts ?? []) {
      if (t.entityId !== entity.id) continue;
      if (!t.factId) {
        if (entity.kind !== "organization") next = { ...next, included: t.included };
        continue;
      }
      next = { ...next, facts: next.facts.map((f) => (f.id === t.factId ? { ...f, included: t.included } : f)) };
    }
    return next;
  });
  const faq = model.faq.map((f) => {
    const t = toggles.faq?.find((x) => x.faqId === f.id);
    return t ? { ...f, included: t.included } : f;
  });
  return { ...model, entities, faq };
}

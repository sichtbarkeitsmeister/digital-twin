/**
 * Kontaktdaten of an organisation: the public contact details the website texts may use
 * (address, phone, e-mail, opening hours, Google-Profil, social links, free fields). One set
 * per organisation, shared by the Firmenprofil (customer view) and Texte (agency view).
 *
 * Every field keeps where its value came from: „crawl“ (the organisation's own website),
 * „websuche“ (the Google-Profil found by the web search, to be checked), „manuell“ (typed by
 * a person) or „antwort“ (a customer's answer to a question in Texte). Manual values always
 * win: the crawl and the web search fill only empty fields or fields they filled themselves
 * (`applyAutomaticContactValues`). A field a person emptied stays empty for them too.
 *
 * Three fields are not stored a second time: Firmenname is the Firmenprofil's Anzeigename
 * (`dt_org_config.display_name`), Website its website (`dt_org_config.website_url`) and
 * Ansprechpartner the first of its Ansprechpartner (`dt_org_onboarding.customer_contacts`).
 * Only their source is kept next to the other fields (`resolveReusedField`).
 *
 * Pure: no Supabase. The database side is `contact-data-store.ts`.
 */

export const CONTACT_DATA_MIGRATION_FILE = "database/migrations/20261103_dt_content_client_data.sql";

export const CONTACT_FIELD_KEYS = [
  "firmenname",
  "ansprechpartner",
  "strasse",
  "plz",
  "ort",
  "telefon",
  "mobil",
  "fax",
  "email",
  "website",
  "oeffnungszeiten",
  "google_profil",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "social_sonstige",
] as const;
export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

/** Fields whose value lives in the Firmenprofil's own columns. */
export const REUSED_CONTACT_FIELD_KEYS = ["firmenname", "website", "ansprechpartner"] as const satisfies readonly ContactFieldKey[];
export type ReusedContactFieldKey = (typeof REUSED_CONTACT_FIELD_KEYS)[number];

export function isReusedContactField(key: string): key is ReusedContactFieldKey {
  return (REUSED_CONTACT_FIELD_KEYS as readonly string[]).includes(key);
}

export function isContactFieldKey(value: unknown): value is ContactFieldKey {
  return typeof value === "string" && (CONTACT_FIELD_KEYS as readonly string[]).includes(value);
}

export const CONTACT_FIELD_LABELS: Record<ContactFieldKey, string> = {
  firmenname: "Firmenname",
  ansprechpartner: "Ansprechpartner",
  strasse: "Straße + Hausnummer",
  plz: "PLZ",
  ort: "Ort",
  telefon: "Telefon",
  mobil: "Mobil",
  fax: "Fax",
  email: "E-Mail",
  website: "Website",
  oeffnungszeiten: "Öffnungszeiten",
  google_profil: "Google-Profil",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  social_sonstige: "Weitere Social-Media-Links",
};

/** Longest value per field; Öffnungszeiten and the other links may span lines. */
export const CONTACT_FIELD_MAX_CHARS: Record<ContactFieldKey, number> = {
  firmenname: 160,
  ansprechpartner: 120,
  strasse: 160,
  plz: 10,
  ort: 120,
  telefon: 60,
  mobil: 60,
  fax: 60,
  email: 200,
  website: 500,
  oeffnungszeiten: 600,
  google_profil: 600,
  facebook: 300,
  instagram: 300,
  linkedin: 300,
  youtube: 300,
  social_sonstige: 800,
};

export const CONTACT_CUSTOM_FIELDS_MAX = 12;
export const CONTACT_CUSTOM_LABEL_MAX = 60;
export const CONTACT_CUSTOM_VALUE_MAX = 400;

export const CONTACT_SOURCES = ["crawl", "websuche", "manuell", "antwort"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export function isContactSource(value: unknown): value is ContactSource {
  return typeof value === "string" && (CONTACT_SOURCES as readonly string[]).includes(value);
}

/** A person set it: neither the crawl nor the web search may change it. */
export function isProtectedContactSource(source: ContactSource | null | undefined): boolean {
  return source === "manuell" || source === "antwort";
}

/** The small grey label next to a field („aus Crawl“, „aus Websuche – bitte prüfen“); none for manual values. */
export function contactSourceLabel(source: ContactSource | null | undefined): string | null {
  if (source === "crawl") return "aus Crawl";
  if (source === "websuche") return "aus Websuche – bitte prüfen";
  if (source === "antwort") return "aus Antwort des Kunden";
  return null;
}

/** Under an empty Google-Profil field when neither the crawl nor the web search found one. */
export const GOOGLE_NOT_FOUND_HINT = "Nicht gefunden – bitte manuell eintragen oder ‚Kein Google-Profil‘ wählen.";

export type ContactFieldValue = {
  value: string;
  source: ContactSource;
  updated_at: string | null;
};

export type ContactCustomField = ContactFieldValue & { label: string };

/** The last web search for the Google-Profil (at most once per organisation, plus the button). */
export type ContactGoogleSearch = {
  at: string;
  /** found: saved as „websuche“; not_found / rejected: nothing saved; error: the search failed. */
  status: "found" | "not_found" | "rejected" | "error";
  url: string | null;
  /** Why a candidate was rejected or the search failed (German, for the card). */
  reason: string | null;
  query: string | null;
  searches: number;
  fetches: number;
  cost_eur: number;
  model: string | null;
};

/** The last fill from the crawled website. */
export type ContactCrawlFill = {
  at: string;
  /** Fields the fill changed. */
  fields: ContactFieldKey[];
  /** Pages it read („Impressum“, „Kontakt“, „Startseite“), live or from the stored crawl text. */
  pages: string[];
  /** The optional extraction call on the cheap model (0 when the heuristics sufficed). */
  cost_eur: number;
  model: string | null;
};

export type OrgContactData = {
  fields: Partial<Record<ContactFieldKey, ContactFieldValue>>;
  custom: ContactCustomField[];
  no_google_profile: boolean;
  google_search: ContactGoogleSearch | null;
  crawl_fill: ContactCrawlFill | null;
  updated_at: string | null;
};

export const EMPTY_ORG_CONTACT_DATA: OrgContactData = {
  fields: {},
  custom: [],
  no_google_profile: false,
  google_search: null,
  crawl_fill: null,
  updated_at: null,
};

// --- reading what is stored ----------------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

function iso(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** One stored field; a value without a known source counts as „manuell“ (the safe direction). */
export function readContactFieldValue(raw: unknown, key: ContactFieldKey): ContactFieldValue | null {
  const r = rec(raw);
  if (!("value" in r)) return null;
  return {
    value: text(r.value, CONTACT_FIELD_MAX_CHARS[key]),
    source: isContactSource(r.source) ? r.source : "manuell",
    updated_at: iso(r.updated_at),
  };
}

function readGoogleSearch(raw: unknown): ContactGoogleSearch | null {
  const r = rec(raw);
  const at = iso(r.at);
  if (!at) return null;
  const status = ["found", "not_found", "rejected", "error"].includes(String(r.status)) ? (r.status as ContactGoogleSearch["status"]) : "error";
  return {
    at,
    status,
    url: text(r.url, 600) || null,
    reason: text(r.reason, 600) || null,
    query: text(r.query, 300) || null,
    searches: num(r.searches),
    fetches: num(r.fetches),
    cost_eur: num(r.cost_eur),
    model: text(r.model, 120) || null,
  };
}

function readCrawlFill(raw: unknown): ContactCrawlFill | null {
  const r = rec(raw);
  const at = iso(r.at);
  if (!at) return null;
  return {
    at,
    fields: (Array.isArray(r.fields) ? r.fields : []).filter(isContactFieldKey),
    pages: (Array.isArray(r.pages) ? r.pages : []).map((p) => text(p, 80)).filter(Boolean).slice(0, 10),
    cost_eur: num(r.cost_eur),
    model: text(r.model, 120) || null,
  };
}

/** A row of `dt_org_contact_data` (or nothing) as the code works with it. */
export function readOrgContactData(row: Record<string, unknown> | null | undefined): OrgContactData {
  if (!row) return { ...EMPTY_ORG_CONTACT_DATA, fields: {}, custom: [] };
  const storedFields = rec(row.fields);
  const fields: OrgContactData["fields"] = {};
  for (const key of CONTACT_FIELD_KEYS) {
    const value = readContactFieldValue(storedFields[key], key);
    if (value) fields[key] = value;
  }
  const custom: ContactCustomField[] = [];
  for (const item of Array.isArray(row.custom_fields) ? row.custom_fields : []) {
    const r = rec(item);
    const label = text(r.label, CONTACT_CUSTOM_LABEL_MAX);
    const value = text(r.value, CONTACT_CUSTOM_VALUE_MAX);
    if (!label && !value) continue;
    custom.push({ label, value, source: isContactSource(r.source) ? r.source : "manuell", updated_at: iso(r.updated_at) });
    if (custom.length >= CONTACT_CUSTOM_FIELDS_MAX) break;
  }
  return {
    fields,
    custom,
    no_google_profile: row.no_google_profile === true,
    google_search: readGoogleSearch(row.google_search),
    crawl_fill: readCrawlFill(row.crawl_fill),
    updated_at: iso(row.updated_at),
  };
}

/** What `dt_org_contact_data` stores of the fields (with the reused ones: their source and a copy of the value). */
export function contactDataRowPatch(data: OrgContactData): Record<string, unknown> {
  return {
    fields: data.fields,
    custom_fields: data.custom,
    no_google_profile: data.no_google_profile,
    google_search: data.google_search,
    crawl_fill: data.crawl_fill,
  };
}

// --- the reused fields -------------------------------------------------------------------------------

/**
 * A field whose value lives in the Firmenprofil's own column. A filled column is the value;
 * its source is the stored one only while the stored copy still matches, else a person has
 * changed it in the Firmenprofil or the onboarding meanwhile („manuell“). An empty column
 * leaves what is stored here (a crawl value, or a person's emptied field).
 */
export function resolveReusedField(
  stored: ContactFieldValue | null | undefined,
  column: string | null | undefined,
): ContactFieldValue | null {
  const value = (column ?? "").trim();
  if (value) {
    if (stored && stored.value.trim() === value) return stored;
    return { value, source: "manuell", updated_at: stored?.updated_at ?? null };
  }
  return stored ?? null;
}

/** The Firmenprofil columns behind the three reused fields. */
export type ContactProfileColumns = {
  displayName: string | null;
  websiteUrl: string | null;
  /** First Ansprechpartner of the Firmenprofil (name and Funktion), if any. */
  firstContact: { name: string; role: string } | null;
};

/** The organisation's Kontaktdaten with the reused fields read from the Firmenprofil. */
export function withProfileColumns(data: OrgContactData, columns: ContactProfileColumns): OrgContactData {
  const fields = { ...data.fields };
  const set = (key: ReusedContactFieldKey, column: string | null | undefined) => {
    const resolved = resolveReusedField(fields[key], column);
    if (resolved) fields[key] = resolved;
    else delete fields[key];
  };
  set("firmenname", columns.displayName);
  set("website", columns.websiteUrl);
  set("ansprechpartner", columns.firstContact?.name);
  return { ...data, fields };
}

// --- values and changes -------------------------------------------------------------------------------

/** Soft hyphens and zero-width characters (copied from a website) are no part of a value. */
export function withoutInvisibleChars(value: string): string {
  return value.replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "");
}

export function contactFieldText(data: Pick<OrgContactData, "fields">, key: ContactFieldKey): string {
  return withoutInvisibleChars(data.fields[key]?.value ?? "").trim();
}

/** The digits of a German phone number, „+49“, „0049“ and „(0)“ written as the leading 0. */
export function phoneDigits(phone: string): string {
  return phone
    .replace(/\(\s*0\s*\)/g, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+49/, "0")
    .replace(/^0049/, "0")
    .replace(/\D/g, "");
}

/** One change for the Firmenprofil's change log (`dt_company_profile_edits.changes`). */
export type ContactDataChange = { key: string; label: string; before: string; after: string };

/** Keys of the change log: `kontakt.<feld>`, `kontakt.kein_google_profil`, `kontakt.weitere_felder`. */
export function contactChangeKey(key: ContactFieldKey | "kein_google_profil" | "weitere_felder"): string {
  return `kontakt.${key}`;
}

function customText(custom: readonly ContactCustomField[]): string {
  return custom
    .filter((c) => c.label.trim() || c.value.trim())
    .map((c) => `${c.label.trim() || "Feld"}: ${c.value.trim()}`)
    .join("\n");
}

/** What changed between two versions, for the change log; the source alone is no change. */
export function diffContactData(before: OrgContactData, after: OrgContactData): ContactDataChange[] {
  const changes: ContactDataChange[] = [];
  for (const key of CONTACT_FIELD_KEYS) {
    const was = contactFieldText(before, key);
    const now = contactFieldText(after, key);
    if (was === now) continue;
    changes.push({ key: contactChangeKey(key), label: `Kontaktdaten: ${CONTACT_FIELD_LABELS[key]}`, before: was, after: now });
  }
  if (before.no_google_profile !== after.no_google_profile) {
    changes.push({
      key: contactChangeKey("kein_google_profil"),
      label: "Kontaktdaten: Kein Google-Profil",
      before: before.no_google_profile ? "ja" : "nein",
      after: after.no_google_profile ? "ja" : "nein",
    });
  }
  const customBefore = customText(before.custom);
  const customAfter = customText(after.custom);
  if (customBefore !== customAfter) {
    changes.push({ key: contactChangeKey("weitere_felder"), label: "Kontaktdaten: Weitere Felder", before: customBefore, after: customAfter });
  }
  return changes;
}

/** What a person sends from the card (Texte or Firmenprofil); only the keys present change. */
export type ContactDataInput = {
  fields?: Partial<Record<ContactFieldKey, string>>;
  custom?: Array<{ label: string; value: string }>;
  no_google_profile?: boolean;
};

export function cleanContactValue(key: ContactFieldKey, value: unknown): string {
  return text(value, CONTACT_FIELD_MAX_CHARS[key]);
}

/**
 * A person's save: a field whose text changed becomes „manuell“ (or „antwort“ for an answer
 * in Texte); an unchanged one keeps its source, so saving the card does not turn crawl values
 * into manual ones. An emptied field is kept as an empty manual value: the next crawl leaves it.
 * „Kein Google-Profil“ empties the link.
 */
export function applyManualContactValues(
  current: OrgContactData,
  input: ContactDataInput,
  now: Date = new Date(),
  source: Extract<ContactSource, "manuell" | "antwort"> = "manuell",
): OrgContactData {
  const at = now.toISOString();
  const fields = { ...current.fields };
  for (const key of CONTACT_FIELD_KEYS) {
    if (!input.fields || !(key in input.fields)) continue;
    const next = cleanContactValue(key, input.fields[key]);
    const was = fields[key];
    if (was && was.value === next) continue;
    if (!was && !next) continue;
    fields[key] = { value: next, source, updated_at: at };
  }
  let custom = current.custom;
  if (input.custom) {
    const previous = new Map(current.custom.map((c) => [`${c.label}\u0000${c.value}`, c]));
    custom = input.custom
      .map((c) => ({ label: text(c.label, CONTACT_CUSTOM_LABEL_MAX), value: text(c.value, CONTACT_CUSTOM_VALUE_MAX) }))
      .filter((c) => c.label || c.value)
      .slice(0, CONTACT_CUSTOM_FIELDS_MAX)
      .map((c) => previous.get(`${c.label}\u0000${c.value}`) ?? { ...c, source, updated_at: at });
  }
  const noGoogle = input.no_google_profile ?? current.no_google_profile;
  if (noGoogle && fields.google_profil?.value) {
    fields.google_profil = { value: "", source, updated_at: at };
  }
  return { ...current, fields, custom, no_google_profile: noGoogle };
}

/**
 * Values found by the crawl or the web search. They fill a field only when it is empty or
 * was filled automatically before; a field a person set (manuell, antwort) is never touched,
 * also not when that person emptied it. The web search only fills empty fields, so a link the
 * crawl found on the website itself stays. Returns the new data and the keys that changed.
 */
export function applyAutomaticContactValues(
  current: OrgContactData,
  found: Partial<Record<ContactFieldKey, string | null | undefined>>,
  source: Extract<ContactSource, "crawl" | "websuche">,
  now: Date = new Date(),
): { data: OrgContactData; changed: ContactFieldKey[] } {
  const at = now.toISOString();
  const fields = { ...current.fields };
  const changed: ContactFieldKey[] = [];
  for (const key of CONTACT_FIELD_KEYS) {
    const value = cleanContactValue(key, found[key]);
    if (!value) continue;
    if (key === "google_profil" && current.no_google_profile) continue;
    const was = fields[key];
    if (was && isProtectedContactSource(was.source)) continue;
    if (source === "websuche" && was?.value) continue;
    if (was && was.value === value) continue;
    fields[key] = { value, source, updated_at: at };
    changed.push(key);
  }
  return { data: { ...current, fields }, changed };
}

/** Whether the Google-Profil still has to be looked for (empty, and „Kein Google-Profil“ not set). */
export function needsGoogleProfileSearch(data: Pick<OrgContactData, "fields" | "no_google_profile">): boolean {
  return !data.no_google_profile && !contactFieldText(data, "google_profil");
}

/** The fields the crawl could not fill and that matter most for the texts. */
export const CORE_CONTACT_FIELD_KEYS = ["strasse", "plz", "ort", "telefon", "email"] as const satisfies readonly ContactFieldKey[];

export function missingCoreContactFields(data: Pick<OrgContactData, "fields">): ContactFieldKey[] {
  return CORE_CONTACT_FIELD_KEYS.filter((key) => !contactFieldText(data, key));
}

// --- the prompt block --------------------------------------------------------------------------------

/** What the pipeline sees of the Kontaktdaten: only filled fields, plus the Ansprechpartner's Funktion. */
export type ContactPromptData = {
  lines: Array<{ label: string; value: string }>;
  google_profile_url: string | null;
  no_google_profile: boolean;
};

/**
 * The filled fields in a fixed order, Straße/PLZ/Ort as one address line. Only the public
 * data: the Ansprechpartner's name and Funktion, never the private e-mail or phone of a
 * Firmenprofil contact. Null when nothing is filled and „Kein Google-Profil“ is not set.
 */
export function contactPromptData(
  data: Pick<OrgContactData, "fields" | "custom" | "no_google_profile">,
  options: { ansprechpartnerRole?: string | null } = {},
): ContactPromptData | null {
  const lines: ContactPromptData["lines"] = [];
  const push = (label: string, value: string) => {
    const v = withoutInvisibleChars(value).replace(/\s*\n\s*/g, " · ").trim();
    if (v) lines.push({ label, value: v });
  };
  const get = (key: ContactFieldKey) => contactFieldText(data, key);
  push(CONTACT_FIELD_LABELS.firmenname, get("firmenname"));
  const role = options.ansprechpartnerRole?.trim();
  push(CONTACT_FIELD_LABELS.ansprechpartner, get("ansprechpartner") ? `${get("ansprechpartner")}${role ? ` (${role})` : ""}` : "");
  const cityLine = [get("plz"), get("ort")].filter(Boolean).join(" ");
  push("Adresse", [get("strasse"), cityLine].filter(Boolean).join(", "));
  for (const key of ["telefon", "mobil", "fax", "email", "website", "oeffnungszeiten"] as const) push(CONTACT_FIELD_LABELS[key], get(key));
  const google = data.no_google_profile ? "" : get("google_profil");
  push(CONTACT_FIELD_LABELS.google_profil, google);
  for (const key of ["facebook", "instagram", "linkedin", "youtube", "social_sonstige"] as const) push(CONTACT_FIELD_LABELS[key], get(key));
  for (const c of data.custom) {
    if (c.value.trim()) push(c.label.trim() || "Weitere Angabe", c.value);
  }
  if (lines.length === 0 && !data.no_google_profile) return null;
  return { lines, google_profile_url: google || null, no_google_profile: data.no_google_profile };
}

// --- the form ---------------------------------------------------------------------------------------

/** What the card edits: every field as text, the free fields, the checkbox. */
export type ContactFormState = {
  fields: Record<ContactFieldKey, string>;
  custom: Array<{ label: string; value: string }>;
  no_google_profile: boolean;
};

export function contactFormState(data: Pick<OrgContactData, "fields" | "custom" | "no_google_profile">): ContactFormState {
  return {
    fields: Object.fromEntries(CONTACT_FIELD_KEYS.map((key) => [key, data.fields[key]?.value ?? ""])) as Record<ContactFieldKey, string>,
    custom: data.custom.map((c) => ({ label: c.label, value: c.value })),
    no_google_profile: data.no_google_profile,
  };
}

/** The source label a field shows: only while its text is still the automatic value. */
export function contactFieldBadge(data: Pick<OrgContactData, "fields">, key: ContactFieldKey, current: string): string | null {
  const stored = data.fields[key];
  if (!stored || stored.value.trim() !== current.trim() || !current.trim()) return null;
  return contactSourceLabel(stored.source);
}

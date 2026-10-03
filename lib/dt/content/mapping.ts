/**
 * DigitalTwin data → Content-Agent payloads (`PUT /api/v1/clients/{org}`).
 * Pure functions: no Supabase, no fetch. Loading happens in `load-sources.ts`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ TODO(content-agent): Fragebogen-Frage → Feld. Zeilen mit GERATEN mit dem Service abstimmen │
 * ├───────────────────┬───────────────────────────────────────────────┬──────────────────────┤
 * │ Feld              │ Quelle im Anbieter-Fragebogen                 │ Status               │
 * ├───────────────────┼───────────────────────────────────────────────┼──────────────────────┤
 * │ name              │ core_company_name, sonst Organisationsname    │ sicher               │
 * │ short_name        │ core_colloquial_name                          │ sicher               │
 * │ anrede            │ core_address_form (Du/Sie), Standard "Sie"    │ sicher               │
 * │ branche           │ Frage mit „Branche“ im Titel, sonst erste     │ GERATEN: es gibt     │
 * │                   │ angekreuzte Leistung aus core_portfolio       │ keine Branchen-Frage │
 * │ tonalitaet        │ core_speaking_style (Rangfolge, oben zuerst)  │ GERATEN: Service will│
 * │                   │                                               │ evtl. Adjektive      │
 * │ verbotene_woerter │ core_forbidden_terms                          │ sicher               │
 * │ typische_woerter  │ core_typical_terms (als freier Schlüssel)     │ GERATEN: Feldname    │
 * │ übrige Antworten  │ Schlüssel = Core-Key ohne "core_", sonst Slug │ GERATEN: Service     │
 * │                   │ des Fragetitels; Listen als string[]          │ liest sie als Freitext│
 * └───────────────────┴───────────────────────────────────────────────┴──────────────────────┘
 */

import { decodeOtherValueForDisplay } from "@/lib/surveys/other-option";
import { resolveRankingExport } from "@/lib/surveys/ranking-answer";
import type { SurveyField, SurveyStep } from "@/lib/surveys/types";

export type ContentAnrede = "Sie" | "Du";

export type ContentAnbieter = {
  name: string;
  short_name?: string;
  anrede: ContentAnrede;
  branche: string;
  tonalitaet: string[];
  verbotene_woerter: string[];
  [key: string]: unknown;
};

export type ContentAvatar = {
  name: string;
  role: string;
  beschreibung: string;
  [key: string]: unknown;
};

export type AnbieterSurveyInput = {
  definition: unknown;
  answers: Record<string, unknown>;
  /** Fallback when the questionnaire has no company name. */
  organisationName?: string | null;
};

export type DtAgentForContent = {
  name: string;
  role?: string | null;
  prompt_template?: string | null;
  avatar_data?: unknown;
};

type MappedField = {
  coreKey: string;
  titlePattern: RegExp;
};

const NAME_FIELD: MappedField = {
  coreKey: "company_name",
  titlePattern: /vollst[aä]ndige name der firma|firmenname|name (des|der) (unternehmens|firma)/,
};
const SHORT_NAME_FIELD: MappedField = {
  coreKey: "colloquial_name",
  titlePattern: /im alltag genannt|kurzform|spitzname/,
};
const ANREDE_FIELD: MappedField = {
  coreKey: "address_form",
  titlePattern: /\bdu oder sie\b|\bsie oder du\b|\banrede\b|duzen|siezen/,
};
const TONALITAET_FIELD: MappedField = {
  coreKey: "speaking_style",
  titlePattern: /wie wird .*mit dem kunden gesprochen|tonalit[aä]t|tonfall/,
};
const VERBOTEN_FIELD: MappedField = {
  coreKey: "forbidden_terms",
  titlePattern: /auf keinen fall verwendet|verbotene (w[oö]rter|begriffe)|no-?go/,
};
const BRANCHE_FIELD: MappedField = {
  coreKey: "industry",
  titlePattern: /\bbranche\b/,
};
const PORTFOLIO_FIELD: MappedField = {
  coreKey: "portfolio",
  titlePattern: /welche leistungen oder produkte werden .*angeboten/,
};

const RESERVED_KEYS = new Set([
  "name",
  "short_name",
  "anrede",
  "branche",
  "tonalitaet",
  "verbotene_woerter",
]);

const EMPTY_ANSWERS = new Set([
  "—",
  "-",
  "--",
  "–",
  "n/a",
  "na",
  "k.a.",
  "ka",
  "nichts",
  "keine angabe",
  "keine antwort",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isEmptyText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (EMPTY_ANSWERS.has(t)) return true;
  return /^[\s\-—–_.…]+$/.test(t);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[„“"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function surveyFields(definition: unknown): SurveyField[] {
  if (!isRecord(definition) || !Array.isArray(definition.steps)) return [];
  const fields: SurveyField[] = [];
  for (const step of definition.steps as SurveyStep[]) {
    if (!isRecord(step) || !Array.isArray(step.fields)) continue;
    for (const field of step.fields) {
      if (isRecord(field) && typeof field.id === "string") fields.push(field as SurveyField);
    }
  }
  return fields;
}

function findField(fields: SurveyField[], mapping: MappedField): SurveyField | null {
  const byId = fields.find((f) => f.id === `core_${mapping.coreKey}`);
  if (byId) return byId;
  return fields.find((f) => mapping.titlePattern.test(normalizeTitle(f.title ?? ""))) ?? null;
}

function fieldOptions(field: SurveyField): Array<{ id: string; label: string }> {
  return "options" in field && Array.isArray(field.options) ? field.options : [];
}

function cleanListEntry(value: string): string {
  return value.replace(/^[-•*\d.)\s]+/, "").trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Every answer shape as a list of plain strings (no placeholders, no "(benutzererstellt)"). */
export function surveyAnswerToList(raw: unknown, field?: SurveyField | null): string[] {
  if (raw == null) return [];

  if (field?.type === "ranking") {
    const resolved = resolveRankingExport(raw, fieldOptions(field));
    return dedupe((resolved?.ranked ?? []).map((s) => s.trim()).filter((s) => !isEmptyText(s)));
  }

  if (isRecord(raw) && Array.isArray(raw.entries)) {
    return dedupe(
      raw.entries
        .map((e) => (isRecord(e) && typeof e.value === "string" ? cleanListEntry(e.value) : ""))
        .filter((s) => !isEmptyText(s)),
    );
  }

  if (Array.isArray(raw)) {
    return dedupe(
      raw
        .map((x) => (typeof x === "string" ? decodeOtherValueForDisplay(x).trim() : ""))
        .filter((s) => !isEmptyText(s)),
    );
  }

  if (isRecord(raw)) {
    return dedupe(
      Object.values(raw)
        .map((v) => (typeof v === "string" ? cleanListEntry(v) : ""))
        .filter((s) => !isEmptyText(s)),
    );
  }

  if (typeof raw === "string") {
    const text = field?.type === "radio" ? decodeOtherValueForDisplay(raw) : raw;
    return dedupe(
      text
        .split(/[\n;]+/)
        .map(cleanListEntry)
        .filter((s) => !isEmptyText(s)),
    );
  }

  if (typeof raw === "number") return [String(raw)];
  if (typeof raw === "boolean") return [raw ? "Ja" : "Nein"];
  return [];
}

/** Single text answer; lists are joined with ", ". */
export function surveyAnswerToText(raw: unknown, field?: SurveyField | null): string {
  if (typeof raw === "string") {
    const text = (field?.type === "radio" ? decodeOtherValueForDisplay(raw) : raw).trim();
    return isEmptyText(text) ? "" : text;
  }
  if (typeof raw === "number") return String(raw);
  return surveyAnswerToList(raw, field).join(", ");
}

function parseAnrede(text: string): ContentAnrede | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^du\b|\bdu\b|duzen/.test(t)) return "Du";
  if (/^sie\b|\bsie\b|siezen/.test(t)) return "Sie";
  return null;
}

/** Stable free key for an unmapped question. */
export function contentKeyForField(field: Pick<SurveyField, "id" | "title">): string {
  if (field.id.startsWith("core_")) return field.id.slice("core_".length);
  const fromTitle = (field.title ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return fromTitle || field.id;
}

function isListField(field: SurveyField): boolean {
  return field.type === "text_list" || field.type === "checkbox" || field.type === "ranking";
}

/**
 * Anbieter questionnaire (purpose = 'anbieter') → Content-Agent `anbieter` object.
 * Never invents facts: missing answers stay empty, guessed mappings are listed in the TODO table above.
 */
export function anbieterFromSurvey(input: AnbieterSurveyInput): ContentAnbieter {
  const fields = surveyFields(input.definition);
  const answers = isRecord(input.answers) ? input.answers : {};
  const consumed = new Set<string>();

  const textOf = (mapping: MappedField): string => {
    const field = findField(fields, mapping);
    if (!field) return "";
    consumed.add(field.id);
    return surveyAnswerToText(answers[field.id], field);
  };
  const listOf = (mapping: MappedField): string[] => {
    const field = findField(fields, mapping);
    if (!field) return [];
    consumed.add(field.id);
    return surveyAnswerToList(answers[field.id], field);
  };

  const name = textOf(NAME_FIELD) || (input.organisationName ?? "").trim();
  const shortName = textOf(SHORT_NAME_FIELD);
  const anrede = parseAnrede(textOf(ANREDE_FIELD)) ?? "Sie";
  const tonalitaet = listOf(TONALITAET_FIELD);
  const verboteneWoerter = listOf(VERBOTEN_FIELD);

  const brancheField = findField(fields, BRANCHE_FIELD);
  let branche = "";
  if (brancheField) {
    consumed.add(brancheField.id);
    branche = surveyAnswerToText(answers[brancheField.id], brancheField);
  }
  if (!branche) {
    const portfolioField = findField(fields, PORTFOLIO_FIELD);
    if (portfolioField) {
      branche = surveyAnswerToList(answers[portfolioField.id], portfolioField)[0] ?? "";
    }
  }

  const rest: Record<string, unknown> = {};
  for (const field of fields) {
    if (consumed.has(field.id)) continue;
    const raw = answers[field.id];
    let key = contentKeyForField(field);
    if (RESERVED_KEYS.has(key)) key = `frage_${key}`;
    if (key in rest) key = `${key}_${field.id}`;

    if (field.type === "rating") {
      if (typeof raw === "number" && Number.isFinite(raw)) rest[key] = raw;
      continue;
    }
    if (isListField(field)) {
      const list = surveyAnswerToList(raw, field);
      if (list.length > 0) rest[key] = list;
      continue;
    }
    const text = surveyAnswerToText(raw, field);
    if (text) rest[key] = text;
  }

  const result: ContentAnbieter = {
    ...rest,
    name,
    anrede,
    branche,
    tonalitaet,
    verbotene_woerter: verboteneWoerter,
  };
  if (shortName) result.short_name = shortName;
  return result;
}

/**
 * `dt_agents` row → Content-Agent `avatar` object.
 * Row columns win over same-named keys inside `avatar_data`.
 */
export function avatarFromAgent(row: DtAgentForContent): ContentAvatar {
  const extra = isRecord(row.avatar_data) ? row.avatar_data : {};
  return {
    ...extra,
    name: row.name.trim(),
    role: (row.role ?? "").trim(),
    beschreibung: (row.prompt_template ?? "").trim(),
  };
}

/** `{org}` path segment for the Content-Agent. */
export function contentClientKey(organisationId: string): string {
  return organisationId.trim().toLowerCase();
}

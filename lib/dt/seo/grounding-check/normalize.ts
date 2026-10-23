/**
 * Value normalisation for comparing facts: the same phone number, address or date written
 * two ways must compare equal. Pure.
 */

import { type FactValueType, looseText } from "@/lib/dt/seo/grounding-check/fact-model";

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** German phone numbers to digits with country code: „0211 97 265 36-0“ → „4921197265360“. */
export function normalizePhone(value: string): string {
  let digits = value.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  return digits.replace(/\D/g, "");
}

export function normalizeEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").toLowerCase();
}

/** Host without www + path without trailing slash; bare domains get https://. */
export function normalizeUrlValue(value: string): string {
  const raw = value.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
  try {
    const u = new URL(withScheme);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return looseText(raw);
  }
}

/** Words of an address in a stable form: „Mülheimer Str. 23“ = „Mülheimer Straße 23“. */
export function normalizeAddress(value: string): string {
  // Compound names abbreviate inside the word: „Musterstr. 12“.
  return looseText(value)
    .replace(/str\.(?=[\s\d,]|$)/g, "straße")
    .replace(/strasse\b/g, "straße")
    .replace(/\bstr\b/g, "straße")
    .replace(/,?\s*(deutschland|germany|de)$/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
}

/** Dates to ISO precision as written: „Oktober 2019“ → „2019-10“, „12.03.2015“ → „2015-03-12“. */
export function normalizeDateValue(value: string): string {
  const t = value.trim().toLowerCase();
  const iso = t.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) return iso[3] ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}`;
  const dotted = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return `${dotted[3]}-${pad(Number(dotted[2]))}-${pad(Number(dotted[1]))}`;
  const spelled = t.match(/(?:(\d{1,2})\.\s*)?([a-zäöü]+)\.?\s+(\d{4})/);
  if (spelled && MONTHS[spelled[2]!]) {
    const month = pad(MONTHS[spelled[2]!]!);
    return spelled[1] ? `${spelled[3]}-${month}-${pad(Number(spelled[1]))}` : `${spelled[3]}-${month}`;
  }
  const year = t.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return year ? year[1]! : looseText(value);
}

/** First whole number („ca. 25 Mitarbeitende“ → „25“); otherwise the loose text. */
export function normalizeNumber(value: string): string {
  const m = value.replace(/(\d)\.(\d{3})\b/g, "$1$2").match(/\d+/);
  return m ? m[0] : looseText(value);
}

const LEGAL_SUFFIX =
  /\b(gmbh\s*&\s*co\.?\s*kg|gmbh|ug\s*\(haftungsbeschränkt\)|ug|ag|kg|ohg|gbr|partg(?:\s*mbb)?|e\.\s*k\.|e\.\s*v\.|mbh|inh\.)\b\.?/g;

/** Names compared without legal form, punctuation or umlaut spelling. */
export function looseName(value: string): string {
  return looseText(value)
    .replace(LEGAL_SUFFIX, " ")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function plainText(value: string): string {
  return looseText(value).replace(/[^\p{L}\p{N}%€]+/gu, " ").trim();
}

export function normalizeFactValue(valueType: FactValueType, value: string): string {
  switch (valueType) {
    case "phone":
      return normalizePhone(value);
    case "email":
      return normalizeEmail(value);
    case "url":
      return normalizeUrlValue(value);
    case "address":
      return normalizeAddress(value);
    case "date":
      return normalizeDateValue(value);
    case "number":
      return normalizeNumber(value);
    case "name":
      return looseName(value);
    default:
      return plainText(value);
  }
}

/** „10 (Stand März 2026)“ → value „10“, asOf „2026-03“. */
export function splitStand(value: string): { value: string; asOf: string | null } {
  const m = value.match(/\s*\(\s*stand\b:?\s*([^)]*)\)\s*$/i) ?? value.match(/[,;]?\s+stand\b:?\s+([^,;()]+)$/i);
  if (!m || m.index === undefined || m.index === 0) return { value: value.trim(), asOf: null };
  const date = normalizeDateValue(m[1] ?? "");
  if (!/^\d{4}-\d{2}/.test(date)) return { value: value.trim(), asOf: null };
  return { value: value.slice(0, m.index).trim().replace(/[,;]$/, ""), asOf: date.slice(0, 7) };
}

export type ParsedAddress = { streetAddress: string; postalCode: string; addressLocality: string };

/** „Von-Galen-Straße 40, 59065 Hamm (Deutschland)“ → parts; null when it does not look German. */
export function parseGermanAddress(value: string): ParsedAddress | null {
  const cleaned = value.replace(/,?\s*(Deutschland|Germany)\s*$/i, "").trim();
  const m = cleaned.match(/^(.+?\d+\s*[a-zA-Z]?(?:\s*[-–]\s*\d+\s*[a-zA-Z]?)?)\s*,?\s+(\d{5})\s+(.+)$/);
  if (!m) return null;
  return { streetAddress: m[1]!.trim().replace(/,$/, ""), postalCode: m[2]!, addressLocality: m[3]!.trim() };
}

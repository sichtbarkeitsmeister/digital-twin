/**
 * JSON-LD helpers shared by the existing-page parser and the mirror validator. Pure.
 */

import * as cheerio from "cheerio";

export type JsonLdNode = Record<string, unknown>;

export type ParsedJsonLd = {
  /** Top-level documents, one per <script>. */
  documents: unknown[];
  /** Every object with an @type, depth-first (graph members and nested nodes). */
  nodes: JsonLdNode[];
  /** 1-based script numbers that did not parse. */
  invalidScripts: number[];
  scriptCount: number;
};

function isRecord(value: unknown): value is JsonLdNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collectTypedNodes(value: unknown, out: JsonLdNode[] = []): JsonLdNode[] {
  if (Array.isArray(value)) {
    for (const item of value) collectTypedNodes(item, out);
    return out;
  }
  if (!isRecord(value)) return out;
  if (value["@type"]) out.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === "@context") continue;
    if (child && typeof child === "object") collectTypedNodes(child, out);
  }
  return out;
}

export function parseJsonLdFromHtml(html: string): ParsedJsonLd {
  const $ = cheerio.load(html);
  const documents: unknown[] = [];
  const invalidScripts: number[] = [];
  const scripts = $('script[type="application/ld+json"]').toArray();
  scripts.forEach((el, i) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      documents.push(JSON.parse(raw));
    } catch {
      invalidScripts.push(i + 1);
    }
  });
  return { documents, nodes: collectTypedNodes(documents), invalidScripts, scriptCount: scripts.length };
}

export function typesOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

export function hasType(node: JsonLdNode, types: readonly string[]): boolean {
  return typesOf(node).some((t) => types.includes(t));
}

/** Values of a property as an array (scalars wrapped, missing → []). */
export function valuesOf(node: JsonLdNode, key: string): unknown[] {
  const v = node[key];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Text of a value: strings as is, numbers as text, objects by name / value / text. */
export function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (isRecord(value)) {
    for (const key of ["name", "value", "text", "audienceType", "description"]) {
      const inner = value[key];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
      if (typeof inner === "number") return String(inner);
    }
  }
  return null;
}

/** Keys whose values are structure, not content, when comparing with the visible page. */
export const STRUCTURAL_JSONLD_KEYS = new Set([
  "@context",
  "@type",
  "@id",
  "inLanguage",
  "addressCountry",
  "position",
  "priceCurrency",
  "contentUrl",
  "encodingFormat",
]);

/** Every string or number leaf with its path, skipping structural keys. */
export function contentLeaves(value: unknown, path = ""): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => out.push(...contentLeaves(item, `${path}[${i}]`)));
    return out;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (STRUCTURAL_JSONLD_KEYS.has(key)) continue;
      out.push(...contentLeaves(child, path ? `${path}.${key}` : key));
    }
    return out;
  }
  if (typeof value === "string" && value.trim()) out.push({ path, value: value.trim() });
  if (typeof value === "number") out.push({ path, value: String(value) });
  return out;
}

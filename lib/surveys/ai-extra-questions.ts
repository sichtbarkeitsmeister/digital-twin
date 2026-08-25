/**
 * KI-Zusatzfragen aus dem Fragebogen-JSON.
 * Models often return objects ({ title, description }) — String(obj) is "[object Object]".
 */

import type { ClientAudienceKind } from "@/lib/surveys/client-audience";

export type AiExtraQuestion = {
  title: string;
  description: string;
};

export function extraGapHints(kind: ClientAudienceKind): string {
  if (kind === "kanzlei") {
    return "Nur Lücken, die zu DIESER Kanzlei passen, z. B. Spezialisierung, Gericht vs. außergerichtlich, Rechtsschutzversicherung, typische Mandatsdauer — nichts aus Medizin oder Handwerk.";
  }
  if (kind === "praxis") {
    return "Nur Lücken, die zu DIESER Praxis passen, z. B. Geräte, privat/gesetzlich, Nachsorge, Vorher-Nachher — nichts aus Recht oder Bau, und nur was die Website hergibt.";
  }
  if (kind === "handwerk") {
    return "Nur Lücken, die zu DIESEM Betrieb passen, z. B. Material, Gewährleistung, Notdienst, Vor-Ort vs. Werkstatt — nichts aus Medizin oder Kanzlei.";
  }
  return "Nur Lücken aus den tatsächlichen Leistungen und der Website, nicht aus einer anderen Branche.";
}

const TITLE_KEYS = ["title", "question", "frage", "text", "prompt", "label"] as const;
const DESCRIPTION_KEYS = ["description", "hint", "why", "reason", "hinweis"] as const;
const EXAMPLE_KEYS = ["example", "beispiel", "sample"] as const;

function readString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function readKeyedString(rec: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const direct = readString(rec[key]);
    if (direct) return direct;
    const nested = rec[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = readKeyedString(nested as Record<string, unknown>, TITLE_KEYS);
      if (inner) return inner;
    }
  }
  return "";
}

function isObjectObject(value: string): boolean {
  return /^\[object object\]$/i.test(value);
}

function normalizeTitle(raw: string): string | null {
  const title = raw.replace(/^[\d.)\-\s]+/, "").trim();
  if (title.length < 12 || title.length > 220) return null;
  if (isObjectObject(title)) return null;
  if (!/[?？]|wie |was |welche |welcher |welches |wann |wo |warum |gibt es /i.test(title)) {
    // Still allow imperative/noun phrases if they look like a prompt.
    if (!/[A-ZÄÖÜa-zäöüß]{6,}/.test(title)) return null;
  }
  return title;
}

function buildDescription(rec: Record<string, unknown> | null, fallback: string): string {
  if (!rec) return fallback;
  const why = readKeyedString(rec, DESCRIPTION_KEYS);
  const example = readKeyedString(rec, EXAMPLE_KEYS);
  const parts: string[] = [];
  if (why && !isObjectObject(why)) parts.push(why);
  if (example && !isObjectObject(example)) {
    parts.push(example.startsWith("Beispiel") ? example : `Beispiel: ${example}`);
  }
  const joined = parts.join(" ").trim();
  return (joined || fallback).slice(0, 500);
}

function parseOne(raw: unknown, fallbackDescription: string): AiExtraQuestion | null {
  if (typeof raw === "string") {
    const title = normalizeTitle(raw);
    if (!title) return null;
    return { title, description: fallbackDescription };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const title = normalizeTitle(readKeyedString(rec, TITLE_KEYS));
  if (!title) return null;
  return { title, description: buildDescription(rec, fallbackDescription) };
}

export function parseAiExtraQuestions(
  raw: unknown,
  options?: { max?: number; fallbackDescription?: string; existingTitles?: string[] },
): AiExtraQuestion[] {
  const max = options?.max ?? 4;
  const fallbackDescription =
    options?.fallbackDescription ??
    "Individuelle Zusatzfrage aus Crawl/KI — bearbeiten, kopieren oder löschen.";
  const existing = new Set(
    (options?.existingTitles ?? []).map((t) => t.replace(/\s+/g, " ").trim().toLowerCase()),
  );
  const items = Array.isArray(raw) ? raw : [];
  const out: AiExtraQuestion[] = [];
  for (const item of items) {
    const parsed = parseOne(item, fallbackDescription);
    if (!parsed) continue;
    const key = parsed.title.toLowerCase();
    if (existing.has(key)) continue;
    if (out.some((row) => row.title.toLowerCase() === key)) continue;
    existing.add(key);
    out.push(parsed);
    if (out.length >= max) break;
  }
  return out;
}

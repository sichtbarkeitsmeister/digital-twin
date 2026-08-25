/**
 * KI-Zusatzfragen aus dem Fragebogen-JSON.
 * Models often return objects ({ title, description }) — String(obj) is "[object Object]".
 */

import type { ClientAudienceKind, ClientAudienceVocab } from "@/lib/surveys/client-audience";

export type AiExtraQuestion = {
  title: string;
  description: string;
};

export function extraGapHints(
  kind: ClientAudienceKind,
  purpose: "persona" | "anbieter" | "intern" = "anbieter",
): string {
  if (purpose === "persona") {
    return "Nur Fragen über DIESEN Wunschmenschen, nicht über den Betrieb. Nicht Website-Lücken oder den Praxisablauf. Stattdessen: wie oft die Person kommt, was sie zusätzlich bucht, wovor sie sich scheut, mit wem sie entscheidet, welche Alternative sie vergleicht. Lieber eine typische Frage mit Beispielsatz als ein leeres Array.";
  }
  if (kind === "kanzlei") {
    return "Nur Lücken, die zu DIESER Kanzlei passen, z. B. Spezialisierung, Gericht vs. außergerichtlich, Rechtsschutzversicherung, typische Mandatsdauer — nichts aus Medizin oder Handwerk. Lieber typische Kanzlei-Fragen mit Beispiel als ein leeres Array.";
  }
  if (kind === "praxis") {
    return "Nur Lücken, die zu DIESER Praxis passen, z. B. Geräte, privat/gesetzlich, Nachsorge, Vorher-Nachher — nichts aus Recht oder Bau. Lieber typische Praxis-Fragen mit Beispiel als ein leeres Array.";
  }
  if (kind === "handwerk") {
    return "Nur Lücken, die zu DIESEM Betrieb passen, z. B. Material, Gewährleistung, Notdienst, Vor-Ort vs. Werkstatt — nichts aus Medizin oder Kanzlei. Lieber typische Handwerk-Fragen mit Beispiel als ein leeres Array.";
  }
  return "Nur Lücken aus den tatsächlichen Leistungen und der Website, nicht aus einer anderen Branche. Lieber typische Fragen mit Beispiel als ein leeres Array.";
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

/** Last resort if the extras model call is empty — still company-typed, not blank. */
export function fallbackExtraQuestions(input: {
  kind: ClientAudienceKind;
  vocab: ClientAudienceVocab;
  services?: string[] | null;
  purpose?: "persona" | "anbieter" | "intern";
}): AiExtraQuestion[] {
  const v = input.vocab;
  if (input.purpose === "persona") {
    return [
      {
        title: `Wie oft kommt dieser ${v.singular} typischerweise — einmalig oder regelmäßig?`,
        description: `Beispiel: „Alle 1–2 Monate zur Vorsorge“ oder „Einmalig für eine konkrete ${v.engagement}.“`,
      },
      {
        title: `Bucht dieser ${v.singular} oft etwas zusätzlich zum Hauptanlass, und was genau?`,
        description: `Beispiel: „Kommt wegen A und nimmt oft B oder C mit.“`,
      },
      {
        title: `Mit wem spricht dieser ${v.singular} die Entscheidung ab, bevor er zusagt?`,
        description: `Beispiel: „Meist allein“ oder „erst mit Partnerin / Familie.“`,
      },
      {
        title: `Welche andere Lösung oder welchen anderen Anbieter vergleicht dieser ${v.singular} konkret?`,
        description: `Beispiel: eine namentlich bekannte Alternative in der Region, „abwarten“, „selbst machen“.`,
      },
    ];
  }
  const service = (input.services ?? []).map((s) => s.trim()).find((s) => s.length >= 3) || v.engagement;
  if (input.kind === "kanzlei") {
    return [
      {
        title: `Welche Spezialisierungen übernimmt die ${v.business} selbst, und was wird abgegeben?`,
        description: `Beispiel: „Arbeitsrecht intern, Strafrecht nur über Kooperationskanzlei.“`,
      },
      {
        title: `Wie oft geht ein ${v.engagement} vor Gericht, und wann bleibt es außergerichtlich?`,
        description: `Beispiel: „Die meisten Mandate enden mit Vergleich, Klage nur wenn die Gegenseite nicht reagiert.“`,
      },
      {
        title: `Spielt eine Rechtsschutzversicherung bei neuen ${v.plural} eine Rolle?`,
        description: `Beispiel: „Oft ja — wir klären Deckung vor dem ersten ausführlichen Termin.“`,
      },
      {
        title: `Wie lange dauert ein typisches ${v.engagement} von der ersten Anfrage bis zum Abschluss?`,
        description: `Beispiel: „Einfache Fälle 4–8 Wochen, komplexe oft mehrere Monate.“`,
      },
    ];
  }
  if (input.kind === "praxis") {
    return [
      {
        title: `Welche Geräte oder Methoden setzt die ${v.business} bei ${service} konkret ein?`,
        description: `Fachbegriffe für Texte. Beispiel: „Gerät/Methode plus wofür, in einem Satz.“`,
      },
      {
        title: `Behandelt die ${v.business} gesetzlich Versicherte, oder nur privat zahlende ${v.plural}?`,
        description: `Beispiel: „Privat und Selbstzahler; gesetzlich nur bei ausgewählten Leistungen.“`,
      },
      {
        title: `Wie läuft die Nachsorge nach einer ${v.engagement} — was sollen ${v.plural} tun oder lassen?`,
        description: `Beispiel: „24 Stunden Sportpause, Sonnenschutz, Kontrolltermin nach zwei Wochen.“`,
      },
      {
        title: `Dürfen Vorher-Nachher-Fotos veröffentlicht werden, und unter welchen Bedingungen?`,
        description: `Beispiel: „Nur mit schriftlicher Einwilligung, Gesicht nicht erkennbar, keine ungefragten Social-Media-Posts.“`,
      },
    ];
  }
  if (input.kind === "handwerk") {
    return [
      {
        title: `Welche Materialien oder Systeme setzt der ${v.business} bevorzugt ein, und warum genau diese?`,
        description: `Beispiel: „Marke/System plus ein praktischer Grund, kein Werbesatz.“`,
      },
      {
        title: `Gibt es einen Notdienst, und wann rückt der ${v.business} außer der Reihe an?`,
        description: `Beispiel: „Wasserschaden ja, reine Schönheitsreparaturen nur in der Normalzeit.“`,
      },
      {
        title: `Wie lange gilt die Gewährleistung über das Gesetzliche hinaus?`,
        description: `Beispiel: „Gesetzlich 5 Jahre am Bau, Materialhersteller oft 10 Jahre.“`,
      },
      {
        title: `Was passiert vor Ort, und was in der Werkstatt?`,
        description: `Beispiel: „Aufmaß und Einbau vor Ort, Zuschnitt in der Werkstatt.“`,
      },
    ];
  }
  return [
    {
      title: `Welche Tools, Plattformen oder Methoden sind für die Arbeit der ${v.business} typisch?`,
      description: `Beispiel: ein konkretes Werkzeug plus wofür es genutzt wird.`,
    },
    {
      title: `Wie wird ein ${v.engagement} intern übergeben — eine feste Ansprechperson oder mehrere Rollen?`,
      description: `Beispiel: „Vertrieb übergibt an Projektleitung, eine Person bleibt bis zum Schluss sichtbar.“`,
    },
    {
      title: `Was soll in Texten über ${service} unbedingt vorkommen, und was eher nicht?`,
      description: `Beispiel: „Klar die Leistung und die Region, keine Superlative ohne Beleg.“`,
    },
    {
      title: `Welche Nachweise oder Fallbeispiele dürfen öffentlich genannt werden?`,
      description: `Beispiel: „Referenzen nur mit Freigabe, Zahlen nur wenn sie stimmen.“`,
    },
  ];
}

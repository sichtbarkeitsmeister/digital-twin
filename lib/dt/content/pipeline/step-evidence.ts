/**
 * Two things the steps write down besides the text, so their decisions can be checked:
 *
 *   - `hero_kandidaten` (SEO): six candidates for the Hero-Überschrift (the heading of the
 *     Abschnitt „zusammenfassung“), the chosen one marked, each rejected one with its reason. It is
 *     the FIRST field of the SEO answer, so the model compares before it writes; GEO and Hormozi
 *     get the list and do not fall back to a rejected one.
 *   - `belegliste` (Faktencheck): for the factual statements of the text the sentence, its
 *     Abschnitt and where it is backed. Also first in the answer: the findings follow the evidence.
 *
 * Both are shown in the page window for the release. Pure; safe for client code and tests.
 */

export const HERO_KANDIDATEN_COUNT = 6;

export type ContentHeroKandidat = {
  text: string;
  /** The one the SEO step used as the Hero-Überschrift. Exactly one of the list. */
  gewaehlt: boolean;
  /** Why it was rejected (or, for the chosen one, why it won). */
  grund: string;
};

export type ContentBeleg = {
  /** The sentence of the text, quoted. */
  zitat: string;
  block_id: string | null;
  /** Where it is backed („Anbieterfakten › Leistungen: …“), or what is missing. */
  beleg: string;
  /** False when nothing in the facts backs the sentence. */
  belegt: boolean;
};

/** Short on purpose: the list is written before the findings and shares the Faktencheck's output budget. */
export const CONTENT_BELEGLISTE_MAX = 20;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * The candidates as the model sent them: each text once, at most six, exactly one chosen. When
 * the model marked none or several, the one whose text is the Hero-Überschrift of the written
 * text counts (`usedHeading`), else the first marked, else none.
 */
export function normalizeHeroKandidaten(raw: unknown, usedHeading?: string | null): ContentHeroKandidat[] {
  const seen = new Set<string>();
  const list: ContentHeroKandidat[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = typeof item === "string" ? { text: item } : rec(item);
    const value = text(r.text, 200);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    list.push({ text: value, gewaehlt: r.gewaehlt === true, grund: text(r.grund, 300) });
    if (list.length >= HERO_KANDIDATEN_COUNT) break;
  }
  if (list.length === 0) return [];
  const used = (usedHeading ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const byHeading = used ? list.findIndex((k) => k.text.toLowerCase() === used) : -1;
  const chosen = byHeading >= 0 ? byHeading : list.findIndex((k) => k.gewaehlt);
  return list.map((k, i) => ({ ...k, gewaehlt: i === chosen }));
}

export function readHeroKandidaten(seoOutput: unknown): ContentHeroKandidat[] {
  return normalizeHeroKandidaten(rec(seoOutput).hero_kandidaten);
}

export const HERO_KANDIDATEN_SCHEMA = {
  type: "array",
  minItems: HERO_KANDIDATEN_COUNT,
  maxItems: HERO_KANDIDATEN_COUNT,
  description: `Zuerst ausfüllen, vor dem Text: genau ${HERO_KANDIDATEN_COUNT} deutlich verschiedene Kandidaten für die Hero-Überschrift (die Überschrift des Abschnitts „zusammenfassung“). Sie gehen vom Seitenkonzept dieser Seite aus, nicht von der allgemeinen Lage des Avatars, und keiner gleicht einer Überschrift, die auf jeder Seite des Anbieters stehen könnte. Genau einer hat gewaehlt = true; er steht dann wörtlich als Überschrift im Text.`,
  items: {
    type: "object",
    properties: {
      text: { type: "string", description: "Der Kandidat, wie er als Überschrift stünde." },
      gewaehlt: { type: "boolean" },
      grund: { type: "string", description: "Verworfen: warum, in einem Satz. Gewählt: warum dieser." },
    },
    required: ["text", "gewaehlt", "grund"],
  },
} as const;

/** Fixed rule of the SEO step for the candidates. */
export const HERO_KANDIDATEN_RULES = `Hero-Kandidaten (feste Regel): Bevor du den Text schreibst, füllst du hero_kandidaten: ${HERO_KANDIDATEN_COUNT} deutlich verschiedene Kandidaten für die Hero-Überschrift (Überschrift des Abschnitts „zusammenfassung“), jeder mit Grund. Verwirf jeden Kandidaten, der auch auf einer anderen Seite dieses Anbieters stehen könnte, der nur die allgemeine Lage des Avatars beschreibt oder der ein Versprechen macht, das die Fakten nicht tragen. Genau einer ist gewählt und steht wörtlich als Überschrift im Text. Gibt die Seitentyp-Vorlage die Hero-Überschrift fest vor, ist diese der gewählte Kandidat.`;

/** The candidates as a block for GEO and Hormozi; empty when the SEO step wrote none. */
export function heroKandidatenBlock(seoOutput: unknown): string {
  const list = readHeroKandidaten(seoOutput);
  if (list.length === 0) return "";
  return [
    "## Hero-Kandidaten des SEO-Schritts (die Entscheidung steht; ein verworfener Kandidat kommt nicht zurück)",
    ...list.map((k) => `- ${k.gewaehlt ? "GEWÄHLT" : "verworfen"}: „${k.text}“${k.grund ? ` – ${k.grund}` : ""}`),
  ].join("\n");
}

/** The evidence list as the model sent it; unknown Abschnitt ids are dropped, not the entry. */
export function normalizeBelegliste(raw: unknown, knownBlockIds: ReadonlySet<string>): ContentBeleg[] {
  const out: ContentBeleg[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = rec(item);
    const zitat = text(r.zitat, 500);
    if (!zitat) continue;
    const blockId = text(r.block_id, 80);
    const beleg = text(r.beleg, 500);
    const none = !beleg || /^(kein(e|en)?\s+beleg|nicht\s+belegt|unbelegt|fehlt)\b/i.test(beleg);
    out.push({ zitat, block_id: knownBlockIds.has(blockId) ? blockId : null, beleg: beleg || "kein Beleg", belegt: r.belegt === false ? false : !none });
    if (out.length >= CONTENT_BELEGLISTE_MAX) break;
  }
  return out;
}

export function readBelegliste(faktencheckOutput: unknown): ContentBeleg[] {
  const list = rec(faktencheckOutput).belegliste;
  return (Array.isArray(list) ? list : []).flatMap((item) => {
    const r = rec(item);
    const zitat = text(r.zitat, 500);
    return zitat ? [{ zitat, block_id: text(r.block_id, 80) || null, beleg: text(r.beleg, 500) || "kein Beleg", belegt: r.belegt !== false }] : [];
  });
}

export const BELEGLISTE_SCHEMA = {
  type: "array",
  maxItems: CONTENT_BELEGLISTE_MAX,
  description: `Zuerst ausfüllen, vor den Befunden: die Tatsachenaussagen des Textes über den Anbieter (Leistungen, Zahlen, Preise, Fristen, Abläufe, Namen, Zusagen), höchstens ${CONTENT_BELEGLISTE_MAX}, die wichtigsten zuerst.`,
  items: {
    type: "object",
    properties: {
      zitat: { type: "string", description: "Der Satz aus dem Text, wörtlich." },
      block_id: { type: "string", description: "id des Abschnitts, in dem der Satz steht." },
      beleg: { type: "string", description: "Wo die Aussage belegt ist: Quelle und die belegende Stelle in wenigen Worten (z. B. „Anbieterfakten › Leistungen: Erstgespräch 60 Minuten“). Ohne Beleg: „kein Beleg“." },
      belegt: { type: "boolean", description: "false, wenn nichts in Anbieterfakten, Faktenauszug, Antworten des Kunden, Kontaktdaten oder Anmerkungen die Aussage trägt." },
    },
    required: ["zitat", "block_id", "beleg", "belegt"],
  },
} as const;

/** Fixed rule of the Faktencheck for the list. */
export const BELEGLISTE_RULES = `Belegliste (feste Regel): Bevor du Befunde meldest, füllst du belegliste: je Tatsachenaussage über den Anbieter den Satz (zitat), seinen Abschnitt (block_id) und den Beleg. Ein Beleg nennt die Quelle (Anbieterfakten mit Abschnitt, Faktenauszug, Antwort des Kunden, Kontaktdaten, Anmerkung der Redaktion) und die Stelle in wenigen Worten. Allgemeines Fachwissen ist kein Beleg für eine Aussage über den Anbieter. Jede Aussage mit belegt = false ist auch ein Befund (oder, wenn die feste Regel zu Fragen es erlaubt, eine Frage).`;

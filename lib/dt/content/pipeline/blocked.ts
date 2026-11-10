/**
 * „Gesperrt“: statements of the Anbieter evaluation that carry a release note such as „nicht
 * verwenden“ or „Freigabe offen“. The evaluation is written for people; a model reading it may
 * take the fact and miss the note, and the Faktenauszug reads the conversations themselves,
 * where the note does not exist at all. So the code pulls every marked statement out and hands
 * it over as its own block, to the Faktenauszug and to every step that gets the Anbieterfakten.
 * Pure; safe for client code and tests.
 */

/**
 * The notes that mark a statement as blocked, as the agency writes them in the evaluation.
 * `note`: the phrase is a remark about something else („Nicht aktiv bewerben, damit …“), so a
 * sentence that is nothing but the remark takes the sentence before it along. The others are
 * rules that stand for themselves („Keine Auktionshäuser namentlich nennen.“).
 *
 * Never a bare „kein“, „keine“ or „nicht“: „keine Provision, keine Lagergebühren“, „kein
 * Pauschalangebot“ and „wird nicht angekauft“ are what the text is supposed to say.
 */
export const BLOCKED_MARKERS: ReadonlyArray<{ label: string; pattern: RegExp; note: boolean }> = [
  { label: "nicht für Content verwenden", pattern: /nicht\s+für\s+content\s+verwenden/i, note: true },
  { label: "noch nicht verwenden", pattern: /noch\s+nicht\s+verwenden/i, note: true },
  { label: "nicht verwenden", pattern: /nicht\s+verwenden/i, note: true },
  { label: "namentlich nennen", pattern: /namentlich\s+nennen/i, note: false },
  { label: "nicht nennen", pattern: /nicht\s+nennen/i, note: true },
  { label: "nicht formulieren", pattern: /nicht\s+formulieren/i, note: false },
  { label: "nicht aktiv bewerben", pattern: /nicht\s+aktiv\s+bewerben/i, note: true },
  // „nicht aktiv dazu auffordern“, „nicht aktiv anbieten“ …
  { label: "nicht aktiv", pattern: /nicht\s+aktiv\b/i, note: true },
  { label: "nie als … darstellen", pattern: /\bnie\s+als\b[^.!?\n]{0,80}?\bdarstellen/i, note: false },
  // „Keine pauschalen Wertsteigerungs- oder Höchstpreisversprechen“: the noun may be a compound.
  { label: "keine pauschalen … versprechen", pattern: /\bkeine\s+pauschalen\b[^.!?\n]{0,80}?versprechen/i, note: false },
  { label: "Freigabe offen", pattern: /freigabe\s+offen/i, note: true },
  { label: "Freigabe … noch offen", pattern: /freigabe\b[^.!?\n]{0,80}?\bnoch\s+offen/i, note: true },
  // „Offener Punkt: Freigabe Use Case … durch …“ says the same the other way round.
  { label: "Freigabe offen", pattern: /offene[rn]?\s+punkt[^.!?\n]{0,20}\bfreigabe/i, note: true },
  { label: "nur erwähnen, wenn", pattern: /nur\s+erwähnen,?\s+wenn/i, note: false },
];

export const BLOCKED_HEADING = "Gesperrt (nicht verwenden, auch nicht sinngemäß)";
const STATEMENT_MAX_CHARS = 1_200;

export type BlockedStatement = {
  /** The section of the evaluation the statement stands in („Leistungen & Schwerpunkte“). */
  section: string;
  /** The statement with its note, as written. */
  text: string;
  /** The note that blocks it. */
  marker: string;
};

export function blockedMarkerOf(text: string): string | null {
  return BLOCKED_MARKERS.find((m) => m.pattern.test(text))?.label ?? null;
}

/** A note inside a label that ends with a colon: „Use Case (… Freigabe … noch offen): Text“. */
const LABELLED_NOTE_RE = /^[^.!?:]{0,160}\)\s*:\s+\S/;

/** The statement is nothing but a remark and its reason („Nicht aktiv bewerben, damit …“). */
function startsWithMarker(sentence: string): boolean {
  const start = sentence.replace(/^[\s(\[„"–-]+/, "").slice(0, 60);
  return BLOCKED_MARKERS.some((m) => m.note && start.search(m.pattern) === 0);
}

const BULLET_RE = /^\s*(?:[-–—•*·]|\d{1,2}[.)])\s+/;

/**
 * Sentences of one line. A full stop ends a sentence only before a capital letter, a quote or a
 * bracket, so „z. B.“, „ca. 480 €“ and „1.200“ stay inside their sentence; a note in brackets
 * after the full stop („… 2019. (Nicht nennen.)“) is kept with the sentence it belongs to.
 */
function sentencesOf(line: string): string[] {
  const parts = line.split(/(?<=[.!?][)\]"“”]?)\s+(?=[A-ZÄÖÜ„"(\[])/);
  const out: string[] = [];
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const bracketNote = /^[(\[]/.test(piece) && out.length > 0;
    const abbreviation = out.length > 0 && /(?:\b(?:z|u|d|o|s|v)\.\s?[a-zäöü]\.|\b(?:ca|bzw|ggf|inkl|zzgl|evtl|Nr|Abs|Art|St|Dr|Prof)\.)$/i.test(out[out.length - 1]!);
    if (bracketNote || abbreviation) out[out.length - 1] = `${out[out.length - 1]} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/**
 * Every statement of the sections that carries a note. A statement is a sentence or a list
 * item. A note that heads a list („Nicht verwenden:“ followed by items, or a line that is
 * nothing but the note) blocks every item under it, up to the next blank or unindented line.
 */
export function extractBlockedStatements(sections: ReadonlyArray<{ label: string; current: string }>): BlockedStatement[] {
  const out: BlockedStatement[] = [];
  const seen = new Set<string>();
  const add = (section: string, text: string, marker: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, STATEMENT_MAX_CHARS);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push({ section, text: clean, marker });
  };

  for (const section of sections) {
    const lines = section.current.replace(/\r\n?/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const body = line.replace(BULLET_RE, "");
      const marker = blockedMarkerOf(body);
      const headsList = /:\s*$/.test(body) && BULLET_RE.test(lines[i + 1] ?? "") && !BULLET_RE.test(line);
      if (marker && headsList) {
        // „Nicht verwenden:“ and the items it stands over.
        const items: string[] = [];
        let j = i + 1;
        while (j < lines.length && BULLET_RE.test(lines[j]!)) {
          items.push(lines[j]!.trim().replace(BULLET_RE, ""));
          j += 1;
        }
        for (const item of items) add(section.label, `${body} ${item}`, marker);
        i = j - 1;
        continue;
      }
      if (!marker) continue;
      if (BULLET_RE.test(line)) {
        add(section.label, body, marker);
        continue;
      }
      const sentences = sentencesOf(body);
      for (let k = 0; k < sentences.length; k += 1) {
        const sentence = sentences[k]!;
        const own = blockedMarkerOf(sentence);
        if (!own) continue;
        if (LABELLED_NOTE_RE.test(sentence) && !startsWithMarker(sentence)) {
          // „Use Case (ausgedacht, Freigabe … noch offen): …“: the note labels what follows,
          // which runs to the end of the paragraph.
          add(section.label, sentences.slice(k).join(" "), own);
          break;
        }
        if (startsWithMarker(sentence) && !/:\s/.test(sentence) && k > 0) {
          // „… nur für ernsthafte Kunden. Nicht aktiv bewerben, damit …“: the note is about the sentence before it.
          add(section.label, `${sentences[k - 1]} ${sentence}`, own);
          continue;
        }
        add(section.label, sentence, own);
      }
    }
  }
  return out;
}

/** The block for the prompts; empty when nothing is blocked. */
export function blockedBlock(statements: readonly BlockedStatement[], heading: "##" | "###" = "###"): string {
  if (statements.length === 0) return "";
  return [
    `${heading} ${BLOCKED_HEADING}`,
    "Diese Angaben sind in der Anbieter-Auswertung gesperrt. Sie kommen nicht in den Text und nicht in den Faktenauszug, auch nicht umschrieben, auch wenn sie an anderer Stelle (Gespräche, Faktenauszug, bisheriger Text) vorkommen. Nennt ein Vermerk nur eine Einschränkung („nur erwähnen, wenn“, „nicht aktiv …“, „namentlich nennen“, „nie als … darstellen“, „keine pauschalen … versprechen“), gilt genau diese Einschränkung.",
    ...statements.map((s) => `- [${s.section}] ${s.text}`),
  ].join("\n");
}

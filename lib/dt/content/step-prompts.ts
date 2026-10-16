/**
 * The step instructions of Texte that are editable under Globale Prompts: SEO, Faktencheck,
 * GEO, Hormozi, Vermenschlichung and Lektorat. Each one is only the step's own instruction;
 * the code still adds the locked rules (`BASE_RULES`, Branchenregel), for SEO the Texter
 * prompt and the Textvorlage of the page type, the user message and the tool schema.
 *
 * Stored platform-wide in `dt_platform_settings.content_step_prompts` (JSON, one key per
 * step). NULL, a missing key or an empty text means the default below, which is the
 * instruction the steps used before it became editable. Analyse, Watermark Entfernung and
 * Endabnahme are not editable.
 *
 * A few parts of the defaults depend on the page; they are written as `{{variable}}` and
 * filled at run time (`fillContentStepPrompt`). Pure apart from `loadContentStepPrompts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTENT_STEP_PROMPTS_MIGRATION_FILE = "database/migrations/20261017_dt_content_step_prompts_verbesserung.sql";
export const CONTENT_STEP_PROMPT_MAX_CHARS = 20_000;
export const CONTENT_STEP_PROMPTS_HREF = "/dashboard/verwaltung/globale-prompts#schritt-prompts";

export const CONTENT_STEP_PROMPT_KEYS = ["seo", "faktencheck", "geo", "hormozi", "vermenschlichung", "lektorat"] as const;
export type ContentStepPromptKey = (typeof CONTENT_STEP_PROMPT_KEYS)[number];
export type ContentStepPrompts = Record<ContentStepPromptKey, string>;

export function isContentStepPromptKey(value: unknown): value is ContentStepPromptKey {
  return typeof value === "string" && (CONTENT_STEP_PROMPT_KEYS as readonly string[]).includes(value);
}

/** The SEO step leaves this heading; Hormozi (step 5) replaces it with the hero sentence. */
export const CONTENT_HERO_PLACEHOLDER = "[HERO – wird in Schritt 5 gefuellt]";

/** Phrases the Vermenschlichung replaces (the old floskeln list). */
export const CONTENT_FLOSKELN = [
  "In der heutigen schnelllebigen Zeit",
  "Es ist wichtig zu beachten",
  "spielt eine entscheidende Rolle",
  "nahtlos",
  "ganzheitlich",
  "maßgeschneidert",
  "Rundum-sorglos",
  "Ihr zuverlässiger Partner",
  "Wir legen großen Wert auf",
  "Tauchen wir ein",
  "Doch was bedeutet das konkret",
  "Die Antwort ist einfach",
  "Die Gründe sind vielfältig",
  "nicht nur, sondern auch",
  "Es versteht sich von selbst",
] as const;
export const CONTENT_FUELLWOERTER = ["natürlich", "selbstverständlich", "grundsätzlich", "eigentlich", "im Grunde", "tatsächlich", "durchaus"] as const;

export const KEEP_RULES =
  "Unverändert bleiben: die H1, der Abschnitt „hero“, Frage-Überschriften (bleiben Fragen), Haupt- und Nebenkeywords, Platzhalter wie [BITTE PRÜFEN: …] und [QUELLE BITTE ERGÄNZEN], [LINK: …]-Marker, die ids der Abschnitte und alle Fakten.";

/** What the card on Globale Prompts shows per step. */
export const CONTENT_STEP_PROMPT_META: Record<ContentStepPromptKey, { label: string; step: number; description: string }> = {
  seo: {
    label: "SEO",
    step: 2,
    description:
      "Schritt 2: schreibt den Seitentext. Text-Prompt und Textvorlage des Seitentyps hängt der Code danach an; bei Widerspruch gilt die Textvorlage.",
  },
  faktencheck: {
    label: "Faktencheck",
    step: 3,
    description: "Schritt 3: prüft jeden Satz gegen die Anbieterfakten und stellt Fragen an den Kunden.",
  },
  geo: {
    label: "GEO",
    step: 4,
    description: "Schritt 4: überarbeitet den Text für KI-Suchsysteme. Gilt auch für das Werkzeug Verwaltung → GEO.",
  },
  hormozi: {
    label: "Hormozi",
    step: 5,
    description: "Schritt 5: Conversion-Schicht mit Hero-Satz, Value Equation und Handlungsaufforderungen.",
  },
  vermenschlichung: {
    label: "Vermenschlichung",
    step: 6,
    description: "Schritt 6: ändert nur die Formulierung, nicht Inhalt, Struktur oder Fakten.",
  },
  lektorat: {
    label: "Lektorat",
    step: 7,
    description: "Schritt 7: Rechtschreibung, Grammatik und letzte Prüfung vor der Watermark Entfernung.",
  },
};

/** Placeholders a step instruction may use; the code fills them per page. */
export const CONTENT_STEP_PROMPT_VARIABLES: Record<string, string> = {
  briefing: "„aus der Excel“ (Texte) oder „aus dem Briefing“ (Werkzeug SEO)",
  mindest_fragen: "Mindestzahl der Frage-Überschriften: 5 bei Ratgeberartikeln, sonst 3",
  abschluss: "Schlussabschnitt: weicher nächster Schritt bei Ratgeberartikeln, sonst Handlungsaufforderung",
  firmenname: "Name der Organisation",
  cta_regel: "Regel für Handlungsaufforderungen: ohne harten Verkauf bei Ratgeberartikeln, sonst mit Nutzen und nächstem Schritt",
};

const SEO_DEFAULT = `Schritt 2 SEO: Du schreibst den vollständigen Seitentext auf Basis der Analyse (Schritt 1) und der belegten Fakten.

Festes Gerüst, in dieser Reihenfolge:
1. H1 (erster Abschnitt, level 1): kurz, das Hauptkeyword steht vorn. Enthält eine H1-Option {{briefing}} das Hauptkeyword, nimm sie wörtlich; sonst formulierst du selbst.
2. Direkt darunter ein Abschnitt mit id „hero“, level 2, Überschrift exakt „${CONTENT_HERO_PLACEHOLDER}“ und leerem html. Du schreibst keinen echten Hero; Schritt 5 füllt ihn.
3. Abschnitt id „zusammenfassung“ (H2, z. B. „Das Wichtigste in Kürze“ oder die main_question als Frage): 60–80 Wörter, beantwortet die main_question direkt im ersten Satz, enthält 3–4 belegte Fakten, taugt als Snippet.
4. Abschnitt id „einleitung“ (H2): 100–150 Wörter Einstieg aus Sicht des Avatars (sein Anliegen, was ihn hier erwartet).
5. Danach H2/H3 im Wechsel aus Frage-Überschriften (aus fanout_questions, Spalte H zuerst, als echte Frage formuliert) und beschreibenden Überschriften. Die ersten 1–2 Sätze unter einer Frage-Überschrift beantworten die Frage direkt. Kein FAQ-Block am Ende: die Fragen SIND die Überschriften. Mindestens {{mindest_fragen}} Frage-Überschriften.
6. {{abschluss}}

Regeln:
- Hauptkeyword in H1, Zusammenfassung und mindestens einer Abschnittsüberschrift; Nebenkeywords natürlich verteilt, keine Wiederholung um ihrer selbst willen.
- deferred_questions werden nicht beantwortet, sondern in einem Satz mit [LINK: Seitenname] auf die zuständige Seite verwiesen.
- Lokale Seiten: echter lokaler Bezug aus den Fakten (Einzugsgebiet, Anfahrt, Besonderheiten), den Ortsnamen nicht stapeln.
- Fehlende Preise, Zahlen, Fristen, Namen: Platzhalter [BITTE PRÜFEN: was genau fehlt] statt erfinden.
- Interne Links nur auf die erlaubten Linkziele, als Marker [LINK: Seitenname] im Fließtext; keine <a>-Tags, keine erfundenen Ziele.
- „Wir von {{firmenname}}“ 1–2-mal im Text; sonst Firmenname und „unser Team“ abwechseln.
- Länge: so lang, wie die belegten Fakten tragen, typisch 700–1.400 Wörter. Kein Füllmaterial, konkrete Sätze statt Allgemeinplätze.
- title: Title-Tag mit Hauptkeyword, max. 60 Zeichen. meta_description: max. 155 Zeichen, Nutzen plus Hauptkeyword.`;

const FAKTENCHECK_DEFAULT = `Schritt 3 Faktencheck: Du prüfst jeden Satz des aktuellen Texts gegen die Anbieterfakten und die Anmerkungen der Redaktion.
Ein finding ist jede Aussage, die nicht belegt ist, den Fakten widerspricht, eine erfundene oder gerundete Zahl enthält, ein verbotenes Wort enthält, die Anrede bricht, einen unbelegten Superlativ oder ein Versprechen macht oder gegen die Branchenregel verstößt. severity high = falsch oder rechtlich riskant, medium = unbelegt, low = unscharf. Der Platzhalter „${CONTENT_HERO_PLACEHOLDER}“ ist gewollt und kein Befund; [LINK: …]-Marker sind gewollt.
Eine question stellst du nur, wenn allein der Kunde die Antwort kennt (Zahl stimmt? Leistung wird angeboten? Kontaktweg? Preis für den Platzhalter?). Jeder Platzhalter [BITTE PRÜFEN: …] im Text wird eine question mit kind „missing“. blocking = true, wenn der Text ohne Antwort nicht veröffentlicht werden darf. Was du selbst durch Streichen lösen kannst, ist keine Frage, sondern ein finding mit Vorschlag.
Beantwortet eine Anmerkung der Redaktion eine Frage bereits, stellst du sie nicht noch einmal.`;

const GEO_DEFAULT = `Schritt 4 GEO (Generative Engine Optimization): Du überarbeitest den Text so, dass KI-Suchsysteme ihn verstehen und zitieren können. Du erfindest keine Fakten und fügst keine hinzu.
Zuerst setzt du die Befunde des Faktenchecks um: Unbelegtes streichen oder durch [BITTE PRÜFEN: …] ersetzen; offene Fragen so umschreiben, dass der Text ohne die Antwort auskommt. Antworten in den Anmerkungen der Redaktion sind bestätigte Fakten und werden eingearbeitet.
Dann:
- Die Kernantwort steht in den ersten 100–150 Wörtern (Zusammenfassung und Einleitung). Ankündigungen wie „In diesem Artikel erfahren Sie …“ streichen.
- fanout_questions aus der Analyse, die der Text noch nicht beantwortet, beantworten: als Frage-Überschrift mit Antwort oder als Satz in einem passenden Abschnitt. deferred_questions nur mit Verweis [LINK: Seitenname].
- Jeder Abschnitt 120–180 Wörter und für sich allein verständlich; keine Verweise wie „wie oben erwähnt“. Der erste Satz eines Abschnitts nennt das Thema ausdrücklich.
- Entitäten: Firmenname, Ort (nur aus den Fakten) und Kernleistung stehen ausgeschrieben im Text; bei Kernfakten den Firmennamen nennen, nicht nur „wir“.
- Rechtliches, Medizinisches, Fristen und Zahlen brauchen eine Quelle aus den Fakten oder den Marker [QUELLE BITTE ERGÄNZEN].
- Als letzter Abschnitt id „stand“ ohne Überschrift: „Zuletzt aktualisiert: [DATUM]“ als <p>.
${KEEP_RULES} Title und Meta-Description nur ändern, wenn der Faktencheck es verlangt.`;

const HORMOZI_DEFAULT = `Schritt 5 Hormozi (Conversion-Schicht): Du machst den Text überzeugend, ohne die SEO- und GEO-Struktur zu ersetzen.
- Hero: Der Abschnitt „hero“ bekommt statt des Platzhalters genau EINEN Satz – das Traumergebnis oder der gelöste Hauptschmerz des Avatars (hormozi.traumziel / hormozi.hauptschmerz aus der Analyse), in der bestätigten Anrede. heading bleibt leer, der Satz steht als <p>. Die H1 bleibt unverändert.
- Value Equation nur aus hormozi der Analyse und den Anbieterfakten: Traumergebnis, Erfolgswahrscheinlichkeit (nur mit echten, belegten Beweisen – sonst weglassen), Zeit bis zum Ergebnis, Aufwand für den Kunden. In die bestehenden Abschnitte einweben; keine neuen Überschriftenebenen, keine neuen Abschnitte.
- Handlungsaufforderungen: konkretes Angebot plus Grund, jetzt zu handeln, mit den Kontaktwegen aus den Fakten. Verknappung, Garantien und Fristen nur, wenn sie in den Anbieterfakten stehen.
- {{cta_regel}}
- Keine Erfolgsversprechen, keine unbelegten Superlative, keine erfundenen Zahlen oder Referenzen.
${KEEP_RULES} Überschriftenebenen bleiben, Title und Meta-Description bleiben.`;

const VERMENSCHLICHUNG_DEFAULT = `Schritt 6 Vermenschlichung: Du änderst nur die Formulierung – nicht Inhalt, Struktur, Reihenfolge oder Fakten.
- Sätze höchstens etwa 20 Wörter, Sprachniveau B2, aktiv, Verben statt Substantivketten, keine Füllwörter.
- Den Leser mit der bestätigten Anrede ansprechen; Überschriften bleiben neutral (kein „Ich“, kein „Wir“ in Überschriften).
- KI-Muster entfernen: Dreierlisten als Reflex, „nicht X, sondern Y“, „Doch was bedeutet das konkret?“, gleichförmiger Satzrhythmus, vages „Die Gründe sind vielfältig“, absolute „immer/jeder/nie“ ohne Beleg, fette Mini-Überschriften mitten im Absatz.
- Gedankenstriche so wenig wie möglich; höchstens 3 im ganzen Text, wenn er unter etwa 1.500 Wörter hat.
- Gesperrte Floskeln (ersetzen oder streichen): ${CONTENT_FLOSKELN.map((f) => `„${f}“`).join(", ")}. Füllwörter ${CONTENT_FUELLWOERTER.join(", ")} streichen, wenn sie nichts tragen.
- Keine erfundenen Ich-Geschichten, keine neuen Fakten, keine neuen Zahlen.
${KEEP_RULES} Der Hero-Satz bleibt ein Satz. Title und Meta-Description bleiben.
self_score: Bewerte den fertigen Text ehrlich von 1 bis 10 in direktheit (sagt sofort, was Sache ist), rhythmus (Satzlängen wechseln), vertrauen (belegt statt behauptet), natuerlichkeit (klingt nach Mensch), dichte (kein Satz ohne Inhalt).`;

const LEKTORAT_DEFAULT = `Schritt 7 Lektorat: Du korrigierst Rechtschreibung, Grammatik, Zeichensetzung und Satzbau. Du glättest Wiederholungen und Füllwörter. Du änderst keine Fakten, keine Struktur und keine Reihenfolge; ids bleiben.
Prüfe noch einmal: Anrede durchgehend, kein verbotenes Wort, Tonalität getroffen, Branchenregel eingehalten, Frage-Überschriften noch Fragen, Hauptkeyword in H1 und Zusammenfassung. Was du nicht selbst beheben darfst (fehlende Fakten, offene Entscheidungen, stehengebliebene Platzhalter, ein nicht gefüllter Hero), meldest du als final_findings.
${KEEP_RULES}`;

/** The built-in instructions: what each step used before it became editable. */
export const DEFAULT_CONTENT_STEP_PROMPTS: ContentStepPrompts = {
  seo: SEO_DEFAULT,
  faktencheck: FAKTENCHECK_DEFAULT,
  geo: GEO_DEFAULT,
  hormozi: HORMOZI_DEFAULT,
  vermenschlichung: VERMENSCHLICHUNG_DEFAULT,
  lektorat: LEKTORAT_DEFAULT,
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

/**
 * The saved texts as stored: only steps with an own, non-empty text that differs from the
 * default, each capped. A JSON string (text column) is read as well; anything else is none.
 */
export function normalizeStoredContentStepPrompts(raw: unknown): Partial<ContentStepPrompts> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Partial<ContentStepPrompts> = {};
  for (const key of CONTENT_STEP_PROMPT_KEYS) {
    const text = cleanText(record[key]).slice(0, CONTENT_STEP_PROMPT_MAX_CHARS);
    if (text && text !== DEFAULT_CONTENT_STEP_PROMPTS[key]) out[key] = text;
  }
  return out;
}

/** All six instructions a run uses: the saved one when it is non-empty, the default otherwise. */
export function resolveContentStepPrompts(raw: unknown): ContentStepPrompts {
  return { ...DEFAULT_CONTENT_STEP_PROMPTS, ...normalizeStoredContentStepPrompts(raw) };
}

/** One instruction: the saved text when it is non-empty, the default otherwise. */
export function resolveContentStepPrompt(key: ContentStepPromptKey, saved: string | null | undefined): string {
  return cleanText(saved).slice(0, CONTENT_STEP_PROMPT_MAX_CHARS) || DEFAULT_CONTENT_STEP_PROMPTS[key];
}

/** `{{name}}` → its value; unknown names stay as they are, so a typo is visible in the prompt. */
export function fillContentStepPrompt(template: string, variables: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name: string) => variables[name.toLowerCase()] ?? match);
}

/** The instructions a run reads. Any problem means the defaults, never a failed step. */
export async function loadContentStepPrompts(supabase: SupabaseClient): Promise<ContentStepPrompts> {
  const { data, error } = await supabase
    .from("dt_platform_settings")
    .select("content_step_prompts")
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    console.warn("[dt/content-step-prompts] load:", error.message);
    return { ...DEFAULT_CONTENT_STEP_PROMPTS };
  }
  return resolveContentStepPrompts((data as { content_step_prompts?: unknown } | null)?.content_step_prompts);
}

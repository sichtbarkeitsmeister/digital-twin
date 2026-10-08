/**
 * Prompts, tool schemas and output normalisation for the eight steps.
 * Pure: no Supabase, no Anthropic client. `run-step.ts` wires them to the model.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  CONTENT_BRANCHE_LABELS,
  contentTonalitaetText,
  type ContentTextSettings,
  type WorkshopAnbieterSection,
} from "@/lib/dt/content/mapping";
import {
  blocksToPromptText,
  normalizeBlocks,
  slugify,
  type ContentTextBlock,
} from "@/lib/dt/content/render";
import type { ContentFinding, ContentQuestion } from "@/lib/dt/content/types";

export type ContentPipelineContext = {
  organisationName: string;
  page: { name: string; path: string | null; level: number; url?: string | null };
  structureOutline: string;
  /** Current text of the live page for pages taken over from the crawl; null otherwise. */
  existingText: string | null;
  sections: WorkshopAnbieterSection[];
  settings: ContentTextSettings;
  avatar: { name: string; role: string; beschreibung: string } | null;
  /** Human notes from "Mit Anmerkung wiederholen", oldest first. */
  notes: string[];
  /** Normalised outputs of earlier steps, by step number. */
  outputs: Partial<Record<number, unknown>>;
  /** Current text (page HTML parsed into blocks); empty before step 3. */
  blocks: ContentTextBlock[];
  title: string | null;
  metaDescription: string | null;
};

export type RechercheOutput = {
  main_keyword: string;
  secondary_keywords: string[];
  search_intent: string;
  user_questions: string[];
  page_goal: string;
  usable_facts: string[];
  missing_facts: string[];
};

export type GliederungOutput = {
  title: string;
  meta_description: string;
  outline: Array<{ id: string; heading: string; purpose: string; points: string[] }>;
};

export type TextOutput = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
};

export type FaktencheckOutput = { findings: ContentFinding[]; questions: ContentQuestion[] };
export type LektoratOutput = TextOutput & { final_findings: ContentFinding[] };
export type EndabnahmeOutput = { unresolved: ContentFinding[]; summary: string };

export type ContentStepSpec = {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  normalize: (json: unknown, context: ContentPipelineContext) => unknown;
};

const MAX_SECTION_CHARS = 6_000;
const MAX_AVATAR_CHARS = 5_000;
const MAX_OUTLINE_CHARS = 5_000;
const MAX_EXISTING_TEXT_CHARS = 6_000;

const SEVERITY_LABELS: Record<string, string> = {
  high: "Wichtig",
  medium: "Mittel",
  low: "Hinweis",
};

// --- helpers --------------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

function str(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, 400))
    .filter(Boolean)
    .slice(0, max);
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeFindings(raw: unknown, knownBlockIds: ReadonlySet<string>): ContentFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentFinding[] = [];
  for (const item of raw.slice(0, 30)) {
    const r = rec(item);
    const title = str(r.title, 200);
    const problem = str(r.problem, 1_000);
    if (!title && !problem) continue;
    const severity = ["high", "medium", "low"].includes(String(r.severity)) ? String(r.severity) : "medium";
    const blockId = str(r.block_id, 80);
    out.push({
      title: title || problem.slice(0, 80),
      problem,
      proposal: str(r.proposal, 1_000),
      severity,
      severity_label: SEVERITY_LABELS[severity] ?? "Mittel",
      block_id: knownBlockIds.has(blockId) ? blockId : null,
    });
  }
  return out;
}

export function normalizeQuestions(raw: unknown, knownBlockIds: ReadonlySet<string>): ContentQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentQuestion[] = [];
  for (const item of raw.slice(0, 20)) {
    const r = rec(item);
    const question = str(r.question, 600);
    if (!question) continue;
    const blockId = str(r.block_id, 80);
    out.push({
      kind: ["fact", "decision", "missing"].includes(String(r.kind)) ? String(r.kind) : "fact",
      question,
      field: str(r.field, 80) || null,
      placeholder: str(r.placeholder, 200) || null,
      block_id: knownBlockIds.has(blockId) ? blockId : null,
      excerpt: str(r.excerpt, 500) || null,
      blocking: r.blocking !== false,
    });
  }
  return out;
}

function blockIds(blocks: readonly ContentTextBlock[]): Set<string> {
  return new Set(blocks.map((b) => b.id));
}

function normalizeTextOutput(json: unknown, context: ContentPipelineContext): TextOutput {
  const r = rec(json);
  const blocks = normalizeBlocks(r.blocks);
  return {
    blocks: blocks.length > 0 ? blocks : context.blocks,
    title: str(r.title, 200) || context.title,
    meta_description: str(r.meta_description, 400) || context.metaDescription,
  };
}

// --- shared prompt parts ----------------------------------------------------------------------

function anbieterBlock(context: ContentPipelineContext): string {
  const filled = context.sections.filter((s) => s.current.trim());
  if (filled.length === 0) return "## Anbieterfakten\n(keine)";
  return [
    "## Anbieterfakten aus Fragebogen und Kundengesprächen (einzige Quelle für Tatsachen)",
    ...filled.map((s) => `### ${s.label}\n${clip(s.current, MAX_SECTION_CHARS)}`),
  ].join("\n\n");
}

function settingsBlock(settings: ContentTextSettings): string {
  const forbidden = settings.verbotene_woerter.length
    ? settings.verbotene_woerter.map((w) => `„${w}“`).join(", ")
    : "keine";
  return [
    "## Vorgaben",
    `Anrede: ${settings.anrede === "Du" ? "Du (Leser werden geduzt)" : "Sie (Leser werden gesiezt)"}`,
    `Branche: ${CONTENT_BRANCHE_LABELS[settings.branche]}`,
    `Tonalität: ${contentTonalitaetText(settings.tonalitaet)}`,
    `Verbotene Wörter (dürfen nirgends vorkommen, auch nicht in Überschriften): ${forbidden}`,
  ].join("\n");
}

function brancheRules(settings: ContentTextSettings): string {
  switch (settings.branche) {
    case "rechtsanwalt":
      return "Branchenregel Kanzlei: keine Erfolgsversprechen, keine Garantien zum Ausgang eines Verfahrens, keine Superlative wie „der beste Anwalt“. Fachgebiete nur nennen, wenn sie in den Anbieterfakten stehen.";
    case "arzt":
      return "Branchenregel Praxis (Heilmittelwerbegesetz): keine Heilversprechen, keine Erfolgsquoten, keine Vorher-nachher-Vergleiche, keine Angst machenden Formulierungen. Behandlungen nur nennen, wenn sie in den Anbieterfakten stehen.";
    default:
      return "Branchenregel Handwerk & Dienstleistung: Preise, Fristen und Garantien nur so, wie sie in den Anbieterfakten stehen. Keine erfundenen Referenzen oder Zahlen.";
  }
}

function avatarBlock(context: ContentPipelineContext): string {
  if (!context.avatar) return "## Avatar (Wunschkunde)\n(kein Avatar hinterlegt)";
  return [
    "## Avatar (Wunschkunde, für den der Text geschrieben wird)",
    `Name: ${context.avatar.name}`,
    context.avatar.role ? `Rolle: ${context.avatar.role}` : "",
    clip(context.avatar.beschreibung, MAX_AVATAR_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
}

function pageBlock(context: ContentPipelineContext): string {
  return [
    "## Seite",
    `Organisation: ${context.organisationName}`,
    `Seite: ${context.page.name}`,
    context.page.path ? `Pfad: ${context.page.path}` : "",
    `Ebene in der Struktur: ${context.page.level} (0 = Startseite/oberste Ebene)`,
    context.page.url ? `Live-URL: ${context.page.url}` : "",
    context.structureOutline
      ? `\n## Webseitenstruktur (zur Einordnung, keine Fakten)\n${clip(context.structureOutline, MAX_OUTLINE_CHARS)}`
      : "",
    context.existingText
      ? `\n## Bisheriger Text der Seite (Live-Website, nur zur Orientierung)\nSo liest sich die Seite heute: Thema, Umfang, Begriffe. Fakten daraus gelten nur, wenn sie auch in den Anbieterfakten stehen – sonst sind sie unbelegt.\n${clip(context.existingText, MAX_EXISTING_TEXT_CHARS)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function notesBlock(context: ContentPipelineContext): string {
  if (context.notes.length === 0) return "";
  return [
    "## Anmerkungen der Redaktion (gelten vor allem anderen; Antworten darin sind bestätigte Fakten)",
    ...context.notes.map((n, i) => `${i + 1}. ${clip(n, 2_000)}`),
  ].join("\n");
}

function outputBlock(context: ContentPipelineContext, step: number, title: string): string {
  const output = context.outputs[step];
  if (!output) return "";
  return `## ${title}\n${JSON.stringify(output, null, 1).slice(0, 8_000)}`;
}

function currentTextBlock(context: ContentPipelineContext): string {
  if (context.blocks.length === 0) return "## Aktueller Text\n(noch keiner)";
  return [
    "## Aktueller Text (Abschnitte mit ihrer id)",
    context.title ? `Title-Tag: ${context.title}` : "",
    context.metaDescription ? `Meta-Description: ${context.metaDescription}` : "",
    blocksToPromptText(context.blocks),
  ]
    .filter(Boolean)
    .join("\n");
}

const BASE_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte) kommen ausschließlich aus den Anbieterfakten und den Anmerkungen der Redaktion. Nichts erfinden, nichts aus Branchenwissen ergänzen. Fehlt eine Angabe, bleibt sie weg oder wird als offene Frage gemeldet.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten ohne Ausnahme.`;

const BLOCKS_SCHEMA = {
  type: "array",
  description:
    "Der komplette Text als geordnete Abschnitte. Der erste Abschnitt trägt die H1 (level 1), danach H2 (level 2), bei Bedarf H3 (level 3).",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "Kurze, stabile Kennung in Kleinbuchstaben, z. B. intro, ablauf, faq. Bestehende ids beibehalten." },
      heading: { type: "string", description: "Überschrift ohne HTML. Leer, wenn der Abschnitt keine hat." },
      level: { type: "integer", enum: [1, 2, 3] },
      html: {
        type: "string",
        description: "Fließtext als HTML mit <p>, <ul>/<ol>/<li>, <strong>, <em>. Keine Überschrift hier, kein <section>, kein <div>.",
      },
    },
    required: ["id", "heading", "level", "html"],
  },
} as const;

const FINDINGS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "Kurztitel, max. 8 Wörter." },
      problem: { type: "string", description: "Was genau ist das Problem, mit Zitat der Stelle." },
      proposal: { type: "string", description: "Konkreter Vorschlag, wie es zu lösen ist." },
      severity: { type: "string", enum: ["high", "medium", "low"] },
      block_id: { type: "string", description: "id des betroffenen Abschnitts, oder leer." },
    },
    required: ["title", "problem", "proposal", "severity", "block_id"],
  },
} as const;

// --- the eight steps ---------------------------------------------------------------------------

function recherche(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 4_096,
    system: `${BASE_RULES}

Schritt 1 Recherche: Du legst fest, wonach Menschen suchen, wenn sie diese Seite brauchen, was die Seite leisten muss und welche Fakten dafür belegt sind.
Hauptbegriff: die Suchanfrage, die am besten zu Seite und Leistung passt, mit Ort, wenn der Anbieter regional arbeitet und ein Ort in den Fakten steht.
missing_facts: was der Text bräuchte, aber nirgends belegt ist. Lieber benennen als später erfinden.`,
    user: [pageBlock(context), anbieterBlock(context), settingsBlock(context.settings), avatarBlock(context), notesBlock(context)]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_recherche",
      description: "Suchintention, Begriffe und Faktenlage für diese Seite.",
      input_schema: {
        type: "object",
        properties: {
          main_keyword: { type: "string", description: "Hauptsuchbegriff, 2–5 Wörter." },
          secondary_keywords: { type: "array", items: { type: "string" }, description: "3–8 Nebenbegriffe und Synonyme." },
          search_intent: { type: "string", description: "Was der Suchende will, in 1–2 Sätzen." },
          user_questions: { type: "array", items: { type: "string" }, description: "4–8 Fragen, die Besucher dieser Seite haben." },
          page_goal: { type: "string", description: "Was die Seite erreichen soll (Anfrage, Anruf, Termin …), in einem Satz." },
          usable_facts: { type: "array", items: { type: "string" }, description: "Belegte Fakten aus den Anbieterfakten, die auf diese Seite gehören." },
          missing_facts: { type: "array", items: { type: "string" }, description: "Fehlende Angaben, die der Text eigentlich bräuchte." },
        },
        required: ["main_keyword", "secondary_keywords", "search_intent", "user_questions", "page_goal", "usable_facts", "missing_facts"],
      },
    },
    normalize: (json): RechercheOutput => {
      const r = rec(json);
      return {
        main_keyword: str(r.main_keyword, 120),
        secondary_keywords: strList(r.secondary_keywords, 12),
        search_intent: str(r.search_intent, 600),
        user_questions: strList(r.user_questions, 12),
        page_goal: str(r.page_goal, 400),
        usable_facts: strList(r.usable_facts, 40),
        missing_facts: strList(r.missing_facts, 20),
      };
    },
  };
}

function gliederung(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 4_096,
    system: `${BASE_RULES}

Schritt 2 Gliederung: Du planst die Abschnitte der Seite. Jeder Abschnitt hat eine id, eine Überschrift, einen Zweck und die Punkte, die hineingehören – nur aus belegten Fakten.
Reihenfolge: Einstieg mit Nutzen, dann Leistung/Ablauf, Vertrauen/Beweise, Fragen, Handlungsaufforderung. Je nach Seite 4–8 Abschnitte. Der erste Abschnitt ist die H1.
title: Title-Tag mit Hauptbegriff, max. 60 Zeichen. meta_description: max. 155 Zeichen, mit Hauptbegriff und Nutzen.`,
    user: [pageBlock(context), outputBlock(context, 1, "Recherche (Schritt 1)"), anbieterBlock(context), settingsBlock(context.settings), avatarBlock(context), notesBlock(context)]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_gliederung",
      description: "Gliederung der Seite.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          meta_description: { type: "string" },
          outline: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Kurze Kennung in Kleinbuchstaben, z. B. intro, leistungen, ablauf, faq, kontakt." },
                heading: { type: "string" },
                purpose: { type: "string", description: "Was der Abschnitt beim Leser bewirken soll." },
                points: { type: "array", items: { type: "string" }, description: "Belegte Punkte, die hineingehören." },
              },
              required: ["id", "heading", "purpose", "points"],
            },
          },
        },
        required: ["title", "meta_description", "outline"],
      },
    },
    normalize: (json): GliederungOutput => {
      const r = rec(json);
      const used = new Set<string>();
      const outline: GliederungOutput["outline"] = [];
      for (const item of Array.isArray(r.outline) ? r.outline.slice(0, 12) : []) {
        const o = rec(item);
        const heading = str(o.heading, 200);
        if (!heading) continue;
        let id = slugify(str(o.id, 60) || heading) || "abschnitt";
        let n = 2;
        const base = id;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        outline.push({ id, heading, purpose: str(o.purpose, 400), points: strList(o.points, 12) });
      }
      return { title: str(r.title, 200), meta_description: str(r.meta_description, 400), outline };
    },
  };
}

function rohtext(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 3 Rohtext: Du schreibst den vollständigen Seitentext entlang der Gliederung. Jeder Gliederungspunkt wird ein Abschnitt mit derselben id.
Länge: so lang, wie die belegten Fakten tragen, typisch 500–1.200 Wörter. Kein Füllmaterial. Konkrete Sätze statt Allgemeinplätze. Jeder Abschnitt beantwortet eine Frage des Lesers.
Der Hauptbegriff steht in der H1 und im ersten Absatz, natürlich formuliert. Die Handlungsaufforderung nennt nur Kontaktwege, die in den Fakten stehen.
${brancheRules(context.settings)}`,
    user: [
      pageBlock(context),
      outputBlock(context, 1, "Recherche (Schritt 1)"),
      outputBlock(context, 2, "Gliederung (Schritt 2)"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_text",
      description: "Der vollständige Seitentext in Abschnitten.",
      input_schema: {
        type: "object",
        properties: { blocks: BLOCKS_SCHEMA },
        required: ["blocks"],
      },
    },
    normalize: (json, ctx): TextOutput => {
      const out = normalizeTextOutput(json, ctx);
      const outline = ctx.outputs[2] as GliederungOutput | undefined;
      return {
        ...out,
        title: outline?.title || out.title,
        meta_description: outline?.meta_description || out.meta_description,
      };
    },
  };
}

function faktencheck(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 6_000,
    system: `${BASE_RULES}

Schritt 4 Faktencheck: Du prüfst jeden Satz des aktuellen Texts gegen die Anbieterfakten und die Anmerkungen der Redaktion.
Ein finding ist jede Aussage, die nicht belegt ist, den Fakten widerspricht, ein verbotenes Wort enthält, die Anrede bricht oder gegen die Branchenregel verstößt. severity high = falsch oder rechtlich riskant, medium = unbelegt, low = unscharf.
Eine question stellst du nur, wenn allein der Kunde die Antwort kennt (Zahl stimmt? Leistung wird angeboten? Kontaktweg?). blocking = true, wenn der Text ohne Antwort nicht veröffentlicht werden darf. Was du selbst durch Streichen lösen kannst, ist keine Frage, sondern ein finding mit Vorschlag.
Beantwortet eine Anmerkung der Redaktion eine Frage bereits, stellst du sie nicht noch einmal.
${brancheRules(context.settings)}`,
    user: [pageBlock(context), currentTextBlock(context), anbieterBlock(context), settingsBlock(context.settings), notesBlock(context)]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_faktencheck",
      description: "Befunde und Fragen an den Kunden.",
      input_schema: {
        type: "object",
        properties: {
          findings: FINDINGS_SCHEMA,
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["fact", "decision", "missing"] },
                question: { type: "string" },
                field: { type: "string", description: "Betroffener Anbieter-Abschnitt (z. B. beweise, preis), oder leer." },
                placeholder: { type: "string", description: "Beispiel für eine Antwort." },
                block_id: { type: "string" },
                excerpt: { type: "string", description: "Der Satz aus dem Text, um den es geht." },
                blocking: { type: "boolean" },
              },
              required: ["kind", "question", "field", "placeholder", "block_id", "excerpt", "blocking"],
            },
          },
        },
        required: ["findings", "questions"],
      },
    },
    normalize: (json, ctx): FaktencheckOutput => {
      const r = rec(json);
      const ids = blockIds(ctx.blocks);
      return { findings: normalizeFindings(r.findings, ids), questions: normalizeQuestions(r.questions, ids) };
    },
  };
}

function tonalitaet(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 5 Tonalität & Avatar: Du überarbeitest den gesamten Text so, dass er den Avatar direkt anspricht und die vorgegebene Tonalität trifft.
Zuerst setzt du die Befunde des Faktenchecks um: Unbelegtes streichen oder ersetzen, offene Fragen so umschreiben, dass der Text ohne die Antwort auskommt.
Dann: Sprache des Avatars aufgreifen (seine Sorgen, seine Worte), Anrede durchgehend, keine verbotenen Wörter, keine Floskeln. Struktur, ids und Fakten bleiben erhalten.
${brancheRules(context.settings)}`,
    user: [
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, 4, "Faktencheck (Schritt 4) – umsetzen"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_text",
      description: "Der überarbeitete Seitentext in Abschnitten.",
      input_schema: {
        type: "object",
        properties: { blocks: BLOCKS_SCHEMA },
        required: ["blocks"],
      },
    },
    normalize: normalizeTextOutput,
  };
}

function seo(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 6 SEO-Feinschliff: Du optimierst den Text für die Suche, ohne ihn zu verschlechtern.
Hauptbegriff in H1, erstem Absatz und einer H2; Nebenbegriffe natürlich verteilt; keine Wiederholung um ihrer selbst willen. Überschriften beantworten die Fragen der Suchenden. Absätze kurz, Listen wo sie helfen. FAQ-Abschnitt mit den Fragen aus der Recherche, wenn er fehlt und Fakten dafür da sind.
title: max. 60 Zeichen mit Hauptbegriff. meta_description: max. 155 Zeichen, Nutzen plus Hauptbegriff. Fakten, Anrede, Tonalität und ids bleiben unverändert.`,
    user: [
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, 1, "Recherche (Schritt 1)"),
      settingsBlock(context.settings),
      notesBlock(context),
    ]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_seo_text",
      description: "SEO-optimierter Text mit Title und Meta-Description.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          meta_description: { type: "string" },
          blocks: BLOCKS_SCHEMA,
        },
        required: ["title", "meta_description", "blocks"],
      },
    },
    normalize: normalizeTextOutput,
  };
}

function lektorat(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 7 Lektorat: Du korrigierst Rechtschreibung, Grammatik, Zeichensetzung und Satzbau. Du glättest Wiederholungen und Füllwörter. Du änderst keine Fakten und keine Struktur, ids bleiben.
Prüfe noch einmal: Anrede durchgehend, kein verbotenes Wort, Tonalität getroffen, Branchenregel eingehalten. Was du nicht selbst beheben darfst (fehlende Fakten, offene Entscheidungen), meldest du als final_findings.
${brancheRules(context.settings)}`,
    user: [pageBlock(context), currentTextBlock(context), anbieterBlock(context), settingsBlock(context.settings), notesBlock(context)]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_lektorat",
      description: "Korrigierter Text und verbleibende Befunde.",
      input_schema: {
        type: "object",
        properties: {
          blocks: BLOCKS_SCHEMA,
          final_findings: FINDINGS_SCHEMA,
        },
        required: ["blocks", "final_findings"],
      },
    },
    normalize: (json, ctx): LektoratOutput => {
      const out = normalizeTextOutput(json, ctx);
      return { ...out, final_findings: normalizeFindings(rec(json).final_findings, blockIds(out.blocks)) };
    },
  };
}

function endabnahme(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 3_000,
    system: `${BASE_RULES}

Schritt 8 Endabnahme: Du bist die letzte Kontrolle vor der Freigabe durch einen Menschen. Du änderst nichts mehr.
unresolved: alles, was die Freigabe noch verhindern könnte (unbelegte Zahl, rechtliches Risiko, fehlender Kontaktweg, verbotenes Wort, Anredebruch). Leer, wenn der Text freigegeben werden kann.
summary: 2–3 Sätze für die Redaktion: Was die Seite leistet, worauf beim Freigeben zu achten ist.`,
    user: [
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, 7, "Lektorat (Schritt 7) – gemeldete Befunde"),
      settingsBlock(context.settings),
      notesBlock(context),
    ]
      .filter(Boolean)
      .join("\n\n"),
    tool: {
      name: "submit_endabnahme",
      description: "Offene Punkte und Zusammenfassung für die Freigabe.",
      input_schema: {
        type: "object",
        properties: {
          unresolved: FINDINGS_SCHEMA,
          summary: { type: "string" },
        },
        required: ["unresolved", "summary"],
      },
    },
    normalize: (json, ctx): EndabnahmeOutput => {
      const r = rec(json);
      return { unresolved: normalizeFindings(r.unresolved, blockIds(ctx.blocks)), summary: str(r.summary, 1_000) };
    },
  };
}

const SPECS: Record<number, (context: ContentPipelineContext) => ContentStepSpec> = {
  1: recherche,
  2: gliederung,
  3: rohtext,
  4: faktencheck,
  5: tonalitaet,
  6: seo,
  7: lektorat,
  8: endabnahme,
};

export function contentStepSpec(step: number, context: ContentPipelineContext): ContentStepSpec {
  const build = SPECS[step];
  if (!build) throw new Error(`Unbekannter Schritt ${step}.`);
  return build(context);
}

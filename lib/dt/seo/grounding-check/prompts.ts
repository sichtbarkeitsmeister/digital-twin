/**
 * Prompts and tool schemas of the Grounding check. Pure: llm.ts sends them to Claude.
 * 1 extract: website pages → fact model (every fact with source URL and verbatim quote);
 * 2 compare: meaning-level questions the deterministic diff cannot answer;
 * 3 prose: page title, meta description and the lead paragraphs, from the facts only.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  GROUNDING_ONTOLOGY_CLASSES,
  GROUNDING_ONTOLOGY_CLASS_NAMES,
  GROUNDING_PAGE_STANDARD_RULES,
} from "@/lib/dt/prompts/grounding-page-standard";
import {
  ENTITY_KINDS,
  FACT_KEYS,
  FACT_KEY_DEFS,
  OPEN_POINT_REASONS,
  SCHEMA_TYPES_BY_KIND,
  type GroundingFactModel,
  type GroundingProse,
  visibleEntities,
} from "@/lib/dt/seo/grounding-check/fact-model";
import type { SemanticRequest, SemanticVerdicts } from "@/lib/dt/seo/grounding-check/diff";

export type GroundingToolSpec = {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
};

export type SnapshotPage = { url: string; category: string; title: string | null; text: string; jsonLd: string[] };

const PAGE_CHARS: Record<string, number> = { impressum: 9_000, contact: 7_000, home: 7_000 };
const DEFAULT_PAGE_CHARS = 5_000;
const TOTAL_PAGE_CHARS = 150_000;
const INTERNAL_CHARS = 8_000;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

const str = { type: "string" } as const;

// --- 1 extract -----------------------------------------------------------------------------------

function factKeyTable(): string {
  return Object.entries(FACT_KEY_DEFS)
    .map(([key, def]) => {
      const flags = [
        "volatile" in def && def.volatile ? "zeitabhängig, mit asOf" : null,
        "visibleOnly" in def && def.visibleOnly ? "nur wenn öffentlich prüfbar" : null,
      ].filter(Boolean);
      return `- ${key} („${def.label}“) für ${def.kinds.join(", ")}${flags.length ? ` – ${flags.join(", ")}` : ""}`;
    })
    .join("\n");
}

function ontologyTable(): string {
  return GROUNDING_ONTOLOGY_CLASSES.map((c) => `- ${c.name}: ${c.rule}`).join("\n");
}

const EXTRACT_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      description: "Die Organisation zuerst, dann Personen, Leistungen/Produkte, Standorte, Methoden.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ENTITY_KINDS] },
          ontologyClass: { type: "string", enum: [...GROUNDING_ONTOLOGY_CLASS_NAMES] },
          schemaType: {
            type: "string",
            description: `Schema.org-Typ. organization: ${SCHEMA_TYPES_BY_KIND.organization.slice(0, 12).join(", ")} …; location: LocalBusiness oder ein Untertyp; person: Person; service: Service; product: Product; method/other: DefinedTerm.`,
          },
          name: str,
          definition: { type: "string", description: "Ein Satz: „<Name> ist …“ – bei der Organisation mit was, wo, für wen." },
          definitionSourceUrl: { type: "string", description: "URL der Seite, die die Definition trägt." },
          disambiguation: {
            type: "array",
            items: str,
            description: "1–2 Sätze: was die Entität nicht ist, womit sie nicht zu verwechseln ist (ähnliche Namen, verwandte Leistungen).",
          },
          facts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", enum: [...FACT_KEYS] },
                value: { type: "string", description: "Der Wert so, wie die Website ihn schreibt (Telefonnummern, Adressen, Namen unverändert)." },
                sourceUrl: { type: "string", description: "Genau eine der gelesenen Seiten-URLs." },
                quote: { type: "string", description: "Wörtliches Zitat von dieser Seite, das den Wert enthält (höchstens 200 Zeichen)." },
                volatile: { type: "boolean" },
                asOf: { type: "string", description: "JJJJ-MM für zeitabhängige Werte, wenn die Seite einen Stand nennt, sonst leer." },
              },
              required: ["key", "value", "sourceUrl", "quote", "volatile", "asOf"],
            },
          },
        },
        required: ["kind", "ontologyClass", "schemaType", "name", "definition", "definitionSourceUrl", "disambiguation", "facts"],
      },
    },
    faq: {
      type: "array",
      description: "4–8 echte Fragen, die die Website beantwortet; die Antwort in ganzen Sätzen mit dem Namen der Organisation.",
      items: {
        type: "object",
        properties: {
          question: str,
          answer: str,
          sourceUrl: str,
          quote: { type: "string", description: "Wörtliches Zitat, das die Antwort belegt." },
        },
        required: ["question", "answer", "sourceUrl", "quote"],
      },
    },
    openPoints: {
      type: "array",
      description: "Was für die Prüfung offen ist und nicht auf die Seite kommt.",
      items: {
        type: "object",
        properties: {
          reason: { type: "string", enum: [...OPEN_POINT_REASONS] },
          text: { type: "string", description: "Ein Satz für die Prüferin oder den Prüfer." },
          entityName: str,
          source: { type: "string", description: "URL oder interne Quelle (Fragebogen, Onboarding, bestehende Grounding Page)." },
        },
        required: ["reason", "text", "entityName", "source"],
      },
    },
  },
  required: ["entities", "faq", "openPoints"],
};

export type ExtractInput = {
  organisationName: string;
  websiteUrl: string;
  today: string;
  pages: SnapshotPage[];
  /** Questionnaire and workshop facts, onboarding, wording of the target customers. */
  internal: { anbieter: string; onboarding: string; wunschkunden: string };
  /** Facts of the live grounding page, so nothing is dropped unchecked. */
  existingFacts: string[];
};

const CATEGORY_ORDER = ["impressum", "contact", "home", "about", "team", "services", "locations", "faq", "references"];

function pagesBlock(pages: SnapshotPage[]): string {
  const sorted = [...pages].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  let budget = TOTAL_PAGE_CHARS;
  const blocks: string[] = [];
  for (const page of sorted) {
    if (budget <= 500) break;
    const text = clip(page.text, Math.min(PAGE_CHARS[page.category] ?? DEFAULT_PAGE_CHARS, budget));
    budget -= text.length;
    const jsonLd = page.jsonLd.length > 0 ? `\nJSON-LD der Seite:\n${clip(page.jsonLd.join("\n"), 3_000)}` : "";
    blocks.push(`### ${page.title?.trim() || page.url}\nURL: ${page.url}\nArt: ${page.category}\n${text}${jsonLd}`);
  }
  return blocks.join("\n\n");
}

export function extractSpec(input: ExtractInput): GroundingToolSpec {
  const internal = [
    input.internal.anbieter.trim() ? `### Anbieterfakten (Fragebogen, Gespräche)\n${clip(input.internal.anbieter, INTERNAL_CHARS)}` : "",
    input.internal.onboarding.trim() ? `### Onboarding\n${clip(input.internal.onboarding, 4_000)}` : "",
    input.internal.wunschkunden.trim() ? `### So fragen die Zielkunden\n${clip(input.internal.wunschkunden, 3_000)}` : "",
  ].filter(Boolean);

  return {
    maxTokens: 32_000,
    system: `Du erstellst das Faktenmodell für die Grounding Page einer Organisation. Quelle ist ausschließlich deren Website.

${GROUNDING_PAGE_STANDARD_RULES}

Arbeitsweise:
- Lies alle Seiten. Das Impressum ist die Hauptquelle für Firmierung, Rechtsform, Registernummer und -gericht, USt-IdNr., Anschrift und Geschäftsführung bzw. Inhaber.
- Jeder Fakt braucht sourceUrl (eine der gelesenen URLs) und ein wörtliches Zitat von genau dieser Seite. Ein Fakt ohne passendes Zitat ist kein Fakt. Zitate werden maschinell gegen die Seite geprüft.
- Sichtbarer Text hat Vorrang vor JSON-LD. Widerspricht das JSON-LD der Website dem sichtbaren Text, nimm den sichtbaren Text und lege einen offenen Punkt (conflict) an.
- Nur zentrale Entitäten: die Organisation; Inhaber, Geschäftsführung, Gründer und die auf der Website namentlich vorgestellten Schlüsselpersonen; Kernleistungen oder -produkte mit eigener Seite oder eigenem Abschnitt; eigene Methoden; jeder Standort und jede Filiale mit eigener Adresse als eigene Entität (kind location). Keine Referenzkunden, keine Zielgruppen, keine Blogthemen als Entität.
- Faktenschlüssel (nur diese, nur bei den genannten Arten):
${factKeyTable()}
- Mehrere Werte (mehrere Leistungsbestandteile, Profile, Geschäftsführer) sind mehrere Fakten mit demselben key.
- sameAs nur für Profile der Organisation oder Person selbst (Links stehen unter „[Profile]“ oder im JSON-LD).
- legalForm in der Kurzform, die auch in der Firmierung steht (GmbH, UG (haftungsbeschränkt), e. K. …).
- Bewertungen (rating) nur mit Quelle und Plattform (z. B. „4,9 von 5 Sternen bei Google, 120 Bewertungen“).
- Ontologie V2, Entscheidungsregeln:
${ontologyTable()}
- FAQ: Fragen, die Zielkunden wirklich stellen und die Website beantwortet. Antworten in ganzen Sätzen mit dem Namen der Organisation, nur mit Fakten der Website.

Offene Punkte (openPoints):
- missing_on_website: wichtige Angaben, die die Website nicht nennt (z. B. Gründungsjahr, Registernummer, Öffnungszeiten eines Standorts).
- internal_only: Angaben, die nur in den internen Daten stehen. Sie kommen nicht auf die Seite.
- conflict: Website und interne Daten (oder sichtbarer Text und JSON-LD, oder die bestehende Grounding Page) widersprechen sich. Die Website gilt; nenne beide Werte.
- unverified: Angaben der bestehenden Grounding Page, die du auf der Website nicht wiederfindest.
- not_publishable: Angaben, die nicht auf eine Faktenseite gehören (Werbeversprechen, Superlative, Selbstbewertungen ohne Quelle).`,
    user: [
      `## Organisation\n${input.organisationName} · Website ${input.websiteUrl} · Heute ${input.today}`,
      `## Seiten der Website\n${pagesBlock(input.pages)}`,
      input.existingFacts.length > 0
        ? `## Angaben der bestehenden Grounding Page (nur zum Gegenprüfen, keine Quelle)\n${input.existingFacts.slice(0, 150).join("\n")}`
        : "",
      internal.length > 0 ? `## Interne Daten (keine Quelle für die Seite; nur für offene Punkte)\n${internal.join("\n\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    tool: { name: "submit_fact_model", description: "Das Faktenmodell der Grounding Page.", input_schema: EXTRACT_SCHEMA },
  };
}

/** One line per fact of an existing model, for the extraction checklist. */
export function factChecklist(model: GroundingFactModel | null): string[] {
  if (!model) return [];
  const lines: string[] = [];
  for (const entity of model.entities) {
    if (entity.definition) lines.push(`- ${entity.name}: ${entity.definition.slice(0, 200)}`);
    for (const fact of entity.facts) lines.push(`- ${entity.name} / ${FACT_KEY_DEFS[fact.key].label}: ${fact.value}`);
  }
  for (const f of model.faq) lines.push(`- FAQ: ${f.question}`);
  return lines;
}

// --- 2 compare -----------------------------------------------------------------------------------

const COMPARE_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    entityMatches: {
      type: "array",
      description: "Paare aus neuer und alter Entität, die dieselbe Sache bezeichnen.",
      items: { type: "object", properties: { newId: str, oldId: str }, required: ["newId", "oldId"] },
    },
    definitionVerdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: str,
          same: { type: "boolean", description: "true, wenn beide Texte inhaltlich dasselbe aussagen (nur anders formuliert)." },
          note: { type: "string", description: "Bei false: was sich inhaltlich geändert hat, ein Satz." },
        },
        required: ["id", "same", "note"],
      },
    },
    faqMatches: {
      type: "array",
      items: {
        type: "object",
        properties: { newId: str, oldId: str, sameAnswer: { type: "boolean" }, note: str },
        required: ["newId", "oldId", "sameAnswer", "note"],
      },
    },
  },
  required: ["entityMatches", "definitionVerdicts", "faqMatches"],
};

export function compareSpec(request: SemanticRequest): GroundingToolSpec {
  const entities = (side: "new" | "old") =>
    request.entityCandidates
      .filter((c) => c.side === side)
      .map((c) => `- id ${c.id} · ${c.kind} · ${c.name}${c.definition ? ` – ${c.definition}` : ""}`)
      .join("\n") || "- keine";
  const faq = (side: "new" | "old") =>
    request.faqCandidates
      .filter((c) => c.side === side)
      .map((c) => `- id ${c.id} · ${c.question} → ${c.answer}`)
      .join("\n") || "- keine";
  return {
    maxTokens: 8_000,
    system: `Du vergleichst eine bestehende Grounding Page (alt) mit den aktuellen Fakten der Website (neu). Die exakten Fakten sind schon maschinell verglichen; du entscheidest nur, was Bedeutung braucht.
- entityMatches: nur Paare, die eindeutig dieselbe Entität sind (z. B. „SEO-Beratung“ und „Beratung zur Suchmaschinenoptimierung“). Im Zweifel kein Paar.
- definitionVerdicts: für jedes Textpaar: same = true, wenn nur die Formulierung abweicht; false, wenn eine Aussage hinzukommt, wegfällt oder sich ändert. note nennt die inhaltliche Änderung.
- faqMatches: Fragen, die dasselbe fragen, und ob die Antworten inhaltlich übereinstimmen.
Erfinde keine IDs; nutze nur die angegebenen.`,
    user: [
      `## Entitäten ohne Gegenstück\nNeu:\n${entities("new")}\n\nAlt:\n${entities("old")}`,
      `## Textpaare\n${request.definitionPairs.map((p) => `- id ${p.id} (${p.entityName}, ${p.field})\n  alt: ${p.oldText}\n  neu: ${p.newText}`).join("\n") || "- keine"}`,
      `## FAQ\nNeu:\n${faq("new")}\n\nAlt:\n${faq("old")}`,
    ].join("\n\n"),
    tool: { name: "submit_comparison", description: "Inhaltlicher Vergleich alt/neu.", input_schema: COMPARE_SCHEMA },
  };
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(rec) : [];
}

function text(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Only ids the request asked about survive. */
export function normalizeSemanticVerdicts(raw: unknown, request: SemanticRequest): SemanticVerdicts {
  const r = rec(raw);
  const newIds = new Set(request.entityCandidates.filter((c) => c.side === "new").map((c) => c.id));
  const oldIds = new Set(request.entityCandidates.filter((c) => c.side === "old").map((c) => c.id));
  const pairIds = new Set(request.definitionPairs.map((p) => p.id));
  const faqNew = new Set(request.faqCandidates.filter((c) => c.side === "new").map((c) => c.id));
  const faqOld = new Set(request.faqCandidates.filter((c) => c.side === "old").map((c) => c.id));
  return {
    entityMatches: list(r.entityMatches)
      .map((m) => ({ newId: text(m.newId, 120), oldId: text(m.oldId, 120) }))
      .filter((m) => newIds.has(m.newId) && oldIds.has(m.oldId)),
    definitionVerdicts: list(r.definitionVerdicts)
      .map((v) => ({ id: text(v.id, 200), same: v.same === true, note: text(v.note, 400) }))
      .filter((v) => pairIds.has(v.id)),
    faqMatches: list(r.faqMatches)
      .map((m) => ({ newId: text(m.newId, 120), oldId: text(m.oldId, 120), sameAnswer: m.sameAnswer === true, note: text(m.note, 400) }))
      .filter((m) => faqNew.has(m.newId) && faqOld.has(m.oldId)),
  };
}

// --- 3 prose -------------------------------------------------------------------------------------

const PROSE_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    pageTitle: { type: "string", description: "„<Organisation>: Fakten“ oder nur der Name; höchstens 60 Zeichen." },
    metaDescription: { type: "string", description: "Ein sachlicher Satz, 120–155 Zeichen, nur Fakten aus der Liste." },
    lead: {
      type: "array",
      items: str,
      description: "1–2 kurze Absätze nach der Definition: Einordnung (Segment, Region, Zielgruppe, Standorte, Leistungen). Wiederhole die Definition nicht.",
    },
  },
  required: ["pageTitle", "metaDescription", "lead"],
};

export function proseSpec(model: GroundingFactModel): GroundingToolSpec {
  const facts: string[] = [];
  for (const entity of visibleEntities(model)) {
    facts.push(`### ${entity.name} (${entity.kind})`);
    if (entity.definition) facts.push(`Definition: ${entity.definition}`);
    for (const f of entity.facts) facts.push(`- ${FACT_KEY_DEFS[f.key].label}: ${f.value}`);
  }
  return {
    maxTokens: 4_000,
    system: `Du schreibst die wenigen Fließtextteile einer Grounding Page. Alles andere erzeugt eine Vorlage aus den Fakten.

${GROUNDING_PAGE_STANDARD_RULES}

Für diesen Schritt:
- Verwende ausschließlich die Fakten aus der Liste. Keine Zahl, kein Ort, keine Eigenschaft, die dort nicht steht.
- Ruhiger, sachlicher Ton, ein Fakt pro Satz, der Name der Organisation statt „wir“.
- Keine Werbung, keine Superlative, keine Handlungsaufforderung, kein Satz über KI oder Grounding.`,
    user: `## Organisation\n${model.organisationName}\n\n## Fakten\n${facts.join("\n")}`,
    tool: { name: "submit_prose", description: "Titel, Meta-Description und Einleitung.", input_schema: PROSE_SCHEMA },
  };
}

export function normalizeProse(raw: unknown, model: GroundingFactModel): GroundingProse {
  const r = rec(raw);
  const lead = Array.isArray(r.lead) ? r.lead.map((p) => text(p, 1_200)).filter(Boolean).slice(0, 2) : [];
  return {
    pageTitle: text(r.pageTitle, 160) || `${model.organisationName}: Fakten`,
    metaDescription: text(r.metaDescription, 320),
    lead,
  };
}

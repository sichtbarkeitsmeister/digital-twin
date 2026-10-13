/**
 * Prompts, tool schemas and output normalisation for the four Grounding steps.
 * Pure: no Supabase, no Anthropic client (`run-step.ts` wires them to the model).
 * Every step sees the same context: the page (Hub or Entitätsseite), the fact sources
 * (Anbieterfakten, Onboarding, crawled pages, live page), the Wunschkunden wording, the
 * editorial notes and the outputs of the earlier steps.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import {
  GROUNDING_STEP_BAUEN,
  GROUNDING_STEP_ENDPRUEFUNG,
  GROUNDING_STEP_FAKTEN,
  GROUNDING_STEP_FAKTENCHECK,
} from "@/lib/dt/seo/grounding-run/steps";

export type GroundingRunPage = {
  kind: "hub" | "entity";
  /** Name of the entity (Hub: the organisation). */
  entityName: string;
  slug: string | null;
  /** Planned or live URL of the page. */
  url: string;
  schemaType: string | null;
};

export type GroundingRunSitePage = { url: string; title: string | null; text: string };

export type GroundingRunContext = {
  organisationName: string;
  websiteUrl: string | null;
  page: GroundingRunPage;
  /** The Hub (for an Entitätsseite): its URL and fact base, so both pages agree. */
  hub: { url: string; facts: GroundingFacts | null } | null;
  /** The other Grounding Pages of the organisation (for linking). */
  siblings: Array<{ kind: "hub" | "entity"; entityName: string | null; url: string }>;
  anbieterSections: WorkshopAnbieterSection[];
  onboardingText: string;
  wunschkundenText: string;
  sitePages: GroundingRunSitePage[];
  /** Visible text of the live Grounding Page when one exists already. */
  livePageText: string | null;
  /** Answers and notes of the editor, oldest first. */
  notes: string[];
  outputs: Partial<Record<number, unknown>>;
  html: string | null;
  today: string;
};

// --- outputs ---------------------------------------------------------------------------------

export type GroundingCoreFact = { label: string; value: string; source: string; as_of: string | null };
export type GroundingSection = { heading: string; paragraphs: string[]; sources: string[] };
export type GroundingOpenQuestion = { question: string; why: string; blocking: boolean };
export type GroundingEntityCandidate = {
  name: string;
  schema_type: string;
  reason: string;
  url: string;
  priority: "hoch" | "mittel" | "niedrig";
};

export type GroundingFacts = {
  entity: {
    name: string;
    schema_type: string;
    definition: string;
    placement: string;
    distinction: string[];
  };
  classification: { entity_type: string; category: string; region: string; parent: string; status: string };
  core_facts: GroundingCoreFact[];
  sections: GroundingSection[];
  faq: Array<{ question: string; answer: string }>;
  sources: Array<{ label: string; url: string }>;
  related: Array<{ name: string; url: string }>;
  open_questions: GroundingOpenQuestion[];
  entity_candidates: GroundingEntityCandidate[];
};

export type GroundingFinding = { title: string; problem: string; proposal: string; severity: "high" | "medium" | "low" };
export type GroundingQuestion = { question: string; why: string; placeholder: string; blocking: boolean };
export type GroundingCheckOutput = { findings: GroundingFinding[]; questions: GroundingQuestion[]; summary: string };
export type GroundingBuildOutput = { html: string; title: string; meta_description: string; schema_type: string };
export type GroundingFinalOutput = {
  ok: boolean;
  issues: GroundingFinding[];
  corrected_html: string | null;
  summary: string;
};

export type GroundingStepSpec = {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  normalize: (json: unknown, context: GroundingRunContext) => unknown;
};

const MAX_SECTION_CHARS = 6_000;
const MAX_ONBOARDING_CHARS = 6_000;
const MAX_WUNSCHKUNDEN_CHARS = 6_000;
const MAX_SITE_PAGE_CHARS = 4_000;
const MAX_LIVE_PAGE_CHARS = 8_000;
const MAX_HTML_CHARS = 60_000;
/** The page should stay under this; longer content belongs on Entitätsseiten. */
export const GROUNDING_HTML_TARGET_CHARS = 20_000;

// --- helpers ---------------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

function str(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strList(value: unknown, max = 30, each = 400): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, each))
    .filter(Boolean)
    .slice(0, max);
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(rec) : [];
}

function severity(value: unknown): GroundingFinding["severity"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
}

export function normalizeGroundingFindings(raw: unknown, max = 40): GroundingFinding[] {
  return list(raw)
    .map((f) => ({
      title: str(f.title, 200),
      problem: str(f.problem, 1_000),
      proposal: str(f.proposal, 1_000),
      severity: severity(f.severity),
    }))
    .filter((f) => f.title || f.problem)
    .slice(0, max);
}

export function normalizeGroundingQuestions(raw: unknown, max = 20): GroundingQuestion[] {
  return list(raw)
    .map((q) => ({
      question: str(q.question, 600),
      why: str(q.why, 600),
      placeholder: str(q.placeholder, 300),
      blocking: q.blocking === true,
    }))
    .filter((q) => q.question)
    .slice(0, max);
}

export function normalizeGroundingFacts(raw: unknown, context: Pick<GroundingRunContext, "page">): GroundingFacts {
  const r = rec(raw);
  const entity = rec(r.entity);
  const classification = rec(r.classification);
  return {
    entity: {
      name: str(entity.name, 200) || context.page.entityName,
      schema_type: str(entity.schema_type, 80) || context.page.schemaType || (context.page.kind === "hub" ? "Organization" : "Thing"),
      definition: str(entity.definition, 1_000),
      placement: str(entity.placement, 1_000),
      distinction: strList(entity.distinction, 8, 500),
    },
    classification: {
      entity_type: str(classification.entity_type, 120),
      category: str(classification.category, 200),
      region: str(classification.region, 200),
      parent: str(classification.parent, 200),
      status: str(classification.status, 120),
    },
    core_facts: list(r.core_facts)
      .map((f) => ({
        label: str(f.label, 120),
        value: str(f.value, 600),
        source: str(f.source, 300),
        as_of: str(f.as_of, 40) || null,
      }))
      .filter((f) => f.label && f.value)
      .slice(0, 40),
    sections: list(r.sections)
      .map((s) => ({
        heading: str(s.heading, 200),
        paragraphs: strList(s.paragraphs, 10, 2_000),
        sources: strList(s.sources, 10, 300),
      }))
      .filter((s) => s.heading && s.paragraphs.length > 0)
      .slice(0, 12),
    faq: list(r.faq)
      .map((f) => ({ question: str(f.question, 300), answer: str(f.answer, 1_200) }))
      .filter((f) => f.question && f.answer)
      .slice(0, 10),
    sources: list(r.sources)
      .map((s) => ({ label: str(s.label, 200), url: str(s.url, 500) }))
      .filter((s) => s.label || s.url)
      .slice(0, 20),
    related: list(r.related)
      .map((s) => ({ name: str(s.name, 200), url: str(s.url, 500) }))
      .filter((s) => s.name)
      .slice(0, 20),
    open_questions: list(r.open_questions)
      .map((q) => ({ question: str(q.question, 600), why: str(q.why, 600), blocking: q.blocking === true }))
      .filter((q) => q.question)
      .slice(0, 20),
    entity_candidates:
      context.page.kind === "hub"
        ? list(r.entity_candidates)
            .map((c) => ({
              name: str(c.name, 200),
              schema_type: str(c.schema_type, 80) || "Thing",
              reason: str(c.reason, 600),
              url: str(c.url, 500),
              priority: (c.priority === "hoch" || c.priority === "niedrig" ? c.priority : "mittel") as GroundingEntityCandidate["priority"],
            }))
            .filter((c) => c.name)
            .slice(0, 12)
        : [],
  };
}

function looksLikeHtmlDocument(html: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(html) && /<\/html>\s*$/i.test(html.trim());
}

export function normalizeGroundingHtml(raw: unknown): string | null {
  const html = typeof raw === "string" ? raw.trim() : "";
  if (!html || html.length > MAX_HTML_CHARS) return null;
  return looksLikeHtmlDocument(html) ? html : null;
}

// --- context blocks ---------------------------------------------------------------------------

function pageBlock(context: GroundingRunContext): string {
  const { page } = context;
  const lines = [
    `## Seite`,
    `- Art: ${page.kind === "hub" ? "Hub (Haupt-Grounding-Page der Organisation)" : "Entitätsseite"}`,
    `- Entität: ${page.entityName}`,
    page.schemaType ? `- Schema.org-Typ (Vorgabe): ${page.schemaType}` : "",
    `- Geplante Live-URL: ${page.url}`,
    `- Organisation: ${context.organisationName}${context.websiteUrl ? ` · Website ${context.websiteUrl}` : ""}`,
    `- Heute: ${context.today}`,
  ];
  if (context.hub) {
    lines.push(`- Hub dieser Organisation: ${context.hub.url}`);
  }
  if (context.siblings.length > 0) {
    lines.push(
      `- Weitere Grounding Pages (für Verlinkung): ${context.siblings
        .map((s) => `${s.kind === "hub" ? "Hub" : s.entityName || "Entitätsseite"} ${s.url}`)
        .join(" · ")}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}

function anbieterBlock(context: GroundingRunContext): string | null {
  const filled = context.anbieterSections.filter((s) => s.current.trim());
  if (filled.length === 0) return null;
  return [
    "## Anbieterfakten (Fragebogen und ausgewertete Gespräche)",
    ...filled.map((s) => `### ${s.label}\n${clip(s.current, MAX_SECTION_CHARS)}`),
  ].join("\n\n");
}

function onboardingBlock(context: GroundingRunContext): string | null {
  const text = context.onboardingText.trim();
  return text ? `## Onboarding (Kontakte, Mitbewerber, Status)\n${clip(text, MAX_ONBOARDING_CHARS)}` : null;
}

function wunschkundenBlock(context: GroundingRunContext): string | null {
  const text = context.wunschkundenText.trim();
  return text
    ? `## Zielkunden (so suchen und benennen sie die Entität)\n${clip(text, MAX_WUNSCHKUNDEN_CHARS)}`
    : null;
}

function sitePagesBlock(context: GroundingRunContext): string | null {
  if (context.sitePages.length === 0) return null;
  return [
    "## Inhalte der Website (gecrawlt)",
    ...context.sitePages.map(
      (p) => `### ${p.title?.trim() || p.url}\nURL: ${p.url}\n${clip(p.text, MAX_SITE_PAGE_CHARS)}`,
    ),
  ].join("\n\n");
}

function livePageBlock(context: GroundingRunContext): string | null {
  return context.livePageText
    ? `## Bestehende Grounding Page (Live-Text, ${context.page.url})\n${clip(context.livePageText, MAX_LIVE_PAGE_CHARS)}`
    : null;
}

function hubFactsBlock(context: GroundingRunContext): string | null {
  const facts = context.hub?.facts;
  if (!facts) return null;
  return `## Faktenbasis des Hubs (muss mit dieser Seite übereinstimmen)\n${factsText(facts)}`;
}

function notesBlock(context: GroundingRunContext): string | null {
  if (context.notes.length === 0) return null;
  return [
    "## Antworten und Anmerkungen der Redaktion (haben Vorrang vor allen anderen Quellen)",
    ...context.notes.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
}

export function factsText(facts: GroundingFacts): string {
  const lines: string[] = [];
  lines.push(`Entität: ${facts.entity.name} (${facts.entity.schema_type})`);
  if (facts.entity.definition) lines.push(`Definition: ${facts.entity.definition}`);
  if (facts.entity.placement) lines.push(`Einordnung: ${facts.entity.placement}`);
  for (const d of facts.entity.distinction) lines.push(`Abgrenzung: ${d}`);
  const c = facts.classification;
  const classification = [c.entity_type, c.category, c.region, c.parent, c.status].filter(Boolean).join(" · ");
  if (classification) lines.push(`Klassifikation: ${classification}`);
  if (facts.core_facts.length > 0) {
    lines.push("Kerndaten:");
    for (const f of facts.core_facts) {
      lines.push(`- ${f.label}: ${f.value}${f.as_of ? ` (Stand ${f.as_of})` : ""}${f.source ? ` [Quelle: ${f.source}]` : ""}`);
    }
  }
  for (const s of facts.sections) {
    lines.push(`\n### ${s.heading}`);
    for (const p of s.paragraphs) lines.push(p);
    if (s.sources.length > 0) lines.push(`Quellen: ${s.sources.join("; ")}`);
  }
  if (facts.faq.length > 0) {
    lines.push("\nFAQ:");
    for (const f of facts.faq) lines.push(`- ${f.question} — ${f.answer}`);
  }
  if (facts.sources.length > 0) {
    lines.push("\nQuellen:");
    for (const s of facts.sources) lines.push(`- ${s.label}${s.url ? ` ${s.url}` : ""}`);
  }
  if (facts.related.length > 0) {
    lines.push("\nVerwandte Entitäten:");
    for (const r of facts.related) lines.push(`- ${r.name}${r.url ? ` ${r.url}` : ""}`);
  }
  if (facts.open_questions.length > 0) {
    lines.push("\nOffene Fragen:");
    for (const q of facts.open_questions) lines.push(`- ${q.question}${q.blocking ? " (blockierend)" : ""}`);
  }
  return lines.join("\n");
}

function factsBlock(context: GroundingRunContext): string | null {
  const facts = context.outputs[GROUNDING_STEP_FAKTEN] as GroundingFacts | undefined;
  return facts ? `## Faktenbasis (Schritt 1)\n${factsText(facts)}` : null;
}

function checkBlock(context: GroundingRunContext): string | null {
  const check = context.outputs[GROUNDING_STEP_FAKTENCHECK] as GroundingCheckOutput | undefined;
  if (!check) return null;
  const lines = ["## Faktencheck (Schritt 2)"];
  if (check.summary) lines.push(check.summary);
  if (check.findings.length > 0) {
    lines.push("Befunde (einarbeiten: streichen, korrigieren oder mit „Stand“ versehen):");
    for (const f of check.findings) lines.push(`- [${f.severity}] ${f.title}: ${f.problem} → ${f.proposal}`);
  }
  if (check.questions.length > 0) {
    lines.push("Fragen an den Kunden (unbeantwortete Fragen: den betroffenen Fakt weglassen, nicht raten):");
    for (const q of check.questions) lines.push(`- ${q.question}${q.blocking ? " (blockierend)" : ""}`);
  }
  return lines.join("\n");
}

function htmlBlock(context: GroundingRunContext): string | null {
  return context.html ? `## Aktuelle HTML-Datei (Schritt 3)\n${clip(context.html, MAX_HTML_CHARS)}` : null;
}

// --- rules -----------------------------------------------------------------------------------

export const BASE_RULES = `Du bist der Grounding-Agent von DigitalTwin. Du erstellst Grounding Pages nach dem Grounding Page Standard v1.7 (groundingpage.com/spec): faktische, enzyklopädische Referenzseiten für Menschen und KI-Systeme.

Eiserne Regeln:
- Nur belegbare Fakten. Jede Aussage stammt aus den Anbieterfakten, dem Onboarding, den Website-Inhalten, der bestehenden Grounding Page oder den Antworten der Redaktion. Nichts wird erfunden, ergänzt, gerundet oder „plausibel“ gemacht.
- Was du nicht belegen kannst, lässt du weg oder stellst eine Frage. Raten ist verboten – bei Rechtsform, Gründung, Inhabern, Standorten, Preisen, Zahlen, Zertifikaten, Partnern.
- Die Antworten und Anmerkungen der Redaktion haben Vorrang vor allen anderen Quellen.
- Stil: ruhig, enzyklopädisch, ein Fakt pro Satz, keine Adjektive, kein Marketing, keine Superlative, kein „wir“. Vollständige Sätze mit dem Namen der Entität, damit jeder Abschnitt allein zitierbar bleibt. Deutsch; Eigennamen unverändert; Begriffe so, wie die Zielkunden sie verwenden.
- Kein Satz über KI, LLMs, Retrieval oder „Grounding“ im sichtbaren Text. Die Seite muss ohne jede solche Erwähnung vollen Wert für Menschen haben.`;

export const STANDARD_RULES = `Pflichtblöcke je Seite (Standard v1.7):
- Genau eine Hauptentität. H1 = Name der Entität (kein Slogan, nicht „Grounding Page“).
- Lead (2–3 kurze Absätze): Definition („<Name> ist …“), Einordnung (Segment, Region, Zielgruppe), Abgrenzung (was <Name> nicht ist, womit es verwechselt wird).
- Tragende H2 mit Entitätsnamen („Kerndaten von <Name>“, „Leistungen von <Name>“, „Geschichte von <Name>“, „Abgrenzung von <Name>“, „FAQ zu <Name>“). Jede Sektion muss allein verständlich sein.
- Strukturierte Fakten als <dl class="data-grid"> (Attribut/Wert) nur für stabile Kerndaten; Erklärungen als Fließtext.
- Klassifikation (Entitätstyp, Branche/Kategorie, Region, übergeordnete Organisation, Status) in den Kerndaten oder im JSON-LD.
- Quellen sichtbar; zeitabhängige Werte (Preise, Öffnungszeiten, Versionen, Rollen) mit „Stand: <Datum>“.
- Interne Verlinkung: Hub ↔ Entitätsseiten, verwandte Entitäten im Fließtext, Footer-Link site-weit („Fakten“).
- JSON-LD spiegelt nur sichtbare Inhalte: passender Schema.org-Typ für die Entität plus ein WebPage-Objekt mit @id (Live-URL), mainEntity, datePublished, dateModified. FAQPage nur bei sichtbarer FAQ. Nichts im JSON-LD, was nicht auf der Seite steht.
- Entwurf: Standard-Hinweis als HTML-Kommentar und Footer-Zeile „Grounding Page Standard v1.6“ (v1.7 erst nach dokumentierter Prüfung). KEIN Prüfhinweis, kein „Prüfung ausstehend“, kein Human-Verified-Badge, kein lastReviewed/reviewedBy.
- Seite indexierbar, kanonische URL, eine Sprache.`;

// --- step specs ------------------------------------------------------------------------------

const FACTS_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    entity: {
      type: "object",
      properties: {
        name: { type: "string" },
        schema_type: { type: "string", description: "Schema.org-Typ, z. B. Organization, LocalBusiness, Service, Product, Person, Event, DefinedTerm." },
        definition: { type: "string", description: "Ein Absatz: „<Name> ist …“" },
        placement: { type: "string", description: "Ein Absatz: Segment, Region, Zielgruppe." },
        distinction: { type: "array", items: { type: "string" }, description: "Sätze: was die Entität nicht ist, womit sie verwechselt wird." },
      },
      required: ["name", "schema_type", "definition", "placement", "distinction"],
    },
    classification: {
      type: "object",
      properties: {
        entity_type: { type: "string" },
        category: { type: "string" },
        region: { type: "string" },
        parent: { type: "string" },
        status: { type: "string" },
      },
      required: ["entity_type", "category", "region", "parent", "status"],
    },
    core_facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          source: { type: "string", description: "Woher der Fakt stammt (Abschnitt, URL, „Antwort der Redaktion“)." },
          as_of: { type: "string", description: "JJJJ-MM-TT bei zeitabhängigen Werten, sonst leer." },
        },
        required: ["label", "value", "source", "as_of"],
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "H2 mit Entitätsnamen." },
          paragraphs: { type: "array", items: { type: "string" } },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "paragraphs", "sources"],
      },
    },
    faq: {
      type: "array",
      items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] },
    },
    sources: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } }, required: ["label", "url"] },
    },
    related: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" } }, required: ["name", "url"] },
    },
    open_questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why: { type: "string" },
          blocking: { type: "boolean", description: "true, wenn die Seite ohne Antwort nicht gebaut werden sollte." },
        },
        required: ["question", "why", "blocking"],
      },
    },
    entity_candidates: {
      type: "array",
      description: "Nur beim Hub: Entitäten, die eine eigene Entitätsseite verdienen.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          schema_type: { type: "string" },
          reason: { type: "string", description: "Nachfrage der Zielkunden + Faktenlage." },
          url: { type: "string", description: "Geplante URL unter dem Hub, z. B. https://…/grounding/<slug>/" },
          priority: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
        },
        required: ["name", "schema_type", "reason", "url", "priority"],
      },
    },
  },
  required: ["entity", "classification", "core_facts", "sections", "faq", "sources", "related", "open_questions", "entity_candidates"],
};

export type GroundingAgentRules = { base: string; standard: string };

/** Stored text replaces the code default only when it is non-empty. */
export function resolveGroundingAgentRules(
  rules?: { base?: string | null; standard?: string | null } | null,
): GroundingAgentRules {
  return {
    base: rules?.base?.trim() || BASE_RULES,
    standard: rules?.standard?.trim() || STANDARD_RULES,
  };
}

export function isDefaultGroundingAgentBase(value: string | null | undefined): boolean {
  return !value?.trim() || value.trim() === BASE_RULES;
}

export function isDefaultGroundingAgentStandard(value: string | null | undefined): boolean {
  return !value?.trim() || value.trim() === STANDARD_RULES;
}

function faktenSpec(context: GroundingRunContext, rules: GroundingAgentRules): GroundingStepSpec {
  const hub = context.page.kind === "hub";
  return {
    maxTokens: 8_000,
    system: `${rules.base}

Schritt 1 Fakten sammeln: Du legst die Faktenbasis für die Seite an. Noch kein HTML.
- Lies alle Quellen und ordne jeden Fakt der Entität zu. Nenne je Fakt die Quelle.
- Definition, Einordnung und Abgrenzung in ganzen Sätzen mit dem Namen der Entität.
- Kerndaten nur, wenn sie belegt sind (Rechtsform, Gründung, Sitz, Inhaber, Leistungen, Einzugsgebiet, Kontaktwege, Zertifikate). Zeitabhängige Werte mit as_of.
- Abschnitte (H2 mit Entitätsnamen) mit belegten Absätzen: Leistungen, Geschichte, Standort/Einzugsgebiet, Arbeitsweise, Abgrenzung – nur, was die Quellen hergeben. Lieber vier belegte Abschnitte als acht dünne.
- FAQ nur mit Fragen, die die Zielkunden wirklich stellen und die belegt beantwortbar sind.
- open_questions: alles, was nur der Kunde beantworten kann. blocking = true, wenn es um Kerndaten geht (Rechtsform, Gründung, Inhaber, Standort, Kernleistungen) und die Quellen widersprüchlich oder leer sind. Höchstens 8 Fragen, die wichtigsten zuerst.
${
  hub
    ? `- entity_candidates: Eigene Entitätsseite nur für Entitäten, nach denen Zielkunden gezielt fragen UND für die genug belegbare Fakten vorliegen (Leistungen oder Produkte mit eigenem Namen, Standorte, Schlüsselpersonen, Marken, Methoden). Kleine Organisationen: meist 1–5 Seiten. Alles andere bleibt eine entity-card im Hub. URL unter dem Hub (${context.page.url}<slug>/).`
    : `- Diese Seite beschreibt genau die Entität „${context.page.entityName}“ – nicht die Organisation insgesamt. Die Organisation wird nur eingeordnet und auf den Hub verlinkt. Widerspricht etwas der Faktenbasis des Hubs, nimm die Hub-Fassung und melde den Widerspruch als offene Frage.`
}
${context.livePageText ? "- Es gibt bereits eine Live-Seite: Übernimm ihre belegten Fakten, markiere Veraltetes als offene Frage. Dieser Auftrag ist ein „aktualisiere“, kein Neubau." : ""}`,
    user: join([
      pageBlock(context),
      notesBlock(context),
      hubFactsBlock(context),
      livePageBlock(context),
      anbieterBlock(context),
      onboardingBlock(context),
      sitePagesBlock(context),
      wunschkundenBlock(context),
    ]),
    tool: { name: "submit_facts", description: "Die Faktenbasis der Grounding Page.", input_schema: FACTS_SCHEMA },
    normalize: (json, ctx) => normalizeGroundingFacts(json, ctx),
  };
}

const FINDINGS_ITEMS: Record<string, unknown> = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      problem: { type: "string" },
      proposal: { type: "string" },
      severity: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["title", "problem", "proposal", "severity"],
  },
};

function faktencheckSpec(context: GroundingRunContext, rules: GroundingAgentRules): GroundingStepSpec {
  return {
    maxTokens: 6_000,
    system: `${rules.base}

Schritt 2 Faktencheck: Du prüfst jeden Fakt der Faktenbasis (Schritt 1) gegen die Quellen.
Ein finding ist jeder Fakt, der in keiner Quelle steht, den Quellen widerspricht, eine gerundete oder erfundene Zahl enthält, einen Superlativ oder ein Versprechen enthält, eine falsche Entität beschreibt oder einen zeitabhängigen Wert ohne Stand nennt. severity high = falsch oder rechtlich riskant, medium = unbelegt, low = unscharf. Vorschlag: streichen, korrigieren, „Stand“ ergänzen.
Eine question stellst du nur, wenn allein der Kunde die Antwort kennt. Übernimm die offenen Fragen aus Schritt 1, wenn sie berechtigt sind, und ergänze eigene. blocking = true, wenn die Seite ohne die Antwort nicht gebaut werden darf (Kerndaten, Entitätszuordnung). Was durch Streichen lösbar ist, ist keine Frage, sondern ein finding.
Beantwortet eine Anmerkung der Redaktion eine Frage bereits, stellst du sie nicht noch einmal. Höchstens 8 Fragen.
summary: zwei Sätze zur Faktenlage (wie belastbar, was fehlt).`,
    user: join([
      pageBlock(context),
      notesBlock(context),
      factsBlock(context),
      hubFactsBlock(context),
      livePageBlock(context),
      anbieterBlock(context),
      onboardingBlock(context),
      sitePagesBlock(context),
    ]),
    tool: {
      name: "submit_faktencheck",
      description: "Befunde und Fragen an den Kunden.",
      input_schema: {
        type: "object",
        properties: {
          findings: FINDINGS_ITEMS,
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                why: { type: "string", description: "Warum nur der Kunde das beantworten kann." },
                placeholder: { type: "string", description: "Beispiel für eine Antwort." },
                blocking: { type: "boolean" },
              },
              required: ["question", "why", "placeholder", "blocking"],
            },
          },
          summary: { type: "string" },
        },
        required: ["findings", "questions", "summary"],
      },
    },
    normalize: (json): GroundingCheckOutput => {
      const r = rec(json);
      return {
        findings: normalizeGroundingFindings(r.findings),
        questions: normalizeGroundingQuestions(r.questions),
        summary: str(r.summary, 1_000),
      };
    },
  };
}

function bauenSpec(context: GroundingRunContext, rules: GroundingAgentRules): GroundingStepSpec {
  const { page } = context;
  return {
    maxTokens: 12_000,
    system: `${rules.base}

Schritt 3 Seite bauen: Du schreibst die vollständige HTML-Datei der Grounding Page aus der Faktenbasis, mit den Befunden des Faktenchecks eingearbeitet und den Antworten der Redaktion.
${rules.standard}

Technik:
- Vollständiges Dokument: <!doctype html>, <html lang="de">, <head> mit <meta charset>, <meta name="viewport">, <title> (Name der Entität, optional „: Fakten“), <meta name="description"> (ein Satz, 120–155 Zeichen, nur Fakten), <link rel="canonical" href="${page.url}">, die JSON-LD-Skripte; <body> mit <main> und dem Inhalt. Nur wenige Zeilen CSS im <head> (lead-definition, data-grid als zweispaltige Liste, review-notice, max-width) – die Seite übernimmt Header, Footer und Typografie der Website.
- Ausschließlich belegte Fakten aus der Faktenbasis. Fakten mit Befund „streichen“ fehlen. Unbeantwortete Fragen: den betroffenen Fakt weglassen – keine Platzhalter wie [prüfen] im sichtbaren Text.
- JSON-LD: ein Skript mit dem Entitätstyp (Name, Beschreibung = Definition, url, address/areaServed/contactPoint nur wenn sichtbar), ein Skript mit WebPage (@id ${page.url}, name, inLanguage "de", datePublished und dateModified ${context.today}, mainEntity → die Entität${context.hub ? `, isPartOf ${context.hub.url}` : ""}), FAQPage nur bei sichtbarer FAQ.
- Verlinkung: ${context.hub ? `zurück zum Hub ${context.hub.url}` : "zu den Entitätsseiten, sobald es welche gibt"}; verwandte Entitäten aus der Faktenbasis im Fließtext verlinken, wenn eine URL bekannt ist.
- Am Ende der Seite: Abschnitt „Quellen und Stand“ (sichtbare Quellen, „Zuletzt aktualisiert: ${context.today}“) und die Footer-Zeile <p class="standard-notice">Grounding Page Standard v1.6</p>. Kein Prüfhinweis.
- Zielgröße unter ${GROUNDING_HTML_TARGET_CHARS.toLocaleString("de-DE")} Zeichen. Zu lang? Abschnitte kürzen, nicht Fakten erfinden.
- Keine Marketing-Floskeln, keine Handlungsaufforderungen, kein „Jetzt anfragen“. Kontaktwege nur als Fakt in den Kerndaten.`,
    user: join([
      pageBlock(context),
      notesBlock(context),
      factsBlock(context),
      checkBlock(context),
      hubFactsBlock(context),
    ]),
    tool: {
      name: "submit_page",
      description: "Die fertige HTML-Datei der Grounding Page.",
      input_schema: {
        type: "object",
        properties: {
          html: { type: "string", description: "Vollständiges HTML-Dokument." },
          title: { type: "string" },
          meta_description: { type: "string" },
          schema_type: { type: "string" },
        },
        required: ["html", "title", "meta_description", "schema_type"],
      },
    },
    normalize: (json, ctx): GroundingBuildOutput => {
      const r = rec(json);
      return {
        html: normalizeGroundingHtml(r.html) ?? "",
        title: str(r.title, 200) || ctx.page.entityName,
        meta_description: str(r.meta_description, 300),
        schema_type: str(r.schema_type, 80) || ctx.page.schemaType || "Thing",
      };
    },
  };
}

function endpruefungSpec(context: GroundingRunContext, rules: GroundingAgentRules): GroundingStepSpec {
  return {
    maxTokens: 12_000,
    system: `${rules.base}

Schritt 4 Endprüfung: Du prüfst die HTML-Datei (Schritt 3) gegen die Faktenbasis und die Checkliste des Standards v1.7, bevor ein Mensch sie freigibt.
${rules.standard}

Checkliste:
1. Ist die Hauptentität eindeutig, H1 nur der Name, Definition im ersten Absatz?
2. Tragen die wichtigen H2 den Entitätsnamen, ist jeder Abschnitt allein verständlich?
3. Steht jeder Fakt der Seite in der Faktenbasis (ohne Streichbefund)? Alles andere ist ein issue mit severity high.
4. Spiegelt das JSON-LD nur Sichtbares, stimmen Typ, @id, Daten, mainEntity? Keine lastReviewed/reviewedBy, kein Prüfhinweis, kein Badge.
5. Haben zeitabhängige Werte einen Stand, sind Quellen sichtbar?
6. Keine Sätze über KI/LLM/Grounding im sichtbaren Text, keine Floskeln, keine Superlative, kein „wir“.
7. Technik: gültiges Dokument, lang="de", canonical, title, description, Standard-Zeile v1.6, Größe unter ${GROUNDING_HTML_TARGET_CHARS.toLocaleString("de-DE")} Zeichen.

Ergebnis:
- issues: jede Abweichung mit Vorschlag (severity high = Fakt falsch/unbelegt oder Pflichtblock fehlt, medium = Struktur/JSON-LD, low = Stil).
- corrected_html: Wenn du Abweichungen selbst beheben kannst (streichen, umformulieren, JSON-LD angleichen, Struktur), liefere die vollständige korrigierte HTML-Datei. Füge nie neue Fakten hinzu. Ist nichts zu ändern, lass corrected_html leer.
- ok: true, wenn nach der Korrektur keine issues mit severity high übrig sind.
- summary: drei Sätze für die Redaktion: was geprüft wurde, was korrigiert wurde, was ein Mensch noch prüfen muss (die sechs Prüfpunkte des Standards: Richtigkeit, Aktualität, Quellen, Entitätszuordnung, Konsistenz, Freigabe).`,
    user: join([pageBlock(context), notesBlock(context), factsBlock(context), checkBlock(context), htmlBlock(context)]),
    tool: {
      name: "submit_endpruefung",
      description: "Ergebnis der Endprüfung, optional mit korrigierter HTML-Datei.",
      input_schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          issues: FINDINGS_ITEMS,
          corrected_html: { type: "string", description: "Vollständiges korrigiertes HTML-Dokument oder leer." },
          summary: { type: "string" },
        },
        required: ["ok", "issues", "corrected_html", "summary"],
      },
    },
    normalize: (json): GroundingFinalOutput => {
      const r = rec(json);
      const issues = normalizeGroundingFindings(r.issues);
      return {
        ok: r.ok === true && !issues.some((i) => i.severity === "high"),
        issues,
        corrected_html: normalizeGroundingHtml(r.corrected_html),
        summary: str(r.summary, 2_000),
      };
    },
  };
}

const SPECS: Record<number, (context: GroundingRunContext, rules: GroundingAgentRules) => GroundingStepSpec> = {
  [GROUNDING_STEP_FAKTEN]: faktenSpec,
  [GROUNDING_STEP_FAKTENCHECK]: faktencheckSpec,
  [GROUNDING_STEP_BAUEN]: bauenSpec,
  [GROUNDING_STEP_ENDPRUEFUNG]: endpruefungSpec,
};

export function groundingStepSpec(
  step: number,
  context: GroundingRunContext,
  rules?: { base?: string | null; standard?: string | null } | null,
): GroundingStepSpec {
  const build = SPECS[step];
  if (!build) throw new Error(`Unbekannter Schritt ${step}.`);
  return build(context, resolveGroundingAgentRules(rules));
}

/** `llms.txt` for the domain: the Hub and every finished Entitätsseite. */
export function buildGroundingLlmsTxt(input: {
  organisationName: string;
  websiteUrl: string | null;
  pages: Array<{ kind: "hub" | "entity"; name: string; url: string; description: string | null }>;
}): string {
  const hub = input.pages.find((p) => p.kind === "hub") ?? null;
  const entities = input.pages.filter((p) => p.kind !== "hub");
  const lines = [`# ${input.organisationName}`];
  if (hub?.description?.trim()) lines.push("", `> ${hub.description.trim()}`);
  if (input.websiteUrl) lines.push("", `Website: ${input.websiteUrl}`);
  lines.push("", "## Fakten");
  if (hub) lines.push(`- [${hub.name}](${hub.url})${hub.description ? `: ${hub.description.trim()}` : ""}`);
  for (const e of entities) lines.push(`- [${e.name}](${e.url})${e.description ? `: ${e.description.trim()}` : ""}`);
  lines.push("", "Grounding Page Standard v1.6 – https://groundingpage.com/spec/");
  return `${lines.join("\n")}\n`;
}

/**
 * „Abschnitt überarbeiten lassen“ and the buttons on the open points („Vorschlag umsetzen“,
 * „Eigene Angabe“): one Abschnitt of a written text is rewritten on request, nothing else.
 * One Claude call returns that Abschnitt; the code checks it like „Antworten einarbeiten“:
 * same id and level, every placeholder and marker kept unless the request settles it, no number
 * and no link that is neither in the Abschnitt, the request nor the facts. The editor sees before
 * and after and takes it over or not. Pure; the routes call the model and store the result.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { isKundePrueft, kundePrueftPlaceholder } from "@/lib/dt/content/pipeline/kunde-prueft";
import {
  BASE_RULES,
  BLOCKS_SCHEMA,
  QUESTION_RULES,
  anbieterBlock,
  avatarBlock,
  brancheRules,
  clientWishesBlock,
  clientWishesRules,
  currentTextBlock,
  joinPromptParts,
  kontaktBlock,
  notesBlock,
  pageBlock,
  pageTypeRules,
  settingsBlock,
  type ContentPipelineContext,
} from "@/lib/dt/content/pipeline/prompts";
import { DEFAULT_TEXTER_PROMPT } from "@/lib/dt/content/texter-prompt";
import { ContentTextLimitError, blocksToPromptText, htmlToPlainText, normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentFinding } from "@/lib/dt/content/types";

export const REVISE_USAGE_MODE = "content.revise";
export const REVISE_MAX_TOKENS = 8_000;
export const REVISE_INSTRUCTION_MAX = 2_000;

/** What the editor asks for. `info` is a confirmed fact of the editors („Eigene Angabe“). */
export type ContentRevisionRequest = {
  instruction?: string | null;
  info?: string | null;
  /** The open point the request is about („Vorschlag umsetzen“, „Eigene Angabe“). */
  finding?: Pick<ContentFinding, "title" | "problem" | "proposal"> | null;
  /** Several open points on the same Abschnitt, all of whose proposals are worked in at once („Jetzt umsetzen“). */
  findings?: Array<Pick<ContentFinding, "title" | "problem" | "proposal">> | null;
};

/** The open points of a request: the several ones of „Jetzt umsetzen“, or the one. */
export function requestFindings(request: ContentRevisionRequest): Array<Pick<ContentFinding, "title" | "problem" | "proposal">> {
  if (request.findings && request.findings.length > 0) return request.findings;
  return request.finding ? [request.finding] : [];
}

export const REVISE_RULES = `Du überarbeitest genau einen Abschnitt eines fertigen Webseitentexts nach dem Auftrag der Redaktion.
- Gib nur diesen einen Abschnitt zurück: dieselbe id, dieselbe Ebene (level).
- Ändere nur, was der Auftrag verlangt. Alles andere im Abschnitt bleibt wörtlich, auch Platzhalter und Marker ([BITTE PRÜFEN: …], [LINK: …], [DATUM], [FOTO: …]), außer der Auftrag löst einen Platzhalter ausdrücklich auf.
- Überschrift und Text darfst du ändern, wenn der Auftrag es verlangt. Die Regeln des Text-Prompts und der Seitentyp-Vorlage für diesen Abschnitt gelten weiter (z. B. Länge einer Hero-Überschrift).
- Eine „Angabe der Redaktion“ ist ein bestätigter Fakt: Zahlen, Namen, Preise, Fristen und Orte übernimmst du genau so, wie sie dort stehen. Du formulierst nur den Satz so, dass er grammatisch und im Ton passt. Lautet sie „KUNDE PRÜFT“ (auch sinngemäß), setzt du an der passenden Stelle den genannten Platzhalter und nie diese Worte.
- Keine neue Aussage über den Anbieter (was er tut, verlangt, anbietet, ankauft, akzeptiert), die nicht in den Anbieterfakten, dem Faktenauszug, den Antworten des Kunden, den Kontaktdaten, den Anmerkungen oder dem Auftrag steht. Auch keine Ausnahme, Bedingung oder Alternative, die dort nicht steht. Allgemeines Fachwissen ersetzt keine Angabe über den Anbieter.
- Bei einem offenen Punkt änderst du nur die Sätze, die er nennt oder betrifft; jeder andere Satz bleibt wörtlich. Fehlt eine Angabe, die der Vorschlag bräuchte, schwächst du die Aussage ab oder lässt sie weg, statt etwas zu ergänzen.
- Was im Block „Gesperrt“ steht, kommt nicht in den Text.`;

export const REVISE_TOOL: Anthropic.Tool = {
  name: "submit_abschnitt",
  description: "Der überarbeitete Abschnitt, mit derselben id und Ebene.",
  input_schema: {
    type: "object",
    properties: { block: { ...BLOCKS_SCHEMA.items, description: "Genau der überarbeitete Abschnitt." } },
    required: ["block"],
  },
};

function clean(text: string | null | undefined, max = REVISE_INSTRUCTION_MAX): string {
  return (text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);
}

/** The request in plain words, as the model and the page's notes get it. */
export function revisionOrder(request: ContentRevisionRequest): string {
  const lines: string[] = [];
  const several = request.findings && request.findings.length > 1 ? request.findings : null;
  if (several) {
    lines.push("Mehrere offene Punkte in diesem Abschnitt. Setze alle Vorschläge um, jeden nur an der Stelle, die er betrifft:");
    several.forEach((p, i) => {
      lines.push(`${i + 1}. Offener Punkt: ${clean(p.title, 200)}`);
      if (p.problem) lines.push(`   Problem: ${clean(p.problem, 1_000)}`);
      if (p.proposal) lines.push(`   Vorschlag (umsetzen): ${clean(p.proposal, 1_000)}`);
    });
  }
  const f = several ? null : request.finding ?? request.findings?.[0] ?? null;
  if (f) {
    lines.push(`Offener Punkt: ${clean(f.title, 200)}`);
    if (f.problem) lines.push(`Problem: ${clean(f.problem, 1_000)}`);
    if (f.proposal && !request.info) lines.push(`Vorschlag (umsetzen): ${clean(f.proposal, 1_000)}`);
  }
  if (request.info) {
    const info = clean(request.info);
    if (isKundePrueft(info) && f) {
      lines.push(`Angabe der Redaktion: KUNDE PRÜFT. Setze an der passenden Stelle den Platzhalter ${kundePrueftPlaceholder(f.title)} und streiche den Satz nicht.`);
    } else {
      lines.push(`Angabe der Redaktion (bestätigter Fakt, genau so übernehmen): ${info}`);
    }
  }
  if (request.instruction) lines.push(`Auftrag: ${clean(request.instruction)}`);
  return lines.join("\n");
}

/** The prompt of one revision: the step rules, the page's facts, the whole text for context, the Abschnitt and the order. */
export function revisionPrompt(context: ContentPipelineContext, target: ContentTextBlock, request: ContentRevisionRequest): { system: string; user: string } {
  const general = context.texterPrompt?.trim() || DEFAULT_TEXTER_PROMPT;
  return {
    system: joinPromptParts([
      REVISE_RULES,
      BASE_RULES,
      `Allgemeine Regeln (jeder Seitentyp):\n${general}`,
      `Seitentyp-Vorlage (gilt bei Widerspruch vor den allgemeinen Regeln):\n${pageTypeRules(context)}`,
      QUESTION_RULES,
      ...clientWishesRules(context),
      brancheRules(context.settings),
    ]),
    user: joinPromptParts([
      pageBlock(context),
      anbieterBlock(context),
      kontaktBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      clientWishesBlock(context),
      notesBlock(context),
      currentTextBlock(context),
      `## Abschnitt, den du überarbeitest (id ${target.id}, Ebene ${target.level})\n${blocksToPromptText([target])}`,
      `## Auftrag der Redaktion\n${revisionOrder(request)}`,
    ]),
  };
}

const MARKER_RE = /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN|QUELLE\s+BITTE|PREIS\s+BITTE|LINK\s*:|DATUM|FOTO\s*:|HERO)[^\]]*\]/giu;

function plain(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return `${block.heading ?? ""}\n${htmlToPlainText(block.html)}`.replace(/[ \t]+/g, " ");
}

function markers(text: string): string[] {
  return [...text.matchAll(MARKER_RE)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

export type RevisionCheck = { ok: true; block: ContentTextBlock } | { ok: false; reasons: string[] };

/**
 * The model's Abschnitt, checked. `allowed` is every text a new number or link may come from (the
 * facts, the notes, the Kontaktdaten). Id and level are always the old ones.
 */
export function checkRevision(json: unknown, before: ContentTextBlock, request: ContentRevisionRequest, allowed: string): RevisionCheck {
  const raw = json && typeof json === "object" ? (json as Record<string, unknown>).block : null;
  let parsed: ContentTextBlock[];
  try {
    parsed = normalizeBlocks(raw ? [{ ...(raw as Record<string, unknown>), level: before.level }] : []);
  } catch (error) {
    if (error instanceof ContentTextLimitError) return { ok: false, reasons: [error.message] };
    throw error;
  }
  const proposed = parsed[0];
  if (!proposed) return { ok: false, reasons: ["Die KI hat keinen Abschnitt geliefert."] };
  const after: ContentTextBlock = { ...proposed, id: before.id, level: before.level, heading: before.heading == null && !proposed.heading ? null : proposed.heading };
  const reasons: string[] = [];
  const order = revisionOrder(request);

  // Markers: every one stays unless the order names it; a KUNDE PRÜFT placeholder may come in.
  const was = markers(plain(before));
  const now = markers(plain(after));
  const settled = new Set(was.filter((m) => order.includes(m) || order.includes(m.replace(/^\[|\]$/g, ""))));
  const missing = was.filter((m) => !settled.has(m) && !now.includes(m));
  if (missing.length > 0) reasons.push(`Platzhalter oder Marker entfernt: ${missing.join(", ")}`);
  const pending = request.info && isKundePrueft(request.info) && request.finding ? kundePrueftPlaceholder(request.finding.title) : null;
  let added = now.filter((m) => !was.includes(m) && m !== pending);
  // An open point about a missing customer fact may end in one placeholder for it (instead of an
  // invented sentence): one new [BITTE PRÜFEN: …] is allowed then, never another marker.
  if (!request.info) {
    // One per open point of the request.
    for (let n = requestFindings(request).length; n > 0; n--) {
      const check = added.findIndex((m) => /^\[\s*BITTE\s+PR(?:Ü|UE)FEN\b/iu.test(m));
      if (check < 0) break;
      added = added.filter((_, i) => i !== check);
    }
  }
  if (added.length > 0) reasons.push(`Neuer Platzhalter oder Marker: ${added.join(", ")}`);
  if (/kunde\s+pr(?:ü|ue)ft/i.test(plain(after)) && !/kunde\s+pr(?:ü|ue)ft/i.test(plain(before))) reasons.push("„KUNDE PRÜFT“ steht im Text");

  // Numbers and links only from the Abschnitt, the order or the facts.
  const source = new Set(numbers(`${plain(before)}\n${order}\n${allowed}`));
  const newNumbers = [...new Set(numbers(plain(after)))].filter((n) => !source.has(n));
  if (newNumbers.length > 0) reasons.push(`Zahl, die weder im Abschnitt, im Auftrag noch in den Fakten steht: ${newNumbers.join(", ")}`);
  const urls = (t: string) => (t.match(/https?:\/\/[^\s"<>)]+|www\.[^\s"<>)]+/gi) ?? []).map((u) => u.toLowerCase());
  const knownUrls = new Set(urls(`${before.html}\n${order}\n${allowed}`));
  const newUrls = urls(after.html).filter((u) => !knownUrls.has(u));
  if (newUrls.length > 0) reasons.push(`Neuer Link: ${newUrls.join(", ")}`);

  if (after.heading === before.heading && after.html.trim() === before.html.trim()) reasons.push("Die KI hat nichts geändert.");
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, block: after };
}

/** Every text a revision may take numbers and links from. */
export function revisionAllowedText(context: ContentPipelineContext): string {
  return [
    ...context.sections.map((s) => s.current),
    ...(context.customerAnswers ?? []).map((a) => `${a.question} ${a.answer}`),
    ...(context.pageFacts?.facts ?? []).map((f) => `${f.fact} ${f.quote}`),
    ...(context.contact?.lines ?? []).map((l) => l.value),
    ...context.notes,
    context.page.ki_prompt ?? "",
  ].join("\n");
}

/** The note on the page, so a later run keeps what the editors decided (confirmed facts above all). */
export function revisionNote(target: Pick<ContentTextBlock, "id" | "heading">, request: ContentRevisionRequest): string {
  const name = target.heading?.trim() ? `„${target.heading.trim().slice(0, 80)}“` : `„${target.id}“`;
  if (request.info && request.finding) {
    return isKundePrueft(request.info)
      ? `Zu „${clean(request.finding.title, 200)}“: KUNDE PRÜFT – Platzhalter bleibt.`
      : `Angabe der Redaktion zu „${clean(request.finding.title, 200)}“ (Abschnitt ${name}): ${clean(request.info)}`;
  }
  const several = requestFindings(request);
  if (several.length > 1) {
    const titles = several.map((p) => `„${clean(p.title, 120)}“`).join(", ");
    return `Abschnitt ${name} überarbeitet nach den Vorschlägen zu ${titles}: ${several.map((p) => clean(p.proposal, 300)).join(" | ")}`.slice(0, 2_000);
  }
  if (several.length === 1 && !request.finding) request = { ...request, finding: several[0] };
  if (request.finding) return `Abschnitt ${name} überarbeitet nach Vorschlag zu „${clean(request.finding.title, 200)}“: ${clean(request.finding.proposal, 600)}`;
  return `Abschnitt ${name} überarbeitet: ${clean(request.instruction, 600)}`;
}

export { findingKey, findingTargetBlock, withoutFinding } from "@/lib/dt/content/finding-target";

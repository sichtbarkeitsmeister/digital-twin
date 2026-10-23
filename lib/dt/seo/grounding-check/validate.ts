/**
 * Checks a draft before a person sees it and again before approval:
 * - JSON-LD parses and has the required nodes;
 * - mirror: every visible fact of an entity is in that entity's JSON-LD node, and every
 *   JSON-LD value is visible on the page (text, links, <time datetime>, title, meta);
 * - no fact without a source, review notice and reviewedBy/lastReviewed agree;
 * - warnings for marketing words and numbers in the prose that no fact supports.
 * Pure.
 */

import * as cheerio from "cheerio";

import {
  deriveGroundingPageLiveFacts,
  extractGroundingPageHtml,
  parseStandardVersion,
  parseVisibleReviewNotice,
} from "@/lib/dt/seo/detect-grounding-page-date";
import {
  GROUNDING_MARKETING_WORDS,
  GROUNDING_STANDARD_VERSION,
} from "@/lib/dt/prompts/grounding-page-standard";
import { type GroundingFactModel, looseText, visibleEntities } from "@/lib/dt/seo/grounding-check/fact-model";
import { contentLeaves, hasType, parseJsonLdFromHtml, type JsonLdNode } from "@/lib/dt/seo/grounding-check/jsonld";
import { normalizeUrlValue } from "@/lib/dt/seo/grounding-check/normalize";

export type ValidationIssue = { code: string; severity: "error" | "warning"; message: string };
export type GroundingValidation = { ok: boolean; checkedAt: string; issues: ValidationIssue[] };

const ISO_DATE = /^\d{4}(-\d{2}){0,2}(T[\d:.+-]+Z?)?$/;
const COUNTRY_WORDS = new Set(["deutschland", "germany", "de"]);

function forwardTokens(text: string): string[] {
  return looseText(text)
    .split(/[^\p{L}\p{N}@]+/u)
    .filter(Boolean);
}

type Haystack = { text: string; urls: Set<string>; datetimes: Set<string> };

/** What a reader (or crawler) sees: body text, title, meta description, links, dates. */
export function visibleHaystack(html: string): Haystack {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const datetimes = new Set<string>();
  $("a[href], link[rel='canonical']").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (/^https?:\/\//i.test(href)) urls.add(normalizeUrlValue(href));
    else if (/^mailto:/i.test(href)) urls.add(href.replace(/^mailto:/i, "").toLowerCase());
  });
  $("time[datetime]").each((_, el) => {
    const dt = ($(el).attr("datetime") ?? "").trim();
    if (dt) datetimes.add(dt.slice(0, 10));
  });
  const title = $("title").first().text();
  const meta = $('meta[name="description"]').attr("content") ?? "";
  $("script, style, noscript, template").remove();
  const text = looseText(`${title} ${meta} ${$("body").text()}`);
  return { text, urls, datetimes };
}

function leafVisible(value: string, hay: Haystack): boolean {
  if (/^https?:\/\//i.test(value)) return hay.urls.has(normalizeUrlValue(value));
  if (ISO_DATE.test(value)) return hay.datetimes.has(value.slice(0, 10)) || hay.text.includes(looseText(value));
  const loose = looseText(value);
  if (/^\d+$/.test(loose)) return new RegExp(`(^|\\D)${loose}(\\D|$)`).test(hay.text);
  return hay.text.includes(loose) || hay.urls.has(loose);
}

/** JSON-LD values that a reader cannot see on the page. */
export function jsonLdValuesNotVisible(html: string): Array<{ path: string; value: string }> {
  const parsed = parseJsonLdFromHtml(html);
  const hay = visibleHaystack(html);
  const out: Array<{ path: string; value: string }> = [];
  parsed.documents.forEach((doc, i) => {
    for (const leaf of contentLeaves(doc)) {
      if (!leafVisible(leaf.value, hay)) out.push({ path: `[${i + 1}] ${leaf.path}`, value: leaf.value });
    }
  });
  return out;
}

function nodeTokenSet(node: JsonLdNode): Set<string> {
  const tokens = new Set<string>();
  for (const leaf of contentLeaves(node)) for (const t of forwardTokens(leaf.value)) tokens.add(t);
  return tokens;
}

/** Visible facts, definitions and FAQ that are missing from the JSON-LD. */
export function visibleFactsNotInJsonLd(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const $ = cheerio.load(html);
  const parsed = parseJsonLdFromHtml(html);
  const byId = new Map<string, JsonLdNode>();
  for (const node of parsed.nodes) if (typeof node["@id"] === "string") byId.set(node["@id"], node);

  const checkText = (node: JsonLdNode, field: "description" | "disambiguatingDescription", text: string, what: string, name: string) => {
    const value = typeof node[field] === "string" ? (node[field] as string) : "";
    if (!looseText(value).includes(looseText(text))) {
      issues.push({ code: "mirror_text", severity: "error", message: `${what} von ${name} steht nicht im JSON-LD (${field}).` });
    }
  };

  $("[data-entity], [data-entity-ref]").each((_, el) => {
    const section = $(el);
    const id = section.attr("data-entity") ?? section.attr("data-entity-ref") ?? "";
    const node = byId.get(id);
    const name = section.find("h2, h3").first().text().trim() || id;
    if (!node) {
      issues.push({ code: "mirror_node", severity: "error", message: `Für „${name}“ fehlt das JSON-LD-Objekt (${id}).` });
      return;
    }
    const nodeName = typeof node.name === "string" ? node.name : name;
    if (section.is("p.lead-definition")) {
      checkText(node, "description", section.text(), "Die Definition", nodeName);
      return;
    }
    const tokens = nodeTokenSet(node);
    section.find("dl.data-grid dt").each((_, dt) => {
      const label = $(dt).text().replace(/\s+/g, " ").trim();
      $(dt)
        .nextUntil("dt", "dd")
        .each((_, dd) => {
          const cell = $(dd).clone();
          if (cell.attr("data-visible-only") === "true") return;
          cell.find(".stand").remove();
          const text = cell.find("time[datetime]").attr("datetime") ?? cell.text();
          const missing = forwardTokens(text).filter((t) => !tokens.has(t) && !COUNTRY_WORDS.has(t));
          if (missing.length === 0) return;
          issues.push({
            code: "mirror_fact",
            severity: /^rechtsform$/i.test(label) ? "warning" : "error",
            message: `${nodeName}: „${label}: ${cell.text().trim()}“ steht nicht im JSON-LD.`,
          });
        });
    });
    section.find("p.definition").each((_, p) => checkText(node, "description", $(p).text(), "Die Definition", nodeName));
    section.find("p.abgrenzung").each((_, p) => {
      const text = $(p).text().replace(/^\s*Abgrenzung:\s*/i, "");
      checkText(node, "disambiguatingDescription", text, "Die Abgrenzung", nodeName);
    });
  });

  const faqNodes = parsed.nodes.filter((n) => hasType(n, ["FAQPage"]));
  const questions = faqNodes.flatMap((n) => (Array.isArray(n.mainEntity) ? n.mainEntity : n.mainEntity ? [n.mainEntity] : [])) as JsonLdNode[];
  $("section#faq h3").each((_, h) => {
    const question = $(h).text().trim();
    const answer = $(h).nextAll("p").first().text().trim();
    const match = questions.find((q) => looseText(String(q.name ?? "")) === looseText(question));
    const accepted = match?.acceptedAnswer as JsonLdNode | undefined;
    if (!match) {
      issues.push({ code: "mirror_faq", severity: "error", message: `FAQ „${question}“ fehlt in FAQPage.` });
    } else if (looseText(String(accepted?.text ?? "")) !== looseText(answer)) {
      issues.push({ code: "mirror_faq", severity: "error", message: `FAQ „${question}“: Antwort weicht von FAQPage ab.` });
    }
  });
  return issues;
}

/**
 * Technical and v1.7 checks of the HTML file. `reviewed` = after approval. `strict` for files
 * built from the template; an existing (CMS) page refreshed in place keeps its scripts.
 */
export function validateGroundingHtml(html: string, opts: { reviewed: boolean; strict?: boolean }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const strict = opts.strict !== false;
  const error = (code: string, message: string) => issues.push({ code, severity: "error", message });
  const warning = (code: string, message: string) => issues.push({ code, severity: "warning", message });
  const $ = cheerio.load(html);

  if (!/^de\b/i.test($("html").attr("lang") ?? "")) error("lang", "<html lang=\"de\"> fehlt.");
  if (!$('link[rel="canonical"]').attr("href")) error("canonical", "Kanonische URL fehlt.");
  if (!$("title").text().trim()) error("title", "<title> fehlt.");
  const meta = $('meta[name="description"]').attr("content")?.trim() ?? "";
  if (!meta) warning("meta_description", "Meta-Description fehlt.");
  else if (meta.length > 160) warning("meta_description", `Meta-Description ist ${meta.length} Zeichen lang (empfohlen bis 160).`);
  if ($("h1").length !== 1) error("h1", `Die Seite braucht genau eine H1 (gefunden: ${$("h1").length}).`);
  if ($("script").toArray().some((s) => ($(s).attr("type") ?? "").toLowerCase() !== "application/ld+json")) {
    (strict ? error : warning)("javascript", "Die Seite enthält JavaScript; erlaubt ist nur JSON-LD.");
  }
  if (/noindex/i.test($('meta[name="robots"]').attr("content") ?? "")) error("noindex", "Die Seite ist auf noindex gesetzt.");
  if (html.length > 150_000) warning("size", `Die Datei ist ${Math.round(html.length / 1024)} KB groß; leichter ist besser.`);

  const parsed = parseJsonLdFromHtml(html);
  if (parsed.scriptCount === 0) error("jsonld_missing", "Kein JSON-LD auf der Seite.");
  for (const n of parsed.invalidScripts) error("jsonld_invalid", `JSON-LD-Block ${n} ist kein gültiges JSON.`);
  const webPage = parsed.nodes.find((n) => hasType(n, ["WebPage"]));
  if (!webPage) error("webpage", "WebPage-Objekt fehlt im JSON-LD.");
  else if (typeof webPage.dateModified !== "string") error("date_modified", "dateModified fehlt im WebPage-Objekt.");
  if (!parsed.nodes.some((n) => typeof n["@id"] === "string" && (n["@id"] as string).endsWith("/#organization"))) {
    error("organization_id", "Organisation ohne stabile @id <origin>/#organization.");
  }

  for (const leaf of jsonLdValuesNotVisible(html)) {
    error("mirror_invisible", `JSON-LD enthält „${leaf.value.slice(0, 80)}“ (${leaf.path}), das auf der Seite nicht sichtbar ist.`);
  }
  issues.push(...visibleFactsNotInJsonLd(html));

  const live = deriveGroundingPageLiveFacts(extractGroundingPageHtml(html));
  $("script, style").remove();
  const notice = parseVisibleReviewNotice($("body").text());
  const version = parseStandardVersion($("body").text()) ?? parseStandardVersion(html);
  if (opts.reviewed) {
    if (!live.lastReviewed || !live.reviewedBy) error("review_jsonld", "reviewedBy und lastReviewed fehlen im WebPage-Objekt.");
    if (!notice.lastReviewed || !notice.reviewedBy) error("review_notice", "Der sichtbare Prüfhinweis fehlt.");
    if (version !== GROUNDING_STANDARD_VERSION) error("standard_version", `Die Seite muss nach der Prüfung Standard v${GROUNDING_STANDARD_VERSION} nennen.`);
  } else if (version === GROUNDING_STANDARD_VERSION && !live.lastReviewed) {
    error("standard_version", `Ohne dokumentierte Prüfung darf die Seite nicht v${GROUNDING_STANDARD_VERSION} nennen.`);
  }
  if (live.reviewMismatch) error("review_mismatch", "Prüfer oder Datum im sichtbaren Hinweis weichen vom JSON-LD ab.");
  return issues;
}

/** Facts and FAQ on the page need a source; the organisation needs a definition. */
export function validateFactModelSources(model: GroundingFactModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entities = visibleEntities(model);
  for (const entity of entities) {
    for (const fact of entity.facts) {
      if (!fact.sourceUrl.trim() || !fact.quote.trim()) {
        issues.push({ code: "source", severity: "error", message: `${entity.name}: „${fact.value}“ hat keine Quelle mit Zitat.` });
      }
    }
    if (!entity.definition.trim()) {
      issues.push({ code: "definition", severity: entity.kind === "organization" ? "error" : "warning", message: `${entity.name}: Definitionssatz fehlt.` });
    }
    if (entity.disambiguation.length === 0) {
      issues.push({ code: "abgrenzung", severity: "warning", message: `${entity.name}: Abgrenzung fehlt.` });
    }
  }
  for (const f of model.faq.filter((x) => x.included)) {
    if (!f.sourceUrl.trim() || !f.quote.trim()) issues.push({ code: "source", severity: "error", message: `FAQ „${f.question}“ hat keine Quelle.` });
  }
  return issues;
}

/** Marketing words anywhere on the page; numbers in the prose that no fact contains. */
export function validateProse(model: GroundingFactModel, html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const $ = cheerio.load(html);
  $("script, style").remove();
  const text = ` ${looseText($("main").text() || $("body").text())} `;
  const found = GROUNDING_MARKETING_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`[\\s(„"]${escaped}${word.endsWith("-") ? "" : "(?=[\\s,.;:!?)“\"])"}`, "i").test(text);
  });
  if (found.length > 0) {
    issues.push({ code: "marketing", severity: "warning", message: `Werbesprache prüfen: ${found.slice(0, 8).join(", ")}.` });
  }

  const factText = looseText(
    [
      ...model.entities.flatMap((e) => [e.name, e.definition, ...e.disambiguation, ...e.facts.map((f) => f.value)]),
      ...model.faq.map((f) => `${f.question} ${f.answer}`),
    ].join(" "),
  );
  const numbers = new Set((model.prose?.lead ?? []).join(" ").match(/\d+(?:[.,]\d+)?/g) ?? []);
  const unsupported = [...numbers].filter((n) => !factText.includes(n.toLowerCase()));
  if (unsupported.length > 0) {
    issues.push({ code: "prose_numbers", severity: "warning", message: `Zahlen im Einleitungstext ohne Fakt: ${unsupported.join(", ")}.` });
  }
  return issues;
}

export function validateLlmsTxt(text: string | null, opts: { reviewed: boolean; reviewDay?: string | null }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!text?.trim()) return [{ code: "llms_empty", severity: "error", message: "llms.txt ist leer." }];
  if (!/^#\s/.test(text.trimStart())) issues.push({ code: "llms_title", severity: "warning", message: "llms.txt beginnt nicht mit „# Name“." });
  if (!/^entity:/m.test(text)) issues.push({ code: "llms_entities", severity: "warning", message: "llms.txt enthält keine „entity:“-Blöcke." });
  if (!/^##\s+METADATEN/m.test(text)) issues.push({ code: "llms_meta", severity: "warning", message: "Abschnitt „## METADATEN“ fehlt." });
  if (opts.reviewed) {
    const reviewed = text.match(/^last_reviewed:\s*(\S+)/m)?.[1];
    if (!reviewed || !/^reviewed_by:\s*\S/m.test(text)) {
      issues.push({ code: "llms_review", severity: "error", message: "llms.txt nennt last_reviewed und reviewed_by nicht." });
    } else if (opts.reviewDay && reviewed !== opts.reviewDay) {
      issues.push({ code: "llms_review", severity: "error", message: `llms.txt nennt last_reviewed ${reviewed}, die Seite ${opts.reviewDay}.` });
    }
  }
  return issues;
}

/** All checks of a draft. Errors block approval; warnings are for the reviewer. */
export function validateGroundingDraft(input: {
  html: string | null;
  llmsTxt: string | null;
  model: GroundingFactModel | null;
  reviewed: boolean;
  reviewDay?: string | null;
  /** Generated from the model (false for refresh-only drafts of an existing page). */
  generated: boolean;
  now?: Date;
}): GroundingValidation {
  const issues: ValidationIssue[] = [];
  if (!input.html?.trim()) issues.push({ code: "html_empty", severity: "error", message: "grounding.html ist leer." });
  else {
    issues.push(...validateGroundingHtml(input.html, { reviewed: input.reviewed, strict: input.generated }));
    if (input.model && input.generated) issues.push(...validateProse(input.model, input.html));
  }
  if (input.model && input.generated) issues.push(...validateFactModelSources(input.model));
  issues.push(...validateLlmsTxt(input.llmsTxt, { reviewed: input.reviewed, reviewDay: input.reviewDay }));
  return {
    ok: !issues.some((i) => i.severity === "error"),
    checkedAt: (input.now ?? new Date()).toISOString(),
    issues,
  };
}

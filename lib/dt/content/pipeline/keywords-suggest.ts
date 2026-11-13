/**
 * „Keywords analysieren und eintragen“. Two jobs, both one short call per page:
 *   - „suchen“: a page with no keywords gets the DigitalTwin's (`dt_content_pages.keywords`,
 *     `source: "analyse"`).
 *   - „einteilen“: the Seitenstruktur names several keywords for a page in one cell without
 *     saying which is the main keyword. The Zwilling assigns the roles from exactly that list:
 *     nothing added, nothing dropped, the search volumes stay (`sorted: true`).
 * Search volume: nothing here knows one. Model
 * tier „check“) per page with what the live page is aimed at today (Title, H1, Meta-Description,
 * its text), the Anbieterfakten, the Zielgruppe and the other pages of the website. No search
 * volume: nothing here knows one. A main keyword exists once on the website: the keywords the
 * other pages carry are locked in the prompt and checked in code (one retry, then a failure the
 * editor resolves by hand). Usage `content.keywords`, cost on the page.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordJunkReason, keywordTaken } from "@/lib/dt/content/keyword-compare";
import { effectiveContentPageType } from "@/lib/dt/content/page-types";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { callContentTool } from "@/lib/dt/content/pipeline/llm";
import { anbieterBlock, avatarBlock, notesBlock, pageBlock, type ContentPipelineContext } from "@/lib/dt/content/pipeline/prompts";
import { loadContext } from "@/lib/dt/content/pipeline/run-step";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import {
  cleanKeywordInput,
  contentDbErrorMessage,
  contentKeywordOrigin,
  contentKeywordTodo,
  keywordKey,
  loadContentPageOutline,
  mainKeywordTakenBy,
  markContentPageNoKeyword,
  num,
  saveContentPageKeywords,
  type ContentOutlinePage,
  type ContentPageRow,
} from "@/lib/dt/content/store";
import type { ContentPageKeywords } from "@/lib/dt/content/excel-structure";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export const KEYWORDS_USAGE_MODE = "content.keywords";
const SUGGEST_TIMEOUT_MS = 90_000;
const SUGGEST_MAX_TOKENS = 1_200;
const ANBIETER_CHARS = 14_000;
const AVATAR_CHARS = 5_000;
const TAKEN_MAX = 400;

export const KEYWORDS_SUGGEST_SYSTEM = `Du legst für eine Seite einer Website das Hauptkeyword und die Nebenkeywords fest. Du schreibst nichts für die Seite.
Grundlage, in dieser Reihenfolge:
1. Worauf die Seite heute ausgerichtet ist: Title, H1, Meta-Description, Pfad und bisheriger Text der Live-Seite. Eine bestehende, passende Ausrichtung bleibt erhalten – die Seite soll nicht auf ein anderes Thema umziehen.
2. Die Ausrichtung des Unternehmens laut Anbieterfakten: Leistungen, Schwerpunkte, Einzugsgebiet. Kein Keyword für etwas, das der Anbieter nicht anbietet.
3. Wie die Zielgruppe sucht: ihre Wörter, nicht die Fachsprache des Anbieters, wenn beides auseinandergeht.
4. Die Rolle der Seite in der Website: Seitentyp, Hauptsilo und die übrigen Seiten.
Hauptkeyword: genau eines, 1–5 Wörter, so wie Menschen es in die Suche tippen. Ein Ort gehört nur hinein, wenn der Anbieter regional arbeitet und der Ort in den Anbieterfakten oder Kontaktdaten steht. Der Firmenname ist kein Hauptkeyword, außer auf einer Seite über das Unternehmen selbst.
Jedes Hauptkeyword gibt es auf der Website nur einmal. Die Liste „Bereits vergebene Hauptkeywords“ ist gesperrt, auch in anderer Schreibweise oder Wortstellung. Liegt das naheliegende Keyword schon bei einer anderen Seite, bekommt diese Seite das spezifischere: Leistung plus Merkmal, Leistung plus Anlass oder Beschwerde, Leistung plus Ort, oder die Frage, die sie beantwortet. Die Startseite und eine Hauptsilo-Seite tragen den breiten Begriff, ihre Unterseiten die engeren.
Nebenkeywords: 3–8 Synonyme, Varianten und eng verwandte Suchbegriffe derselben Suchabsicht. Das Hauptkeyword einer anderen Seite darf als Nebenkeyword vorkommen, wenn sich die Seiten damit sinnvoll verlinken lassen; keine Wiederholung des eigenen Hauptkeywords.
Kein Suchvolumen nennen oder schätzen.
Eine Seite ohne Suchziel (Impressum, Datenschutz, AGB, Widerruf, Danke-Seite, reine Kontaktseite) bekommt kein Keyword: no_keyword = true, und reason sagt in einem Satz, warum.
reason: ein Satz, warum dieses Hauptkeyword zu dieser Seite passt und wie es sich von den Nachbarseiten abgrenzt.`;

export const KEYWORDS_CLASSIFY_SYSTEM = `Die Seitenstruktur nennt für eine Seite mehrere Keywords, ohne zu sagen, welches davon das Hauptkeyword ist. Du teilst sie ein. Du schreibst nichts für die Seite.
Du erfindest kein Keyword und lässt keines weg: Jedes brauchbare Keyword der Liste ist entweder das Hauptkeyword oder ein Nebenkeyword. Die Reihenfolge in der Liste ist keine Vorgabe.
Denke dabei mit: Prüfe, ob jeder Eintrag überhaupt ein Suchbegriff ist, den Menschen eintippen, und ob er zu dieser Seite passt. Unbrauchbar sind Spaltenüberschriften und Beschreibungen aus der Tabelle, Zahlen, Seiten- oder Firmennamen ohne Suchbezug und Begriffe, die zu einer ganz anderen Leistung gehören als die Seite behandelt. Melde sie in unusable_keywords; sie sind dann weder Haupt- noch Nebenkeyword. Sind alle unbrauchbar, lässt du main_keyword leer.
Hauptkeyword: genau eines, das, was die Seite am besten trägt. Grundlage, in dieser Reihenfolge:
1. Worauf die Seite heute ausgerichtet ist (Title, H1, Meta-Description, Pfad, bisheriger Text).
2. Die Ausrichtung des Unternehmens laut Anbieterfakten.
3. Wie die Zielgruppe sucht.
4. Die Rolle der Seite in der Website: Die Startseite und eine Hauptsilo-Seite tragen den breiten Begriff, ihre Unterseiten die engeren.
Das Suchvolumen ist ein Hinweis unter mehreren, nicht allein ausschlaggebend: Ein hohes Volumen für einen Begriff, den die Seite nicht trägt, ist kein Hauptkeyword.
Jedes Hauptkeyword gibt es auf der Website nur einmal. Die Liste „Bereits vergebene Hauptkeywords“ ist gesperrt, auch in anderer Schreibweise oder Wortstellung; nimm dann das beste der übrigen.
Nebenkeywords: alle übrigen, nach Relevanz für diese Seite geordnet, die wichtigsten zuerst.
reason: ein Satz, warum dieses Keyword das Hauptkeyword dieser Seite ist.`;

/** The tool for the assignment: only the keywords of the list are allowed. */
export function keywordsClassifyTool(list: readonly string[]): Anthropic.Tool {
  return {
    name: "submit_keyword_roles",
    description: "Hauptkeyword und Nebenkeywords, eingeteilt aus der Liste der Seitenstruktur.",
    input_schema: {
      type: "object",
      properties: {
        main_keyword: { type: "string", enum: [...list, ""], description: "Das eine Hauptkeyword, genau wie in der Liste geschrieben. Leer nur, wenn alle Einträge unbrauchbar sind." },
        secondary_keywords: { type: "array", items: { type: "string", enum: [...list] }, description: "Alle übrigen brauchbaren Keywords der Liste, wichtigste zuerst." },
        unusable_keywords: { type: "array", items: { type: "string", enum: [...list] }, description: "Einträge, die kein Suchbegriff sind oder nicht zur Seite passen." },
        reason: { type: "string", description: "Ein Satz Begründung für das Hauptkeyword (bei unbrauchbaren Einträgen: warum)." },
      },
      required: ["main_keyword", "secondary_keywords", "unusable_keywords", "reason"],
    },
  };
}

export const KEYWORDS_TOOL: Anthropic.Tool = {
  name: "submit_keywords",
  description: "Hauptkeyword und Nebenkeywords dieser Seite.",
  input_schema: {
    type: "object",
    properties: {
      no_keyword: { type: "boolean", description: "true nur für eine Seite ohne Suchziel (Impressum, Datenschutz …)." },
      main_keyword: { type: "string", description: "Das eine Hauptkeyword, 1–5 Wörter. Leer bei no_keyword." },
      secondary_keywords: { type: "array", items: { type: "string" }, description: "3–8 Nebenkeywords." },
      reason: { type: "string", description: "Ein Satz Begründung." },
    },
    required: ["main_keyword", "secondary_keywords", "reason"],
  },
};

/** Title, H1 and Meta-Description of the live page as the crawl stored them. */
export type LivePageSignals = { title: string | null; h1: string | null; meta_description: string | null };

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()} …` : t;
}

/** The main keywords the other pages carry, each with its page; the model must not use them again. */
export function takenMainKeywords(pages: readonly ContentOutlinePage[], slug: string): Array<{ keyword: string; page: string }> {
  const out: Array<{ keyword: string; page: string }> = [];
  for (const p of pages) {
    if (p.slug === slug) continue;
    const keyword = (p.keywords?.main.text ?? p.main_keyword ?? "").trim();
    if (keyword) out.push({ keyword, page: p.name });
  }
  return out.slice(0, TAKEN_MAX);
}

/** The user message: the page with its live signals, the locked keywords, Anbieterfakten and Zielgruppe (shortened). */
export function keywordsSuggestPrompt(
  context: ContentPipelineContext,
  live: LivePageSignals | null,
  taken: ReadonlyArray<{ keyword: string; page: string }>,
  rejected: string | null = null,
): string {
  const signals = live
    ? [
        "## Live-Seite heute (aus dem Crawl)",
        live.title ? `Title: ${clip(live.title, 300)}` : "",
        live.h1 ? `H1: ${clip(live.h1, 300)}` : "",
        live.meta_description ? `Meta-Description: ${clip(live.meta_description, 500)}` : "",
      ].filter(Boolean)
    : [];
  return [
    pageBlock(context),
    signals.length > 1 ? signals.join("\n") : "",
    notesBlock(context),
    taken.length > 0
      ? `## Bereits vergebene Hauptkeywords (gesperrt)\n${taken.map((t) => `- ${t.keyword} (Seite: ${t.page})`).join("\n")}`
      : "## Bereits vergebene Hauptkeywords (gesperrt)\n(noch keine)",
    rejected ? `Dein letzter Vorschlag „${rejected}“ ist bereits vergeben. Wähle ein anderes, spezifischeres Hauptkeyword für diese Seite.` : "",
    clip(anbieterBlock(context), ANBIETER_CHARS),
    clip(avatarBlock(context), AVATAR_CHARS),
  ]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** The list of the Seitenstruktur as the prompt shows it, with the search volumes. */
export function keywordsClassifyPrompt(
  context: ContentPipelineContext,
  list: ReadonlyArray<{ text: string; volume?: number }>,
  live: LivePageSignals | null,
  taken: ReadonlyArray<{ keyword: string; page: string }>,
): string {
  // The page block must not call the placeholder main keyword „gesetzt“: the roles are open.
  const open: ContentPipelineContext = { ...context, page: { ...context.page, keywords: null } };
  const base = keywordsSuggestPrompt(open, live, taken);
  const lines = list.map((k) => `- ${k.text}${k.volume != null ? ` (${k.volume}/Monat)` : ""}`);
  return [`## Keywords der Seitenstruktur (zu dieser Seite, Rollen offen)\n${lines.join("\n")}`, base].join("\n\n");
}

/**
 * The model's assignment onto the Excel's list: only keywords of the list count, in the Excel's
 * own spelling; what the model left out stays as a secondary keyword (nothing is lost). The main
 * keyword is the first of the model's choice that no other page carries; null when all are taken.
 */
export function applyKeywordRoles(
  list: ReadonlyArray<{ text: string; volume?: number }>,
  json: unknown,
  taken: ReadonlyArray<{ keyword: string; page: string }>,
): { main: string; secondary: string[]; reason: string; removed: string[] } | null {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const byKey = new Map(list.map((k) => [keywordKey(k.text), k.text]));
  const known = (value: unknown): string | null => (typeof value === "string" ? byKey.get(keywordKey(value)) ?? null : null);
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 400) : "";
  // What the model found unusable (no search term, not about this page) leaves the list.
  const removed: string[] = [];
  if (Array.isArray(r.unusable_keywords)) for (const k of r.unusable_keywords) {
    const text = known(k);
    if (text && !removed.includes(text)) removed.push(text);
  }
  const usable = list.filter((k) => !removed.includes(k.text));
  // Nothing usable left: main stays empty and the page gets a suggestion instead.
  if (usable.length === 0) return { main: "", secondary: [], reason, removed };
  const order: string[] = [];
  const add = (text: string | null) => {
    if (text && !removed.includes(text) && !order.includes(text)) order.push(text);
  };
  add(known(r.main_keyword));
  if (Array.isArray(r.secondary_keywords)) for (const k of r.secondary_keywords) add(known(k));
  for (const k of usable) add(k.text);
  const takenTexts = taken.map((t) => t.keyword);
  // A main keyword another page has (or a close variant of it) is not available.
  const main = order.find((text) => !keywordTaken(text, takenTexts, true));
  if (!main) return null;
  return { main, secondary: order.filter((text) => text !== main), reason, removed };
}

export type KeywordsAnswer = { no_keyword: boolean; main: string; secondary: string[]; reason: string };

/** Why a page was passed over without a call: no text is written for it, or it was found to have no search goal. */
export type KeywordsSkipped = "vorhanden" | "kein_text" | "kein_suchziel";

/** The model's answer, cleaned like an entry by hand. */
export function normalizeKeywordsAnswer(json: unknown): KeywordsAnswer {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const list = Array.isArray(r.secondary_keywords) ? r.secondary_keywords.filter((k): k is string => typeof k === "string") : [];
  const cleaned = cleanKeywordInput(typeof r.main_keyword === "string" ? r.main_keyword : "", list);
  return {
    // Only an explicit „kein Suchziel“ exempts a page; an empty answer is a failure, not a verdict.
    no_keyword: r.no_keyword === true,
    main: cleaned.main,
    secondary: cleaned.secondary,
    reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 400) : "",
  };
}

export type KeywordsSuggestResult =
  | { ok: true; keywords: ContentPageKeywords | null; cost_eur: number; reason: string; skipped?: KeywordsSkipped; no_keyword?: true }
  | { ok: false; status: number; message: string; cost_eur: number };

async function loadLiveSignals(service: SupabaseClient, page: ContentPageRow): Promise<LivePageSignals | null> {
  if (!page.source_url) return null;
  const { data, error } = await service
    .from("dt_site_pages")
    .select("title, h1, meta_description")
    .eq("organisation_id", page.organisation_id)
    .eq("url", page.source_url)
    .maybeSingle();
  if (error || !data) return null;
  return data as LivePageSignals;
}

/**
 * Suggests and stores the page's keywords. Keywords of the Seitenstruktur always stay (they go
 * first); keywords entered by hand or suggested before stay unless `force` („Neu vorschlagen“).
 * Never throws for a model problem: the reason comes back as a failure.
 */
export async function suggestContentKeywords(
  service: SupabaseClient,
  page: ContentPageRow,
  userId: string | null,
  options: {
    force?: boolean;
    callTool?: typeof callContentTool;
    models?: string[];
    /** Tests hand these in; the route loads them. */
    context?: ContentPipelineContext;
    outline?: ContentOutlinePage[];
    live?: LivePageSignals | null;
    save?: typeof saveContentPageKeywords;
    markNone?: typeof markContentPageNoKeyword;
  } = {},
): Promise<KeywordsSuggestResult> {
  const origin = contentKeywordOrigin(page);
  // Keywords of the Seitenstruktur always stay; only their roles are open while a list is unsorted.
  // A list is assigned, a single entry is checked for plausibility (on „Prüfen“); entries that are no
  // keywords at all (a column header the Excel left behind) leave nothing usable: then the page gets a suggestion.
  const todo = contentKeywordTodo(page);
  const classify = origin === "struktur" && page.keywords != null && todo !== "suchen" && (todo === "einteilen" || options.force === true);
  if (origin === "struktur" && !classify && todo !== "suchen") return { ok: true, keywords: page.keywords, cost_eur: 0, reason: "", skipped: "vorhanden" };
  if ((origin === "manuell" || origin === "analyse") && !options.force) {
    return { ok: true, keywords: page.keywords, cost_eur: 0, reason: "", skipped: "vorhanden" };
  }
  // A page that gets no text needs no keyword, and one found to have no search goal is not asked again.
  if (!options.force && origin !== "struktur" && (page.page_type ?? effectiveContentPageType({ ...page, page_type: page.page_type ?? null })) === "nicht_bearbeiten") {
    return { ok: true, keywords: page.keywords, cost_eur: 0, reason: "", skipped: "kein_text" };
  }
  if (origin === "ohne" && !options.force) {
    return { ok: true, keywords: null, cost_eur: 0, reason: page.keywords_exempt?.reason ?? "", skipped: "kein_suchziel", no_keyword: true };
  }

  let context: ContentPipelineContext;
  let avatarId: string | null = null;
  try {
    if (options.context) context = options.context;
    else ({ context, avatarId } = await loadContext(service, page, []));
  } catch (error) {
    return { ok: false, status: 409, cost_eur: 0, message: error instanceof Error ? error.message : "Die Seite konnte nicht geladen werden." };
  }
  const [outline, live] = await Promise.all([
    options.outline ?? loadContentPageOutline(service, page.organisation_id),
    options.live !== undefined ? options.live : loadLiveSignals(service, page),
  ]);
  const taken = takenMainKeywords(outline, page.slug);

  let carried = 0;
  let precursor = "";
  if ((classify || (origin === "struktur" && todo === "suchen")) && page.keywords) {
    const all = [page.keywords.main, ...page.keywords.secondary];
    const junk = all.filter((k) => keywordJunkReason(k.text));
    const list = all.filter((k) => !keywordJunkReason(k.text));
    const junkNote = junk.length > 0 ? `Entfernt, weil kein Suchbegriff: ${junk.map((k) => `„${k.text}“`).join(", ")}.` : "";
    precursor = junkNote;
    if (list.length === 0) {
      // Only junk: nothing to assign, the suggestion below replaces it.
    } else {
      let costEur = 0;
      let json: unknown;
      try {
        const models = options.models ?? (await loadContentModelConfig(service)).check;
        const call = await (options.callTool ?? callContentTool)({
          models,
          system: KEYWORDS_CLASSIFY_SYSTEM,
          user: keywordsClassifyPrompt(context, list, live, taken),
          tool: keywordsClassifyTool(list.map((k) => k.text)),
          maxTokens: SUGGEST_MAX_TOKENS,
          timeoutMs: SUGGEST_TIMEOUT_MS,
        });
        json = call.json;
        costEur = roundEur(estimateCostEur(call.model, call.usage));
        await recordLlmUsageEvent(service, {
          organisationId: page.organisation_id,
          userId,
          agentId: avatarId,
          mode: KEYWORDS_USAGE_MODE,
          via: "direct",
          model: call.model,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
        });
      } catch (error) {
        return { ok: false, status: 502, cost_eur: costEur, message: error instanceof Error ? error.message : "Die Einteilung der Keywords ist fehlgeschlagen." };
      }
      const roles = applyKeywordRoles(list, json, taken);
      if (roles && roles.main === "") {
        // The model found every entry unusable: carry its cost into the suggestion that replaces them.
        carried = costEur;
        precursor = [junkNote, roles.removed.length > 0 ? `Entfernt, weil kein passender Suchbegriff: ${roles.removed.map((k) => `„${k}“`).join(", ")}.` : ""].filter(Boolean).join(" ");
      } else {
        await addCost(service, page, costEur);
        if (!roles) {
          return { ok: false, status: 422, cost_eur: costEur, message: "Alle Keywords dieser Seite sind schon Hauptkeyword einer anderen Seite oder einem sehr ähnlich. Bitte in der Seitenstruktur oder von Hand klären." };
        }
        const removedNote = roles.removed.length > 0 ? `Entfernt, weil kein passender Suchbegriff: ${roles.removed.map((k) => `„${k}“`).join(", ")}.` : "";
        const reason = [roles.reason, junkNote, removedNote].filter(Boolean).join(" ");
        const saved = await (options.save ?? saveContentPageKeywords)(service, page, { main: roles.main, secondary: roles.secondary, source: "struktur", reason });
        if (!saved.ok) return { ok: false, status: saved.status, cost_eur: costEur, message: saved.error };
        return { ok: true, keywords: saved.keywords, cost_eur: costEur, reason };
      }
    }
  }

  let costEur = carried;
  let answer: KeywordsAnswer | null = null;
  let rejected: string | null = null;
  try {
    const models = options.models ?? (await loadContentModelConfig(service)).check;
    for (let attempt = 0; attempt < 2; attempt++) {
      const call = await (options.callTool ?? callContentTool)({
        models,
        system: KEYWORDS_SUGGEST_SYSTEM,
        user: keywordsSuggestPrompt(context, live, taken, rejected),
        tool: KEYWORDS_TOOL,
        maxTokens: SUGGEST_MAX_TOKENS,
        timeoutMs: SUGGEST_TIMEOUT_MS,
      });
      costEur = roundEur(costEur + estimateCostEur(call.model, call.usage));
      await recordLlmUsageEvent(service, {
        organisationId: page.organisation_id,
        userId,
        agentId: avatarId,
        mode: KEYWORDS_USAGE_MODE,
        via: "direct",
        model: call.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
      });
      answer = normalizeKeywordsAnswer(call.json);
      if (answer.no_keyword || !mainKeywordTakenBy(outline, page.slug, answer.main, { similar: true })) break;
      rejected = answer.main;
    }
  } catch (error) {
    await addCost(service, page, costEur);
    return { ok: false, status: 502, cost_eur: costEur, message: error instanceof Error ? error.message : "Die Keyword-Analyse ist fehlgeschlagen." };
  }
  if (answer?.no_keyword) {
    // No search goal (Kontakt, Impressum, Datenschutz …): a finding, not a failure. Remembered, so the
    // page is not paid for again with every click; the Keywords-Übersicht shows it with the reason.
    const marked = await (options.markNone ?? markContentPageNoKeyword)(service, page, answer.reason || "Die Seite hat kein Suchziel.");
    await addCost(service, page, costEur);
    if (!marked.ok) return { ok: false, status: marked.status, cost_eur: costEur, message: marked.error };
    return { ok: true, keywords: null, cost_eur: costEur, reason: answer.reason, no_keyword: true };
  }
  if (!answer || !answer.main) {
    await addCost(service, page, costEur);
    return { ok: false, status: 422, cost_eur: costEur, message: "Der Zwilling hat kein verwertbares Keyword geliefert. Bitte erneut versuchen oder von Hand eintragen." };
  }
  const clash = mainKeywordTakenBy(outline, page.slug, answer.main, { similar: true });
  if (clash) {
    await addCost(service, page, costEur);
    return {
      ok: false,
      status: 422,
      cost_eur: costEur,
      message: `„${answer.main}“ ist schon das Hauptkeyword der Seite „${clash.name}“. Bitte von Hand festlegen.`,
    };
  }
  const secondary = answer.secondary;
  const reason = [answer.reason, precursor].filter(Boolean).join(" ");
  const saved = await (options.save ?? saveContentPageKeywords)(service, page, { main: answer.main, secondary, source: "analyse", reason });
  await addCost(service, page, costEur);
  if (!saved.ok) return { ok: false, status: saved.status, cost_eur: costEur, message: saved.error };
  return { ok: true, keywords: saved.keywords, cost_eur: costEur, reason };
}

async function addCost(service: SupabaseClient, page: ContentPageRow, costEur: number): Promise<void> {
  if (costEur <= 0) return;
  const { error } = await service
    .from("dt_content_pages")
    .update({ cost_eur: roundEur(num(page.cost_eur) + costEur) })
    .eq("id", page.id);
  if (error) console.warn("[content] keyword analysis cost not stored:", contentDbErrorMessage(error, "Kosten"));
}

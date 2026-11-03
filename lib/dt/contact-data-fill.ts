/**
 * Kontaktdaten filled automatically: from the organisation's crawled website and, for the
 * Google-Profil only, by one web search. Runs after every finished crawl (job
 * `content.contact`, enqueued by the crawl), on „Aus Website neu füllen“ and on
 * „Google-Profil suchen“ in Texte.
 *
 *   1. The Impressum, Kontakt and Startseite of the crawl (`pickContactPages`) are fetched
 *      live under the same rules as the text tools (`fetchLivePageHtml`): their links give
 *      phone, e-mail, social profiles and Google links; their text (live, else the stored
 *      crawl text) gives address, phone, fax, e-mail, opening hours and owner.
 *   2. Only when core fields (street, PLZ, Ort, phone, e-mail) are still empty: one extraction
 *      call on the cheap model over the Impressum and Kontakt text; a value counts only when
 *      it is on the page. Its cost and usage are recorded.
 *   3. Filled are the empty fields and those the crawl filled before; a person's value stays.
 *   4. No Google link and the field empty and „Kein Google-Profil“ not set: the web search
 *      (`contact-google-search.ts`), automatically once per organisation.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

import {
  missingCoreContactFields,
  needsGoogleProfileSearch,
  type ContactFieldKey,
  type ContactGoogleSearch,
  type OrgContactData,
} from "@/lib/dt/contact-data";
import {
  CONTACT_EXTRACTION_MAX_TOKENS,
  CONTACT_EXTRACTION_MODEL,
  CONTACT_EXTRACTION_TOOL,
  CONTACT_PAGE_LABELS,
  acceptExtractedContactValues,
  contactExtractionPrompt,
  contactValuesFromCrawl,
  extractContactLinks,
  mergeContactLinks,
  pickContactPages,
  type ContactLinks,
} from "@/lib/dt/contact-data-crawl";
import { loadOrgContactData, saveAutomaticContactValues } from "@/lib/dt/contact-data-store";
import {
  GOOGLE_SEARCH_TOOLS,
  acceptGoogleCandidate,
  googleSearchInput,
  googleSearchPrompt,
  googleLinksFromResearch,
  googleSearchQuery,
  parseGoogleSearchAnswer,
} from "@/lib/dt/contact-google-search";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { inspectResearchBlocks } from "@/lib/dt/content/pipeline/aktualitaet";
import { callContentResearch, callContentTool } from "@/lib/dt/content/pipeline/llm";
import { estimateCostEur, estimateWebSearchCostEur, roundEur } from "@/lib/dt/content/pricing";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { fetchLivePageHtml, type FetchLike } from "@/lib/dt/text-tools/crawl-source";

export const CONTACT_JOB_KIND = "content.contact";
/** Usage modes in `dt_llm_usage_events`. */
export const CONTACT_EXTRACTION_USAGE_MODE = "content.contact";
export const GOOGLE_SEARCH_USAGE_MODE = "content.google_profil";
const GOOGLE_SEARCH_TIMEOUT_MS = 90_000;
const MAX_PAGE_TEXT_CHARS = 20_000;

/** Visible text of a live page (scripts, styles and navigation dropped), one line per element. */
export function liveHtmlText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();
  $("br").replaceWith("\n");
  $("p, li, div, h1, h2, h3, h4, h5, h6, td, th, address, section, footer, header").each((_, el) => {
    $(el).append("\n");
  });
  return $("body").text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, MAX_PAGE_TEXT_CHARS);
}

/** A bot check, cookie wall or error page instead of the page itself: its text is no source. */
export function looksLikeBlockedPage(text: string): boolean {
  const t = text.trim();
  if (t.length < 150) return true;
  return t.length < 2_000 && /request is being verified|checking your browser|just a moment|verify you are human|captcha|access denied|enable javascript|zugriff verweigert/i.test(t);
}

export type ContactFillResult =
  | { ok: true; changed: ContactFieldKey[]; pages: string[]; costEur: number; data: OrgContactData }
  | { ok: false; reason: string };

type ToolCaller = typeof callContentTool;

/**
 * „Aus Website neu füllen“ and the fill after a crawl. `userId` is who started it (the crawl's
 * starter for the automatic fill); the changes go into the Firmenprofil's change log under them.
 */
export async function fillContactDataFromWebsite(
  service: SupabaseClient,
  organisationId: string,
  options: { userId: string | null; note?: string; fetchImpl?: FetchLike; callTool?: ToolCaller; now?: Date; retryDelayMs?: number } = { userId: null },
): Promise<ContactFillResult> {
  const { data: rows, error } = await service
    .from("dt_site_pages")
    .select("url, title, h1")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .limit(3_000);
  if (error) return { ok: false, reason: `Crawl konnte nicht gelesen werden: ${error.message}` };
  const crawled = ((rows ?? []) as Array<{ url: string; title: string | null; h1: string | null }>).map((r) => ({ ...r, text_content: null }));
  if (crawled.length === 0) return { ok: false, reason: "Es gibt noch keinen Crawl der Website." };

  const choices = pickContactPages(crawled);
  const { data: texts } = await service
    .from("dt_site_pages")
    .select("url, text_content")
    .eq("organisation_id", organisationId)
    .in("url", choices.map((c) => c.page.url));
  const storedText = new Map(((texts ?? []) as Array<{ url: string; text_content: string | null }>).map((t) => [t.url, t.text_content ?? ""]));

  const linkSets: ContactLinks[] = [];
  const pageTexts: Array<{ label: string; text: string; kind: string }> = [];
  const pages: string[] = [];
  for (const choice of choices) {
    // One more try after a short pause: a slow or busy site (15 s limit) lost the Google link in a test run.
    let fetched = await fetchLivePageHtml(choice.page.url, options.fetchImpl ?? fetch);
    if (!fetched || looksLikeBlockedPage(liveHtmlText(fetched))) {
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 2_000));
      fetched = (await fetchLivePageHtml(choice.page.url, options.fetchImpl ?? fetch)) ?? fetched;
    }
    const liveText = fetched ? liveHtmlText(fetched) : "";
    // A bot check instead of the page: the stored crawl text stands in (without links).
    const html = fetched && !looksLikeBlockedPage(liveText) ? fetched : null;
    const label = CONTACT_PAGE_LABELS[choice.kind];
    if (html) linkSets.push(extractContactLinks(html, choice.page.url));
    const textValue = (html ? liveText : "") || storedText.get(choice.page.url) || "";
    if (textValue) pageTexts.push({ label, text: textValue, kind: choice.kind });
    pages.push(`${label} (${html ? "live" : "Crawl-Text"})`);
  }
  // Impressum and Kontakt first: their phone and address are the company's own.
  const ordered = [...pageTexts].sort((a, b) => (a.kind === "start" ? 1 : 0) - (b.kind === "start" ? 1 : 0));
  const found: Partial<Record<ContactFieldKey, string>> = contactValuesFromCrawl({
    texts: ordered.map((p) => p.text),
    links: mergeContactLinks(linkSets),
  });

  const loaded = await loadOrgContactData(service, organisationId);
  let costEur = 0;
  let model: string | null = null;
  const stillMissing = missingCoreContactFields({ fields: { ...loaded.data.fields, ...Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { value: v, source: "crawl", updated_at: null }])) } });
  const extractionPages = ordered.filter((p) => p.kind !== "start");
  if (stillMissing.length > 0 && extractionPages.length > 0) {
    const prompt = contactExtractionPrompt(extractionPages);
    try {
      const models = await loadContentModelConfig(service);
      const call = await (options.callTool ?? callContentTool)({
        models: [CONTACT_EXTRACTION_MODEL, ...models.check],
        system: prompt.system,
        user: prompt.user,
        tool: CONTACT_EXTRACTION_TOOL,
        maxTokens: CONTACT_EXTRACTION_MAX_TOKENS,
        timeoutMs: 60_000,
      });
      model = call.model;
      costEur = estimateCostEur(call.model, call.usage);
      await recordLlmUsageEvent(service, {
        organisationId,
        userId: options.userId,
        mode: CONTACT_EXTRACTION_USAGE_MODE,
        via: "direct",
        model: call.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
      });
      const accepted = acceptExtractedContactValues(call.json, prompt.user);
      for (const [key, value] of Object.entries(accepted) as Array<[ContactFieldKey, string]>) {
        if (value && !found[key]) found[key] = value;
      }
    } catch (err) {
      // The heuristics stand; a failed extraction must not lose them.
      console.warn("[contact-data] extraction failed:", err instanceof Error ? err.message : err);
    }
  }

  const at = (options.now ?? new Date()).toISOString();
  const saved = await saveAutomaticContactValues(service, {
    organisationId,
    found,
    source: "crawl",
    userId: options.userId,
    note: options.note ?? "Kontaktdaten automatisch aus dem Crawl der Website",
    now: options.now,
    extra: (changed) => ({ crawl_fill: { at, fields: changed, pages, cost_eur: roundEur(costEur), model } }),
  });
  return { ok: true, changed: saved.changed, pages, costEur: roundEur(costEur), data: saved.data };
}

export type GoogleSearchOutcome =
  | { ok: true; search: ContactGoogleSearch; data: OrgContactData }
  | { ok: false; reason: string; skipped: true };

/**
 * The web search for the Google-Profil. `force` (the button) searches again; otherwise it runs
 * only when nothing was searched for the organisation yet. Never when the field is filled or
 * „Kein Google-Profil“ is set.
 */
export async function searchGoogleProfile(
  service: SupabaseClient,
  organisationId: string,
  options: { userId: string | null; force?: boolean; anthropic?: Anthropic; models?: string[]; now?: Date } = { userId: null },
): Promise<GoogleSearchOutcome> {
  const loaded = await loadOrgContactData(service, organisationId);
  if (loaded.data.no_google_profile) return { ok: false, skipped: true, reason: "„Kein Google-Profil“ ist gewählt." };
  if (!needsGoogleProfileSearch(loaded.data)) return { ok: false, skipped: true, reason: "Das Google-Profil ist schon eingetragen." };
  if (!options.force && loaded.data.google_search) {
    return { ok: false, skipped: true, reason: "Für diese Organisation wurde schon einmal gesucht." };
  }
  const input = googleSearchInput(loaded.data);
  if (!input.ok) return { ok: false, skipped: true, reason: input.reason };

  const prompt = googleSearchPrompt(input.input);
  const models = options.models ?? (await loadContentModelConfig(service)).check;
  const at = (options.now ?? new Date()).toISOString();
  let costEur = 0;
  let searches = 0;
  let fetches = 0;
  let model: string | null = null;
  let search: ContactGoogleSearch;
  try {
    const result = await callContentResearch({
      models,
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      timeoutMs: GOOGLE_SEARCH_TIMEOUT_MS,
      tools: GOOGLE_SEARCH_TOOLS,
      purpose: "nach dem Google-Profil",
      anthropic: options.anthropic,
      onCall: async (call) => {
        model = call.model;
        searches += call.web.webSearchRequests;
        fetches += call.web.webFetchRequests;
        costEur += estimateCostEur(call.model, call.usage) + estimateWebSearchCostEur(call.web.webSearchRequests);
        await recordLlmUsageEvent(service, {
          organisationId,
          userId: options.userId,
          mode: GOOGLE_SEARCH_USAGE_MODE,
          via: "direct",
          model: call.model,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
          webSearchRequests: call.web.webSearchRequests,
          webFetchRequests: call.web.webFetchRequests,
        });
      },
    });
    const sources = inspectResearchBlocks(result.blocks).sources.map((s) => s.url);
    const returned = [...sources, ...googleLinksFromResearch(result.blocks, sources)];
    const candidate = parseGoogleSearchAnswer(result.text);
    const verdict = acceptGoogleCandidate(candidate, loaded.data, returned);
    search = {
      at,
      status: verdict.ok ? "found" : candidate ? "rejected" : "not_found",
      url: verdict.ok ? verdict.url : (candidate?.url ?? null),
      reason: verdict.ok ? null : verdict.reason,
      query: googleSearchQuery(input.input),
      searches,
      fetches,
      cost_eur: roundEur(costEur),
      model,
    };
  } catch (err) {
    search = {
      at,
      status: "error",
      url: null,
      reason: err instanceof Error ? err.message.slice(0, 400) : "Die Websuche ist fehlgeschlagen.",
      query: googleSearchQuery(input.input),
      searches,
      fetches,
      cost_eur: roundEur(costEur),
      model,
    };
  }
  const saved = await saveAutomaticContactValues(service, {
    organisationId,
    found: search.status === "found" && search.url ? { google_profil: search.url } : {},
    source: "websuche",
    userId: options.userId,
    note: "Google-Profil per Websuche gefunden – bitte prüfen",
    now: options.now,
    extra: () => ({ google_search: search }),
  });
  return { ok: true, search, data: saved.data };
}

/**
 * The job after a crawl: fill from the website, then the Google search if the crawl found no
 * link (once per organisation). Payload: { organisationId, userId? }.
 */
export async function runContactDataJob(
  service: SupabaseClient,
  payload: { organisationId?: string; userId?: string | null },
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; retryable: boolean }> {
  const organisationId = payload.organisationId;
  if (!organisationId) return { ok: false, error: "Missing organisationId", retryable: false };
  const userId = payload.userId ?? null;
  try {
    const fill = await fillContactDataFromWebsite(service, organisationId, { userId });
    const google = await searchGoogleProfile(service, organisationId, { userId });
    return {
      ok: true,
      result: {
        filled: fill.ok ? fill.changed : [],
        fill_reason: fill.ok ? null : fill.reason,
        google: google.ok ? google.search.status : google.reason,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing migration does not heal by itself; anything else may.
    return { ok: false, error: message, retryable: !/Supabase SQL Editor/.test(message) };
  }
}

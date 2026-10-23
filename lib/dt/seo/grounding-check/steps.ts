/**
 * The four steps of a Grounding check (job `seo.grounding_check`). Each returns the
 * columns to write on the run row, so the job can stop after any step and continue in the
 * next worker tick:
 * crawl → extract → compare → generate (→ draft) or done (up_to_date).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadContentAnbieterSources } from "@/lib/dt/content/load-sources";
import { loadOnboardingPromptText } from "@/lib/dt/onboarding/load-prompt";
import {
  deriveGroundingPageLiveFacts,
  extractGroundingPageHtml,
} from "@/lib/dt/seo/detect-grounding-page-date";
import {
  checkLlmsTxt,
  discoverGroundingPageUrl,
  inspectFooterGroundingLink,
  redirectedToSiteRoot,
} from "@/lib/dt/seo/discover-grounding-page-url";
import { evaluateGroundingPageSchedule } from "@/lib/dt/seo/grounding-page-schedule";
import { collectWebsite } from "@/lib/dt/seo/grounding-check/crawl";
import { decideGroundingCheck } from "@/lib/dt/seo/grounding-check/decision";
import {
  EMPTY_SEMANTIC_VERDICTS,
  buildSemanticRequest,
  computeGroundingDiff,
  diffForNewPage,
  semanticRequestIsEmpty,
} from "@/lib/dt/seo/grounding-check/diff";
import { checkExistingPageStructure, parseExistingGroundingPage } from "@/lib/dt/seo/grounding-check/existing-page";
import {
  berlinDay,
  berlinMonth,
  normaliseSourceUrl,
  normalizeExtractedFactModel,
  parseGroundingFactModel,
} from "@/lib/dt/seo/grounding-check/fact-model";
import { HTML_ACCEPT, TEXT_ACCEPT, safeFetchText } from "@/lib/dt/seo/grounding-check/fetch";
import { hasType, parseJsonLdFromHtml } from "@/lib/dt/seo/grounding-check/jsonld";
import { callGroundingCheckTool } from "@/lib/dt/seo/grounding-check/llm";
import {
  compareSpec,
  extractSpec,
  factChecklist,
  normalizeProse,
  normalizeSemanticVerdicts,
  proseSpec,
} from "@/lib/dt/seo/grounding-check/prompts";
import { renderGroundingHtml, sourceTitlesFor } from "@/lib/dt/seo/grounding-check/render-html";
import { renderGroundingLlmsTxt } from "@/lib/dt/seo/grounding-check/render-llms";
import { refreshDatesInHtml, refreshDatesInLlmsTxt } from "@/lib/dt/seo/grounding-check/review-stamp";
import { evaluateAiCrawlerAccess } from "@/lib/dt/seo/grounding-check/robots";
import {
  EMPTY_HINTS,
  type CrawlSnapshot,
  type CrawledUrlEntry,
  type GroundingHints,
} from "@/lib/dt/seo/grounding-check/types";
import { validateGroundingDraft } from "@/lib/dt/seo/grounding-check/validate";
import { loadWunschkundenKnowledgeForSeo } from "@/lib/dt/seo/wunschkunden-knowledge";
import type { DtGroundingRunRow } from "@/lib/dt/types";

/** Error with a hint for the job runner. Non-retryable errors end the run as failed. */
export class GroundingCheckError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "GroundingCheckError";
    this.retryable = retryable;
  }
}

export type StepContext = {
  service: SupabaseClient;
  run: DtGroundingRunRow;
  /** Epoch ms: the step must be done by then. */
  deadline: number;
  /** Time a model call may take in this step. */
  timeoutMs: number;
  now?: Date;
};

export type StepPatch = Record<string, unknown>;

/** How long each step usually needs; a shorter remainder waits for the next tick. */
export const GROUNDING_CHECK_STEP_MS: Record<"crawl" | "extract" | "compare" | "generate", number> = {
  crawl: 120_000,
  extract: 180_000,
  compare: 100_000,
  generate: 100_000,
};

const MAX_EXISTING_HTML = 1_500_000;
const MAX_LLMS_TXT = 200_000;
const INTERNAL_CHARS = 12_000;

function snapshotOf(run: DtGroundingRunRow): CrawlSnapshot {
  const snapshot = run.crawl_snapshot as CrawlSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.pages)) {
    throw new GroundingCheckError("Die gelesenen Seiten fehlen. Bitte die Prüfung neu starten.", false);
  }
  return snapshot;
}

function hintsOf(run: DtGroundingRunRow): GroundingHints {
  return { ...EMPTY_HINTS, ...((run.hints as Partial<GroundingHints> | null) ?? {}) };
}

function usagePatch(run: DtGroundingRunRow, result: { model: string; inputTokens: number; outputTokens: number; costEur: number }): StepPatch {
  return {
    model: result.model,
    input_tokens: (run.input_tokens ?? 0) + result.inputTokens,
    output_tokens: (run.output_tokens ?? 0) + result.outputTokens,
    cost_eur: Math.round((Number(run.cost_eur ?? 0) + result.costEur) * 10_000) / 10_000,
  };
}

async function fetchExistingPage(url: string): Promise<{ url: string; html: string } | null> {
  const res = await safeFetchText(url, { accept: HTML_ACCEPT, timeoutMs: 15_000, maxBytes: MAX_EXISTING_HTML });
  if (!res?.ok || !/html/i.test(res.contentType)) return null;
  if (redirectedToSiteRoot(url, res.finalUrl)) return null;
  return { url: res.finalUrl, html: res.body };
}

async function loadInternalContext(service: SupabaseClient, organisationId: string): Promise<CrawlSnapshot["internal"]> {
  const [anbieter, onboarding, wunschkunden] = await Promise.all([
    loadContentAnbieterSources(service, organisationId).catch(() => null),
    loadOnboardingPromptText(organisationId).catch(() => ""),
    loadWunschkundenKnowledgeForSeo(service, organisationId).catch(() => ""),
  ]);
  const anbieterText = (anbieter?.sections ?? [])
    .filter((s) => s.current.trim())
    .map((s) => `${s.label}: ${s.current.trim()}`)
    .join("\n\n");
  return {
    anbieter: anbieterText.slice(0, INTERNAL_CHARS),
    onboarding: onboarding.slice(0, INTERNAL_CHARS),
    wunschkunden: wunschkunden.slice(0, INTERNAL_CHARS),
  };
}

// --- 1 crawl -----------------------------------------------------------------------------------

export async function runCrawlStep(ctx: StepContext): Promise<StepPatch> {
  const { service, run } = ctx;
  const organisationId = run.organisation_id;
  const [{ data: config }, { data: organisation }, { data: hub }] = await Promise.all([
    service.from("dt_org_config").select("display_name, website_url, grounding_llms_txt_url").eq("organisation_id", organisationId).maybeSingle(),
    service.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
    service.from("dt_grounding_pages").select("url, last_reviewed, uploaded_at").eq("organisation_id", organisationId).eq("kind", "hub").maybeSingle(),
  ]);
  const websiteUrl = ((config?.website_url as string | null) ?? "").trim();
  if (!websiteUrl) {
    throw new GroundingCheckError("Keine Website-URL in den SEO-Einstellungen. Bitte unter SEO → Einstellungen eintragen.", false);
  }

  // The live grounding page: the hub URL of the tool first, then footer link and usual paths.
  let existing: CrawlSnapshot["existing"] = null;
  const hubUrl = (hub?.url as string | null) ?? null;
  if (hubUrl) {
    const page = await fetchExistingPage(hubUrl);
    if (page) existing = { ...page, source: "hub" };
  }
  if (!existing) {
    const discovered = await discoverGroundingPageUrl(websiteUrl);
    if (discovered.ok) {
      const page = await fetchExistingPage(discovered.url);
      if (page) existing = { ...page, source: discovered.source };
    }
  }

  let existingLlms: CrawlSnapshot["existingLlms"] = null;
  const llms = await checkLlmsTxt(websiteUrl, (config?.grounding_llms_txt_url as string | null) ?? null);
  if (llms.ok) {
    const res = await safeFetchText(llms.url, { accept: TEXT_ACCEPT, timeoutMs: 10_000, maxBytes: MAX_LLMS_TXT });
    if (res?.ok) existingLlms = { url: res.finalUrl, text: res.body };
  }

  let collection;
  try {
    collection = await collectWebsite(service, {
      organisationId,
      websiteUrl,
      excludeUrls: [existing?.url, existingLlms?.url].filter((u): u is string => Boolean(u)),
      deadline: Math.min(ctx.deadline, Date.now() + 110_000),
    });
  } catch (error) {
    throw new GroundingCheckError(error instanceof Error ? error.message : "Die Website konnte nicht gelesen werden.", true);
  }

  const organisationName =
    ((config?.display_name as string | null) ?? "").trim() ||
    ((organisation?.name as string | null) ?? "").trim() ||
    new URL(collection.origin).hostname.replace(/^www\./, "");
  const pageUrl = existing?.url ?? hubUrl ?? `${collection.origin}/grounding/`;
  const live = existing ? deriveGroundingPageLiveFacts(extractGroundingPageHtml(existing.html)) : null;

  const crawledUrls: CrawledUrlEntry[] = [
    ...collection.pages.map((p) => ({ url: p.url, category: p.category, ok: true as const, source: p.source, title: p.title })),
    ...collection.failed.map((f) => ({ url: f.url, category: f.category, ok: false as const, reason: f.reason })),
  ];
  const groundingPath = (() => {
    try {
      return new URL(pageUrl).pathname || "/grounding/";
    } catch {
      return "/grounding/";
    }
  })();
  const hints: GroundingHints = {
    ...EMPTY_HINTS,
    footerLink: existing ? inspectFooterGroundingLink(collection.homeHtml, collection.homeUrl, existing.url) : null,
    robots: { found: collection.robotsTxt !== null, crawlers: evaluateAiCrawlerAccess(collection.robotsTxt, groundingPath) },
    llmsTxt: { found: Boolean(existingLlms), url: existingLlms?.url ?? null },
    crawl: {
      pages: collection.pages.length,
      cached: collection.pages.filter((p) => p.source === "cache").length,
      live: collection.pages.filter((p) => p.source === "live").length,
      failed: collection.failed.length,
      sitemapUsed: collection.sitemapUsed,
    },
  };

  const snapshot: CrawlSnapshot = {
    organisationName,
    websiteUrl,
    pageUrl,
    origin: collection.origin,
    homeUrl: collection.homeUrl,
    pages: collection.pages.map((p) => ({ url: p.url, category: p.category, title: p.title, text: p.text, jsonLd: p.jsonLd })),
    existing,
    existingLlms,
    schedule: {
      lastReviewed: (hub?.last_reviewed as string | null) ?? live?.lastReviewed ?? null,
      uploadedAt: (hub?.uploaded_at as string | null) ?? null,
    },
    internal: await loadInternalContext(service, organisationId),
  };

  const existingModel =
    existing || existingLlms
      ? parseExistingGroundingPage({
          pageUrl,
          html: existing?.html ?? null,
          llmsUrl: existingLlms?.url ?? null,
          llmsTxt: existingLlms?.text ?? null,
          organisationName,
          websiteUrl,
        })
      : null;

  return {
    step: "extract",
    grounding_url_checked: existing?.url ?? null,
    llms_txt_url_checked: existingLlms?.url ?? null,
    crawled_urls: crawledUrls,
    crawl_snapshot: snapshot,
    existing_fact_model: existingModel,
    hints,
  };
}

// --- 2 extract ---------------------------------------------------------------------------------

export async function runExtractStep(ctx: StepContext): Promise<StepPatch> {
  const { service, run } = ctx;
  const snapshot = snapshotOf(run);
  const now = ctx.now ?? new Date();
  const result = await callGroundingCheckTool(service, {
    organisationId: run.organisation_id,
    userId: run.created_by,
    step: "extract",
    timeoutMs: ctx.timeoutMs,
    spec: extractSpec({
      organisationName: snapshot.organisationName,
      websiteUrl: snapshot.websiteUrl,
      today: berlinDay(now),
      pages: snapshot.pages,
      internal: snapshot.internal,
      existingFacts: factChecklist(parseGroundingFactModel(run.existing_fact_model)),
    }),
  });

  const pageTexts = new Map(snapshot.pages.map((p) => [normaliseSourceUrl(p.url), `${p.text}\n${p.jsonLd.join("\n")}`]));
  const model = normalizeExtractedFactModel(result.json, {
    organisationName: snapshot.organisationName,
    websiteUrl: snapshot.websiteUrl,
    pageUrl: snapshot.pageUrl,
    month: berlinMonth(now),
    pageTexts,
  });
  const org = model.entities[0]!;
  if (org.facts.length === 0 && !org.definition) {
    throw new GroundingCheckError("Die KI hat keine belegbaren Fakten zur Organisation geliefert.", true);
  }
  return {
    ...usagePatch(run, result),
    step: "compare",
    fact_model: model,
    open_points: model.openPoints,
    error: null,
  };
}

// --- 3 compare ---------------------------------------------------------------------------------

export async function runCompareStep(ctx: StepContext): Promise<StepPatch> {
  const { service, run } = ctx;
  const snapshot = snapshotOf(run);
  const now = ctx.now ?? new Date();
  const model = parseGroundingFactModel(run.fact_model);
  if (!model) throw new GroundingCheckError("Das Faktenmodell fehlt. Bitte die Prüfung neu starten.", false);
  const hints = hintsOf(run);
  let usage: StepPatch = {};

  if (!snapshot.existing) {
    const decision = decideGroundingCheck({ pageExists: false, diff: null, scheduleStatus: "missing" });
    return { step: "generate", decision: decision.decision, diff: diffForNewPage(model), hints: { ...hints, decisionReasons: decision.reasons } };
  }

  const existing = parseGroundingFactModel(run.existing_fact_model) ?? { ...model, entities: [], faq: [], openPoints: [] };
  const structural = checkExistingPageStructure(snapshot.existing.html, { pageUrl: snapshot.pageUrl, websiteUrl: snapshot.websiteUrl });
  const request = buildSemanticRequest(model, existing);
  let verdicts = EMPTY_SEMANTIC_VERDICTS;
  if (!semanticRequestIsEmpty(request)) {
    const result = await callGroundingCheckTool(service, {
      organisationId: run.organisation_id,
      userId: run.created_by,
      step: "compare",
      timeoutMs: ctx.timeoutMs,
      spec: compareSpec(request),
    });
    verdicts = normalizeSemanticVerdicts(result.json, request);
    usage = usagePatch(run, result);
  }
  const diff = computeGroundingDiff(model, existing, verdicts, structural);
  const schedule = evaluateGroundingPageSchedule({ ...snapshot.schedule, now });
  const decision = decideGroundingCheck({ pageExists: true, diff, scheduleStatus: schedule.status });
  const nextHints = { ...hints, decisionReasons: decision.reasons };

  if (decision.decision === "up_to_date") {
    return { ...usage, step: "done", status: "up_to_date", decision: decision.decision, diff, hints: nextHints, finished_at: now.toISOString(), error: null };
  }
  return { ...usage, step: "generate", decision: decision.decision, diff, hints: nextHints, error: null };
}

// --- 4 generate --------------------------------------------------------------------------------

function existingDatePublished(html: string): string | null {
  const page = parseJsonLdFromHtml(html).nodes.find((n) => hasType(n, ["WebPage"]));
  const value = typeof page?.datePublished === "string" ? page.datePublished.slice(0, 10) : null;
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function runGenerateStep(ctx: StepContext): Promise<StepPatch> {
  const { service, run } = ctx;
  const snapshot = snapshotOf(run);
  const now = ctx.now ?? new Date();
  const day = berlinDay(now);
  const month = berlinMonth(now);
  let model = parseGroundingFactModel(run.fact_model);
  if (!model) throw new GroundingCheckError("Das Faktenmodell fehlt. Bitte die Prüfung neu starten.", false);
  const hints = hintsOf(run);
  const llmsUrl = snapshot.existingLlms?.url ?? `${snapshot.origin}/llms.txt`;
  const crawled = Array.isArray(run.crawled_urls) ? (run.crawled_urls as CrawledUrlEntry[]) : [];

  if (run.decision === "refresh_only" && snapshot.existing) {
    const html = refreshDatesInHtml(snapshot.existing.html, { day, month });
    const llms = snapshot.existingLlms
      ? refreshDatesInLlmsTxt(snapshot.existingLlms.text, { day, month })
      : { text: renderGroundingLlmsTxt({ model, llmsUrl, createdDay: day, modifiedDay: day, month }), changes: ["llms.txt neu erstellt (es gab keine)"] };
    return {
      step: "done",
      status: "draft",
      draft_html: html.text,
      draft_llms_txt: llms.text,
      validation: validateGroundingDraft({ html: html.text, llmsTxt: llms.text, model, reviewed: false, generated: false, now }),
      hints: { ...hints, refreshChanges: [...html.changes, ...llms.changes], render: null },
      finished_at: now.toISOString(),
      error: null,
    };
  }

  const result = await callGroundingCheckTool(service, {
    organisationId: run.organisation_id,
    userId: run.created_by,
    step: "generate",
    timeoutMs: ctx.timeoutMs,
    spec: proseSpec(model),
  });
  model = { ...model, prose: normalizeProse(result.json, model) };
  const createdDay = (snapshot.existing && existingDatePublished(snapshot.existing.html)) || day;
  const render = { createdDay, modifiedDay: day, llmsUrl };
  const html = renderGroundingHtml({ model, createdDay, modifiedDay: day, sourceTitles: sourceTitlesFor(model, crawled) });
  const llmsTxt = renderGroundingLlmsTxt({ model, llmsUrl, createdDay, modifiedDay: day, month });
  return {
    ...usagePatch(run, result),
    step: "done",
    status: "draft",
    fact_model: model,
    draft_html: html,
    draft_llms_txt: llmsTxt,
    validation: validateGroundingDraft({ html, llmsTxt, model, reviewed: false, generated: true, now }),
    hints: { ...hints, render },
    finished_at: now.toISOString(),
    error: null,
  };
}

export const GROUNDING_CHECK_STEPS = {
  crawl: runCrawlStep,
  extract: runExtractStep,
  compare: runCompareStep,
  generate: runGenerateStep,
} as const;

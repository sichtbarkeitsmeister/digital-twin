/**
 * What a step's normalised output means for the page row. Pure, so the halting rules are
 * testable without Supabase: every text step replaces the HTML and the Endabnahme stops for
 * the release.
 *
 * Questions for the customer are collected, not asked, while the page runs (decided here in
 * code, not by the model): after the Faktencheck, after every step that writes text (SEO,
 * GEO, Aktualitätsprüfung, Hormozi, Vermenschlichung, Lektorat) the saved text is scanned for
 * placeholders (`gaps.ts`), and those with the questions of the Faktencheck or the
 * Aktualitätsprüfung go through `planContentQuestions` (`questions.ts`): known ones are
 * dropped, company questions go into the organisation's pool (`firmaQuestions`), at most three
 * stay on the page (`questions`), the rest become open points. No step 2–8 stops for them; the
 * page stops once, before the Watermark Entfernung (`question-stop.ts`). The only early stop is
 * a „grundlegend“ question of the Faktencheck. The Endabnahme lists what is left as open points.
 *
 * The Aktualitätsprüfung may also send the text back to GEO, once per run (`planFreshness`):
 * the step then asks the runner to reset GEO and itself (`resetFrom`) and the job goes on.
 * Not when the editor switched GEO off for the page: GEO would only be skipped again, so the
 * outdated Abschnitte become open points at once, and the Faktencheck's findings (which GEO
 * would have worked in) stay on the page.
 *
 * A step the editor switched off gets its patch from `skippedStepPatch`: no model output, the
 * row „skipped“ at 0 €, the text unchanged except where the next steps need it (SEO takes the
 * live text, Hormozi removes the empty hero section).
 */

import {
  freshnessSectionFindings,
  mergeFreshnessUpdates,
  readContentFreshness,
} from "@/lib/dt/content/freshness";
import type { AktualitaetOutput } from "@/lib/dt/content/pipeline/aktualitaet";
import { contentGapQuestions, findContentGaps } from "@/lib/dt/content/pipeline/gaps";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import {
  ensureHeroPlaceholder,
  isEmptyHeroPlaceholder,
  type AnalyseOutput,
  type EndabnahmeOutput,
  type FaktencheckOutput,
  type LektoratOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import {
  isTextPlaceholder,
  loose,
  overflowFindings,
  planContentQuestions,
  questionPlanRecord,
  sourceFindings,
  wishConflictFindings,
  type ContentKnowledge,
  type ContentQuestionPlan,
} from "@/lib/dt/content/pipeline/questions";
import { roundEur } from "@/lib/dt/content/pricing";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  type ContentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { phoneDigits } from "@/lib/dt/contact-data";
import { htmlToMarkdown, parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentPageRow, ContentStepRow } from "@/lib/dt/content/store";
import type { IngestedText } from "@/lib/dt/text-tools/ingest";
import type { ContentFinding, ContentFreshness, ContentQuestion } from "@/lib/dt/content/types";

export type StepPatch = {
  /** Columns of `dt_content_pages` to update (without the cost, which the caller adds). */
  pagePatch: Record<string, unknown>;
  /** Company questions of this step for the organisation's pool (`dt_content_org_questions`). */
  firmaQuestions?: ContentQuestion[];
  /** What the step row records of the question plan (asked, company, unasked, suppressed). */
  questionPlan?: Record<string, unknown>;
  stepStatus: ContentStepRow["status"];
  /** The job stops after this step (questions for the customer, the release). */
  halted: boolean;
  /**
   * After saving, set the steps from this one on back to pending and go on (the
   * Aktualitätsprüfung's send-back to GEO). Absent for every other outcome.
   */
  resetFrom?: number;
};

/** The text steps after which the page is checked for gaps (Watermark Entfernung is not; the Endabnahme right after it is). */
export const GAP_CHECKED_TEXT_STEPS: ReadonlySet<number> = new Set([
  CONTENT_STEP_SEO,
  CONTENT_STEP_GEO,
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_LEKTORAT,
]);

/**
 * „[BITTE PRÜFEN: Datum der Veröffentlichung]“ (some saved prompts ask for it) is the date the web
 * team sets on publishing: the wanted marker [DATUM], not a question for the customer.
 */
const PUBLICATION_DATE_PLACEHOLDER_RE =
  /\[\s*BITTE\s+PR(?:Ü|UE)FEN\s*:\s*(?:(?:Datum|Stand)\s+der\s+Ver(?:ö|oe)ffentlichung|Ver(?:ö|oe)ffentlichungsdatum|Datum|Stand|Datum\s+der\s+letzten\s+Aktualisierung)\s*\]/giu;

export function withDateMarker(blocks: readonly ContentTextBlock[]): ContentTextBlock[] {
  return blocks.map((b) => {
    const html = b.html.replace(PUBLICATION_DATE_PLACEHOLDER_RE, "[DATUM]");
    const heading = b.heading?.replace(PUBLICATION_DATE_PLACEHOLDER_RE, "[DATUM]") ?? null;
    return html === b.html && heading === (b.heading ?? null) ? b : { ...b, html, heading };
  });
}

const PHONE_IN_TEXT_RE = /(?:\+\s?49|\b0)[\d\s/().\u2011-]{5,}\d/g;

/**
 * Phone numbers of the Kontaktdaten (bestätigt) in exactly their spelling: a number in the text
 * with the same digits but another grouping („0511 / 554 785 85“) gets the confirmed spelling.
 * Only text, never an attribute (a tel: link keeps its form).
 */
export function withContactSpelling(blocks: readonly ContentTextBlock[], knowledge?: ContentKnowledge): ContentTextBlock[] {
  const confirmed = (["telefon", "mobil"] as const)
    .map((key) => knowledge?.values[key])
    .filter((v): v is { value: string; source: "kontaktdaten" } => v?.source === "kontaktdaten" && Boolean(v.value.trim()))
    .map((v) => ({ spelling: v.value.trim(), digits: phoneDigits(v.value) }))
    .filter((v) => v.digits.length >= 6);
  if (confirmed.length === 0) return [...blocks];
  const fix = (text: string) =>
    text.replace(PHONE_IN_TEXT_RE, (match) => {
      const trimmed = match.replace(/[\s/(.-]+$/, "");
      const hit = confirmed.find((c) => c.digits === phoneDigits(trimmed));
      return hit && trimmed !== hit.spelling ? hit.spelling + match.slice(trimmed.length) : match;
    });
  const fixHtml = (html: string) =>
    html
      .split(/(<[^>]*>)/)
      .map((part) => (part.startsWith("<") ? part : fix(part)))
      .join("");
  return blocks.map((b) => {
    const html = fixHtml(b.html);
    const heading = b.heading == null ? b.heading : fix(b.heading);
    return html === b.html && heading === b.heading ? b : { ...b, html, heading };
  });
}

export function textPatch(out: TextOutput, knowledge?: ContentKnowledge): Record<string, unknown> {
  const html = renderBlocksHtml(withContactSpelling(withDateMarker(out.blocks), knowledge));
  return { html, markdown: htmlToMarkdown(html), title: out.title, meta_description: out.meta_description };
}

/** The text exactly as it is saved, read back into blocks (what the drawer shows and highlights). */
export function savedBlocks(pagePatch: Record<string, unknown>): ContentTextBlock[] {
  return parseBlocksFromHtml(typeof pagePatch.html === "string" ? pagePatch.html : "");
}

/**
 * The questions after a step: the page's own (at most three, an empty list clears old ones)
 * go on the page, company questions are handed back for the pool, questions over the limit
 * become open points. Nothing stops here; the caller stops only for a „grundlegend“ question.
 */
export function collectQuestions(
  pagePatch: Record<string, unknown>,
  blocks: readonly ContentTextBlock[],
  input: { step: number; modelQuestions?: readonly ContentQuestion[]; current?: Pick<StepPatchCurrent, "questions" | "knowledge"> },
): ContentQuestionPlan {
  const plan = planContentQuestions({
    candidates: contentGapQuestions(blocks, input.modelQuestions ?? []),
    existing: input.current?.questions ?? [],
    knowledge: input.current?.knowledge,
    blocks,
    step: input.step,
  });
  pagePatch.questions = plan.page;
  return plan;
}

/** Open points for the questions over the limit and for wish conflicts, added once to the page's open points. */
function withOverflow(findings: readonly ContentFinding[], plan: ContentQuestionPlan): ContentFinding[] {
  const seen = new Set(findings.map(findingKey));
  return [
    ...findings,
    ...[...overflowFindings(plan.overflow), ...wishConflictFindings(plan.wishConflicts), ...sourceFindings(plan.sources)].filter((f) => !seen.has(findingKey(f))),
  ];
}

/** Every placeholder still in the text at the Endabnahme, as an open point (unless the model named it). */
export function placeholderFindings(blocks: readonly ContentTextBlock[], listed: readonly ContentFinding[]): ContentFinding[] {
  const said = listed.map((f) => loose(`${f.title} ${f.problem} ${f.proposal}`));
  return findContentGaps(blocks)
    .filter((gap) => !said.some((text) => text.includes(loose(gap.placeholder))))
    .map((gap) => ({
      title: "Platzhalter offen",
      problem: `Abschnitt „${gap.section}“: ${gap.placeholder} – „${gap.excerpt}“`,
      proposal: "Angabe ergänzen (Abschnitt ändern) oder den Satz streichen.",
      severity: "high",
      severity_label: "Wichtig",
      block_id: gap.block_id,
    }));
}

export type FreshnessPlan = {
  freshness: ContentFreshness;
  /** The page's open points after this check (rejected changes, outdated Abschnitte after the send-back). */
  findings: ContentFinding[];
  /** Asked now; empty while the text goes back to GEO (they wait in `carried_questions`). */
  questions: ContentQuestion[];
  /** The text goes back to GEO, the first time an Abschnitt is outdated. */
  sendBack: boolean;
};

/**
 * What one Aktualitätsprüfung means for `dt_content_pages.freshness`:
 *   - its valid updates are added to the list (with the time of the check);
 *   - outdated Abschnitte go back to GEO the first time (`sendbacks` 0 → 1, `pending_sections`
 *     for GEO's prompt); questions found meanwhile wait for the second check, because GEO
 *     rewrites the text in between;
 *   - the second time they become open points with proposal and source, and the page goes on.
 */
export function planFreshness(
  stored: ContentFreshness,
  out: Pick<AktualitaetOutput, "updates" | "questions" | "outdated_sections" | "findings" | "blocks">,
  at: string,
  options: { geoSkipped?: boolean } = {},
): FreshnessPlan {
  const updates = mergeFreshnessUpdates(stored.updates, out.updates.map((u) => ({ ...u, at })));
  // GEO switched off for this page: a send-back would reset GEO, GEO would be skipped again and
  // a second paid check would find the same Abschnitte. They become open points right away.
  if (out.outdated_sections.length > 0 && stored.sendbacks === 0 && !options.geoSkipped) {
    return {
      freshness: {
        ...stored,
        sendbacks: 1,
        updates,
        pending_sections: out.outdated_sections,
        sent_back_sections: out.outdated_sections,
        converted_sections: [],
        carried_questions: out.questions,
      },
      findings: out.findings,
      questions: [],
      sendBack: true,
    };
  }
  // The questions of the first check, where their Abschnitt still exists after GEO.
  const ids = new Set(out.blocks.map((b) => b.id));
  const carried = stored.carried_questions.map((q) => (q.block_id && !ids.has(q.block_id) ? { ...q, block_id: null } : q));
  const asked = new Set(out.questions.map((q) => `${q.block_id ?? ""}|${loose(q.excerpt || q.question)}`));
  const questions = [
    ...out.questions,
    ...carried.filter((q) => !asked.has(`${q.block_id ?? ""}|${loose(q.excerpt || q.question)}`)),
  ];
  return {
    freshness: {
      ...stored,
      updates,
      pending_sections: [],
      converted_sections: out.outdated_sections,
      carried_questions: [],
    },
    findings: [...out.findings, ...freshnessSectionFindings(out.outdated_sections)],
    questions,
    sendBack: false,
  };
}

function findingKey(f: Pick<ContentFinding, "title" | "block_id" | "problem">): string {
  return `${f.title}|${f.block_id ?? ""}|${f.problem}`;
}

/** The page as a step's patch sees it before the step. */
export type StepPatchCurrent = {
  html: string;
  freshness?: unknown;
  /** The open points on the page (`findings`). */
  findings?: readonly ContentFinding[];
  /** Steps the editor switched off for this page. */
  skip_steps?: readonly string[];
  /** The Faktencheck's findings as its row holds them (the Aktualitätsprüfung keeps them while GEO is off). */
  faktencheck_findings?: readonly ContentFinding[];
  /** The page's collected questions before this step. */
  questions?: readonly ContentQuestion[];
  /** What is known already: Kontaktdaten, the pool, notes, Anbieterfakten (`buildContentKnowledge`). */
  knowledge?: ContentKnowledge;
};

/**
 * `current.html` is the page text before this step: what the Faktencheck checked and what
 * the Endabnahme releases (neither writes text). Text steps are checked on their own output.
 * `current.freshness` is the stored state of the Aktualitätsprüfung (GEO and the check read it).
 */
export function stepPatchFor(
  def: ContentStepDefinition,
  output: unknown,
  current: StepPatchCurrent = { html: "" },
  now: Date = new Date(),
): StepPatch {
  const pagePatch: Record<string, unknown> = {};
  let stepStatus: ContentStepRow["status"] = "done";
  let halted = false;
  let resetFrom: number | undefined;
  let plan: ContentQuestionPlan | null = null;
  const stop = () => {
    stepStatus = "waiting";
    halted = true;
  };

  switch (def.step) {
    case CONTENT_STEP_ANALYSE: {
      const out = output as AnalyseOutput;
      if (out.main_keyword) pagePatch.main_keyword = out.main_keyword;
      break;
    }
    case CONTENT_STEP_FAKTENCHECK: {
      const out = output as FaktencheckOutput;
      plan = collectQuestions(pagePatch, parseBlocksFromHtml(current.html), { step: def.step, modelQuestions: out.questions, current });
      pagePatch.findings = withOverflow(out.findings, plan);
      // The only early stop: the page's main topic itself is in doubt.
      if (plan.grundlegend) {
        pagePatch.state = "braucht_sie";
        pagePatch.job_id = null;
        stop();
      }
      break;
    }
    case CONTENT_STEP_AKTUALITAET: {
      const out = output as AktualitaetOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Die Aktualitätsprüfung lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out, current.knowledge));
      const geoSkipped = current.skip_steps?.includes("geo") ?? false;
      const freshness = planFreshness(readContentFreshness(current.freshness), out, now.toISOString(), { geoSkipped });
      pagePatch.freshness = freshness.freshness;
      // Normally GEO has worked the Faktencheck's findings in and cleared them. With GEO off they
      // are still open: the ones still on the page (not edited away) stay in front of this check's.
      const faktencheck = new Set((current.faktencheck_findings ?? []).map(findingKey));
      const kept = geoSkipped ? (current.findings ?? []).filter((f) => faktencheck.has(findingKey(f))) : [];
      pagePatch.findings = [...kept, ...freshness.findings];
      if (freshness.sendBack) {
        // GEO reworks the outdated Abschnitte, then this step checks again; nobody is asked yet.
        resetFrom = CONTENT_STEP_GEO;
        break;
      }
      // Its questions (each with a source) join the page's one stop instead of stopping now.
      plan = collectQuestions(pagePatch, savedBlocks(pagePatch), { step: def.step, modelQuestions: freshness.questions, current });
      pagePatch.findings = withOverflow(pagePatch.findings as ContentFinding[], plan);
      break;
    }
    case CONTENT_STEP_LEKTORAT: {
      const out = output as LektoratOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Das Lektorat lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out, current.knowledge));
      pagePatch.final_findings = out.final_findings;
      plan = collectQuestions(pagePatch, savedBlocks(pagePatch), { step: def.step, current });
      if (plan.overflow.length > 0 || plan.wishConflicts.length > 0 || plan.sources.length > 0) pagePatch.findings = withOverflow(current.findings ?? [], plan);
      break;
    }
    case CONTENT_STEP_ENDABNAHME: {
      const out = output as EndabnahmeOutput;
      // The page asked once, before the Watermark Entfernung. What is still open now (a
      // placeholder left, a question not answered) is listed for the release, not asked again.
      const left = placeholderFindings(parseBlocksFromHtml(current.html), out.unresolved);
      const unanswered = overflowFindings((current.questions ?? []).filter((q) => !isTextPlaceholder(q.placeholder)));
      pagePatch.unresolved = [...out.unresolved, ...left, ...unanswered];
      pagePatch.questions = [];
      pagePatch.released = false;
      pagePatch.job_id = null;
      pagePatch.state = "fertig";
      stop();
      break;
    }
    default: {
      if (def.writesText) {
        const out = output as TextOutput;
        if (out.blocks.length === 0) throw new ContentLlmError("Die KI hat keinen Text geliefert.", true);
        Object.assign(pagePatch, textPatch(out, current.knowledge));
        if (def.step === CONTENT_STEP_GEO) {
          // GEO works the Faktencheck's findings in; they are settled then. The open points the
          // Aktualitätsprüfung leaves after it stay on the page until the Endabnahme.
          pagePatch.findings = [];
          // After a send-back GEO has reworked the outdated Abschnitte: the block is done.
          const freshness = readContentFreshness(current.freshness);
          if (freshness.pending_sections.length > 0) pagePatch.freshness = { ...freshness, pending_sections: [] };
        }
        if (GAP_CHECKED_TEXT_STEPS.has(def.step)) {
          plan = collectQuestions(pagePatch, savedBlocks(pagePatch), { step: def.step, current });
          if (plan.overflow.length > 0 || plan.wishConflicts.length > 0 || plan.sources.length > 0) {
            const base = def.step === CONTENT_STEP_GEO ? [] : (current.findings ?? []);
            pagePatch.findings = withOverflow(base, plan);
          }
        }
      }
    }
  }
  const result: StepPatch = { pagePatch, stepStatus, halted };
  if (resetFrom != null) result.resetFrom = resetFrom;
  if (plan) {
    if (plan.firma.length > 0) result.firmaQuestions = plan.firma;
    result.questionPlan = questionPlanRecord(plan);
  }
  return result;
}

// --- a step the editor switched off ----------------------------------------------------------

/** What a skipped step's row holds instead of a model output. */
export type SkippedStepOutput = {
  skipped_by: "user";
  /** SEO on a crawl page: the live text became the starting text. */
  live_text?: true;
  source?: "live" | "crawl";
  url?: string;
  /** Hormozi: the empty hero section was taken out of the text. */
  hero_removed?: true;
};

/** The live page as `loadCrawledPageInput` imported it (SEO switched off on a crawl page). */
export type LiveTextImport = { source: "live" | "crawl"; url: string; ingested: Pick<IngestedText, "blocks" | "title" | "metaDescription"> };

export const LIVE_TEXT_FAILURE_PREFIX = "Live-Text konnte nicht übernommen werden";

/** The German error of a failed live-text import; the page pauses with it. */
export function liveTextFailureMessage(reason: string): string {
  const detail = reason.trim().replace(/\.?$/, ".");
  return `${LIVE_TEXT_FAILURE_PREFIX}: ${detail} Bitte SEO wieder einschalten oder erneut crawlen.`;
}

export type SkippedStepPatch = {
  /** The step row: „skipped“, no model, no tokens, 0 €. */
  stepRow: Partial<ContentStepRow> & { output: SkippedStepOutput };
  /** Columns of `dt_content_pages`, including `step`. */
  pagePatch: Record<string, unknown>;
  /** Always false since the one stop before the Watermark Entfernung; kept for the runner's outcome. */
  halted: boolean;
};

/**
 * The patch for a step the run reached while the editor has it switched off. Every step: the
 * row becomes „skipped“ (no model, no tokens, 0 €), the page moves on to it, the text stays.
 * `paidBefore` is what an earlier, unfinished attempt of the step already cost (Watermark
 * chunks, the Aktualitätsprüfung's research): its progress is dropped, its cost goes to the
 * page total instead of vanishing with the row.
 *
 *   - SEO: `live` becomes the page text, with the empty hero section after the H1 unless
 *     Hormozi is off too, title and meta description when the import has them; then the
 *     placeholder check like after every text step. No usable text is an error, never an
 *     empty page.
 *   - Hormozi: an empty hero section (current or legacy placeholder) is removed: nobody fills
 *     it, and the Endabnahme would flag it. A hero with content stays.
 */
export function skippedStepPatch(
  def: ContentStepDefinition,
  page: Pick<ContentPageRow, "html" | "title" | "meta_description" | "skip_steps" | "cost_eur"> & Partial<Pick<ContentPageRow, "questions">>,
  options: { live?: LiveTextImport | null; paidBefore?: number; now?: Date; knowledge?: ContentKnowledge } = {},
): SkippedStepPatch {
  const at = (options.now ?? new Date()).toISOString();
  const output: SkippedStepOutput = { skipped_by: "user" };
  const pagePatch: Record<string, unknown> = { step: def.step, error: null };
  // A skip never stops the page: placeholders of the live text wait for the stop before the Watermark Entfernung.
  const halted = false;

  if (def.key === "seo") {
    const live = options.live;
    if (!live) throw new ContentLlmError(liveTextFailureMessage("Die Seite hat keine Live-URL aus dem Crawl"), false);
    const blocks = page.skip_steps.includes("hormozi") ? [...live.ingested.blocks] : ensureHeroPlaceholder(live.ingested.blocks);
    if (blocks.length === 0) throw new ContentLlmError(liveTextFailureMessage("Die Seite enthält keinen Text"), false);
    Object.assign(
      pagePatch,
      textPatch({ blocks, title: live.ingested.title || page.title, meta_description: live.ingested.metaDescription || page.meta_description }),
    );
    // The live text's placeholders are collected like after any text step; nothing stops here.
    collectQuestions(pagePatch, savedBlocks(pagePatch), { step: def.step, current: { questions: page.questions, knowledge: options.knowledge } });
    Object.assign(output, { live_text: true, source: live.source, url: live.url });
  } else if (def.key === "hormozi") {
    const blocks = parseBlocksFromHtml(page.html);
    const kept = blocks.filter((b) => !isEmptyHeroPlaceholder(b));
    if (kept.length < blocks.length) {
      const html = renderBlocksHtml(kept);
      Object.assign(pagePatch, { html, markdown: htmlToMarkdown(html) });
      output.hero_removed = true;
    }
  }

  const paidBefore = options.paidBefore ?? 0;
  if (paidBefore > 0) {
    const before = Number(page.cost_eur);
    pagePatch.cost_eur = roundEur((Number.isFinite(before) ? before : 0) + paidBefore);
  }

  return {
    stepRow: {
      status: "skipped",
      output,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost_eur: 0,
      error: null,
      started_at: at,
      finished_at: at,
      approved_by: null,
      approved_at: null,
    },
    pagePatch,
    halted,
  };
}

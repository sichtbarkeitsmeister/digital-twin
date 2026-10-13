/**
 * Executes one Grounding step for a page: loads the context, calls the model, stores the
 * result on `dt_grounding_steps` and `dt_grounding_pages`. Called by the `grounding.page` job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { loadGroundingRunContext } from "@/lib/dt/seo/grounding-run/context";
import { loadGroundingPagesRules } from "@/lib/dt/prompts/grounding-pages-rules";
import { groundingStepSpec } from "@/lib/dt/seo/grounding-run/prompts";
import { groundingStepPatchFor } from "@/lib/dt/seo/grounding-run/step-patch";
import { groundingRunDbErrorMessage, num } from "@/lib/dt/seo/grounding-run/store";
import { groundingStepDefinition } from "@/lib/dt/seo/grounding-run/steps";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import type { DtGroundingPageRow, DtGroundingStepRow } from "@/lib/dt/types";

export type GroundingStepOutcome = {
  step: number;
  /** The run stops here (questions for the customer, finished, stopped meanwhile). */
  halted: boolean;
  discarded?: boolean;
  model: string;
  costEur: number;
};

const DEFAULT_STEP_TIMEOUT_MS = 240_000;

/** Own key first, then the Texte key, then the general chat key. */
export function resolveGroundingApiKey(env: Record<string, string | undefined> = process.env): string | null {
  for (const name of ["ANTHROPIC_DT_GROUNDING_API_KEY", "ANTHROPIC_DT_CONTENT_API_KEY", "ANTHROPIC_API_KEY"]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

async function upsertStep(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  step: number,
  patch: Partial<DtGroundingStepRow>,
): Promise<void> {
  const def = groundingStepDefinition(step);
  const { error } = await service.from("dt_grounding_steps").upsert(
    { page_id: page.id, organisation_id: page.organisation_id, step, name: def?.name ?? `Schritt ${step}`, ...patch },
    { onConflict: "page_id,step" },
  );
  if (error) throw new Error(groundingRunDbErrorMessage(error, "Schritt konnte nicht gespeichert werden"));
}

export async function runGroundingStep(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  steps: DtGroundingStepRow[],
  step: number,
  timeoutMs?: number,
): Promise<GroundingStepOutcome> {
  const def = groundingStepDefinition(step);
  if (!def) throw new ContentLlmError(`Unbekannter Schritt ${step}.`, false);

  await upsertStep(service, page, step, { status: "running", error: null, started_at: new Date().toISOString(), finished_at: null });
  await service.from("dt_grounding_pages").update({ run_step: step, run_error: null }).eq("id", page.id);

  const context = await loadGroundingRunContext(service, page, steps);
  if (context.anbieterSections.length === 0 && context.sitePages.length === 0 && !context.livePageText && !context.onboardingText) {
    throw new ContentLlmError(
      "Keine Faktenquellen vorhanden: weder Anbieterfakten (Fragebogen/Gespräche) noch gecrawlte Website-Seiten noch Onboarding. Bitte zuerst die Website crawlen oder den Anbieter-Fragebogen ausfüllen.",
      false,
    );
  }

  const models = await loadContentModelConfig(service);
  const override = process.env.ANTHROPIC_DT_GROUNDING_MODEL?.trim();
  const candidates = override ? [override, ...models[def.tier]] : models[def.tier];
  const rules = await loadGroundingPagesRules(service);
  const spec = groundingStepSpec(step, context, {
    base: rules.agentBase,
    standard: rules.agentStandard,
  });
  const call = await callContentTool({
    models: candidates,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
    apiKey: resolveGroundingApiKey(),
    toolLabel: "Grounding",
  });
  const output = spec.normalize(call.json, context);
  const costEur = estimateCostEur(call.model, call.usage);

  await recordLlmUsageEvent(service, {
    organisationId: page.organisation_id,
    userId: page.started_by,
    mode: `grounding.${step}`,
    via: "direct",
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  });

  // „Stoppen“ or „Zurücksetzen“ while the model was answering: cost is recorded, the
  // result must not land on a page that is no longer running.
  const { data: live, error: liveError } = await service
    .from("dt_grounding_pages")
    .select("run_state, html")
    .eq("id", page.id)
    .maybeSingle();
  if (!liveError && live?.run_state !== "laeuft") {
    return { step, halted: true, discarded: true, model: call.model, costEur };
  }

  const { pagePatch, stepStatus, halted } = groundingStepPatchFor(step, output, { html: (live?.html as string | null) ?? page.html });
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + costEur);

  await upsertStep(service, page, step, {
    status: stepStatus,
    output: output as Record<string, unknown>,
    model: call.model,
    input_tokens: call.usage.inputTokens,
    output_tokens: call.usage.outputTokens,
    cost_eur: roundEur(costEur),
    error: null,
    finished_at: new Date().toISOString(),
  });
  const { error } = await service.from("dt_grounding_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(groundingRunDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));

  return { step, halted, model: call.model, costEur };
}

/** Pause the page with the error visible. */
export async function markGroundingStepError(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  step: number,
  message: string,
): Promise<void> {
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, { status: "error", error: text, finished_at: new Date().toISOString() }).catch((err) =>
    console.error("[grounding] step error not stored", err),
  );
  await service
    .from("dt_grounding_pages")
    .update({ run_state: "in_arbeit", run_step: step, run_error: text, job_id: null })
    .eq("id", page.id);
}

/** The runner retries later; the page stays `laeuft` with the reason visible. */
export async function markGroundingStepRetry(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  step: number,
  message: string,
): Promise<void> {
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, { status: "pending", error: text, finished_at: new Date().toISOString() }).catch((err) =>
    console.error("[grounding] step retry not stored", err),
  );
  await service
    .from("dt_grounding_pages")
    .update({ run_step: step, run_error: text })
    .eq("id", page.id)
    .eq("run_state", "laeuft");
}

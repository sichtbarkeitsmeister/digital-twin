/**
 * Executes one pipeline step for a page: loads the context, calls the model, stores the
 * result on `dt_content_steps` and `dt_content_pages`. Called by the `content.page` job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { avatarFromAgent } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  contentStepSpec,
  type ContentPipelineContext,
  type EndabnahmeOutput,
  type FaktencheckOutput,
  type GliederungOutput,
  type LektoratOutput,
  type RechercheOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import {
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  contentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { htmlToMarkdown, parseBlocksFromHtml, renderBlocksHtml } from "@/lib/dt/content/render";
import {
  loadContentSettings,
  num,
  settingsFromRow,
  type ContentPageRow,
  type ContentStepRow,
} from "@/lib/dt/content/store";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export type StepOutcome = {
  step: number;
  /** True when the pipeline must stop here (questions for the customer, or finished). */
  halted: boolean;
  model: string;
  costEur: number;
};

async function loadContext(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
): Promise<{ context: ContentPipelineContext; avatarId: string | null }> {
  const [{ data: organisation }, settingsRow, anbieter, { data: structure }] = await Promise.all([
    service.from("organisations").select("name").eq("id", page.organisation_id).maybeSingle(),
    loadContentSettings(service, page.organisation_id),
    loadContentAnbieterSources(service, page.organisation_id),
    service.from("dt_website_structures").select("outline").eq("organisation_id", page.organisation_id).maybeSingle(),
  ]);
  if (!settingsRow) {
    throw new ContentLlmError("Die Einstellungen für Texte sind noch nicht bestätigt.", false);
  }
  const sections = anbieter.sections;
  if (sections.length === 0) {
    throw new ContentLlmError(
      "Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche).",
      false,
    );
  }

  let avatarId = settingsRow.avatar_agent_id;
  if (!avatarId) {
    const [newest] = await loadContentAvatarOptions(service, page.organisation_id);
    avatarId = newest?.id ?? null;
  }
  const avatarRow = avatarId ? await loadContentAvatarRow(service, page.organisation_id, avatarId) : null;
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;

  const outputs: ContentPipelineContext["outputs"] = {};
  for (const row of steps) {
    if (row.status === "done" || row.status === "waiting") outputs[row.step] = row.output;
  }

  return {
    avatarId: avatarRow?.id ?? null,
    context: {
      organisationName: (organisation?.name as string | undefined)?.trim() || "",
      page: { name: page.name, path: page.path, level: page.level },
      structureOutline: (structure?.outline as string | undefined) ?? "",
      sections,
      settings: settingsFromRow(settingsRow),
      avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
      notes: page.notes,
      outputs,
      blocks: parseBlocksFromHtml(page.html),
      title: page.title,
      metaDescription: page.meta_description,
    },
  };
}

async function upsertStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  patch: Partial<ContentStepRow>,
): Promise<void> {
  const def = contentStepDefinition(step);
  const { error } = await service.from("dt_content_steps").upsert(
    { page_id: page.id, organisation_id: page.organisation_id, step, name: def?.name ?? `Schritt ${step}`, ...patch },
    { onConflict: "page_id,step" },
  );
  if (error) throw new Error(`Schritt konnte nicht gespeichert werden: ${error.message}`);
}

function textPatch(out: TextOutput): Record<string, unknown> {
  const html = renderBlocksHtml(out.blocks);
  return { html, markdown: htmlToMarkdown(html), title: out.title, meta_description: out.meta_description };
}

export async function runContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
  step: number,
  timeoutMs?: number,
): Promise<StepOutcome> {
  const def = contentStepDefinition(step);
  if (!def) throw new ContentLlmError(`Unbekannter Schritt ${step}.`, false);

  await upsertStep(service, page, step, {
    status: "running",
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  });
  await service.from("dt_content_pages").update({ step, error: null }).eq("id", page.id);

  const { context, avatarId } = await loadContext(service, page, steps);
  const models = await loadContentModelConfig(service);
  const spec = contentStepSpec(step, context);
  const { json, usage, model } = await callContentTool({
    models: models[def.tier],
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs,
  });
  const output = spec.normalize(json, context);
  const costEur = estimateCostEur(model, usage);

  await recordLlmUsageEvent(service, {
    organisationId: page.organisation_id,
    userId: page.started_by,
    agentId: avatarId,
    mode: `content.${step}`,
    via: "direct",
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const pagePatch: Record<string, unknown> = { cost_eur: roundEur(num(page.cost_eur) + costEur) };
  let stepStatus: ContentStepRow["status"] = "done";
  let halted = false;

  switch (step) {
    case 1: {
      const out = output as RechercheOutput;
      if (out.main_keyword) pagePatch.main_keyword = out.main_keyword;
      break;
    }
    case 2: {
      const out = output as GliederungOutput;
      if (out.outline.length === 0) throw new ContentLlmError("Die Gliederung war leer.", true);
      if (out.title) pagePatch.title = out.title;
      if (out.meta_description) pagePatch.meta_description = out.meta_description;
      break;
    }
    case CONTENT_STEP_FAKTENCHECK: {
      const out = output as FaktencheckOutput;
      pagePatch.findings = out.findings;
      pagePatch.questions = out.questions;
      if (out.questions.some((q) => q.blocking)) {
        pagePatch.state = "braucht_sie";
        pagePatch.job_id = null;
        stepStatus = "waiting";
        halted = true;
      }
      break;
    }
    case 7: {
      const out = output as LektoratOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Das Lektorat lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out));
      pagePatch.final_findings = out.final_findings;
      break;
    }
    case CONTENT_STEP_ENDABNAHME: {
      const out = output as EndabnahmeOutput;
      pagePatch.unresolved = out.unresolved;
      pagePatch.state = "fertig";
      pagePatch.released = false;
      pagePatch.job_id = null;
      stepStatus = "waiting";
      halted = true;
      break;
    }
    default: {
      if (def.writesText) {
        const out = output as TextOutput;
        if (out.blocks.length === 0) throw new ContentLlmError("Die KI hat keinen Text geliefert.", true);
        Object.assign(pagePatch, textPatch(out));
        if (step > CONTENT_STEP_FAKTENCHECK) pagePatch.findings = [];
      }
    }
  }

  await upsertStep(service, page, step, {
    status: stepStatus,
    output: output as Record<string, unknown>,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_eur: costEur,
    error: null,
    finished_at: new Date().toISOString(),
  });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(`Seite konnte nicht gespeichert werden: ${error.message}`);

  return { step, halted, model, costEur };
}

/** Pause the page with the error visible in the table and drawer. */
export async function markContentStepError(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  message: string,
): Promise<void> {
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, {
    status: "error",
    error: text,
    finished_at: new Date().toISOString(),
  }).catch((err) => console.error("[content] step error not stored", err));
  await service
    .from("dt_content_pages")
    .update({ state: "in_arbeit", step, error: text, job_id: null })
    .eq("id", page.id);
}

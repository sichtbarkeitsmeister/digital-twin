import { createClient } from "@/lib/supabase/server";
import type { SurveyAiProposal } from "@/lib/ai/survey-assistant-types";
import { applySurveyPatchOperations } from "@/lib/ai/survey-patch";
import { validateUniqueSurveyIds } from "@/lib/ai/survey-id-guards";
import { updateDtAgent } from "@/lib/dt/db";
import {
  assignSurveyFolderAction,
  createSurveyFolderAction,
  deleteSurveyAction,
  deleteSurveyFolderAction,
  publishSurveyAction,
  restoreSurveyAction,
  unpublishSurveyAction,
  updateSurveyFolderAction,
  updateSurveyMetadataAction,
  upsertSurveyDraftAction,
} from "@/app/dashboard/surveys/actions";

export type AppliedResult = {
  ok: boolean;
  message: string;
  revertPayload?: Record<string, unknown> | null;
  navigateTo?: string | null;
};

type NonBatchSurveyProposal = Exclude<SurveyAiProposal, { kind: "batch" }>;

const UUID_LOOKUP_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RefRegistryEntry = {
  tag: "folder" | "survey";
  id: string;
};

/** batch steps use logical refs plus literal UUID strings for Known surveys/folders */
function normalizeUuidCandidate(candidate: string): string | undefined {
  const trimmed = candidate.trim();
  return UUID_LOOKUP_RE.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function resolveSurveyIdFromRef(registry: Map<string, RefRegistryEntry>, key: string): string | undefined {
  const entry = registry.get(key);
  if (entry) {
    return entry.tag === "survey" ? entry.id : undefined;
  }
  return normalizeUuidCandidate(key);
}

function resolveFolderAssignment(
  registry: Map<string, RefRegistryEntry>,
  key: string | null,
):
  | { ok: true; folderId: string | null }
  | { ok: false; reason: string } {
  if (key === null) return { ok: true, folderId: null };
  const entry = registry.get(key);
  if (entry) {
    if (entry.tag === "folder") return { ok: true, folderId: entry.id };
    return {
      ok: false,
      reason: `„${key}“ verweist auf eine Umfrage, nicht auf einen Ordner.`,
    };
  }
  const literal = normalizeUuidCandidate(key);
  if (literal) return { ok: true, folderId: literal };
  return {
    ok: false,
    reason: `Unbekannter Ordner-Verweis „${key}“ (ref oder UUID aus „Known folders“).`,
  };
}

async function rollbackRevertsAscending(revertsAsc: Record<string, unknown>[]) {
  for (let i = revertsAsc.length - 1; i >= 0; i--) {
    await revertSurveyProposal(revertsAsc[i] as Record<string, unknown>);
  }
}

async function applyNonBatchSurveyProposal(proposal: NonBatchSurveyProposal): Promise<AppliedResult> {
  if (proposal.kind === "patch_survey_definition") {
    const supabase = await createClient();
    const { data: current } = await supabase
      .from("surveys")
      .select("id,title,description,notification_emails,definition")
      .eq("id", proposal.surveyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!current) return { ok: false, message: "Umfrage nicht gefunden." };

    const patched = applySurveyPatchOperations({
      baseSurvey: current.definition,
      operations: proposal.operations as Parameters<typeof applySurveyPatchOperations>[0]["operations"],
    });
    if (!patched.ok) return { ok: false, message: patched.message };
    const uniquePatched = validateUniqueSurveyIds(patched.survey);
    if (!uniquePatched.ok) return { ok: false, message: uniquePatched.message };

    const res = await upsertSurveyDraftAction({
      surveyId: proposal.surveyId,
      title: current.title,
      description: current.description ?? "",
      notificationEmails: current.notification_emails ?? [],
      definition: patched.survey,
    });
    if (!res.ok) return { ok: false, message: res.message };

    return {
      ok: true,
      message: "Umfrage per Patch aktualisiert.",
      navigateTo: `/dashboard/surveys/${proposal.surveyId}/edit`,
      revertPayload: {
        kind: "revert_definition",
        surveyId: proposal.surveyId,
        previousDefinition: current.definition,
        previousTitle: current.title,
        previousDescription: current.description ?? "",
        previousNotificationEmails: current.notification_emails ?? [],
      },
    };
  }

  if (proposal.kind === "edit_survey_definition") {
    if (!proposal.surveyId) {
      return { ok: false, message: "Für Definition-Änderungen fehlt surveyId." };
    }
    const supabase = await createClient();
    const { data: current } = await supabase
      .from("surveys")
      .select("id,title,description,notification_emails,definition")
      .eq("id", proposal.surveyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!current) return { ok: false, message: "Umfrage nicht gefunden." };

    const uniqueEdited = validateUniqueSurveyIds(proposal.survey);
    if (!uniqueEdited.ok) return { ok: false, message: uniqueEdited.message };

    const res = await upsertSurveyDraftAction({
      surveyId: proposal.surveyId,
      title: current.title,
      description: current.description ?? "",
      notificationEmails: current.notification_emails ?? [],
      definition: proposal.survey,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Umfrage-Definition aktualisiert.",
      navigateTo: `/dashboard/surveys/${proposal.surveyId}/edit`,
      revertPayload: {
        kind: "revert_definition",
        surveyId: proposal.surveyId,
        previousDefinition: current.definition,
        previousTitle: current.title,
        previousDescription: current.description ?? "",
        previousNotificationEmails: current.notification_emails ?? [],
      },
    };
  }

  if (proposal.kind === "create_survey") {
    const uniqueCreated = validateUniqueSurveyIds(proposal.survey);
    if (!uniqueCreated.ok) return { ok: false, message: uniqueCreated.message };

    const res = await upsertSurveyDraftAction({
      title: proposal.title,
      description: proposal.description ?? "",
      notificationEmails: proposal.notificationEmails ?? [],
      definition: proposal.survey,
    });
    if (!res.ok || !res.data?.surveyId) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Umfrage erstellt.",
      navigateTo: `/dashboard/surveys/${res.data.surveyId}/edit`,
      revertPayload: { kind: "revert_create", surveyId: res.data.surveyId },
    };
  }

  if (proposal.kind === "create_folder") {
    const res = await createSurveyFolderAction({ name: proposal.name });
    if (!res.ok || !res.data?.folderId) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Ordner erstellt.",
      navigateTo: "/dashboard/surveys",
      revertPayload: {
        kind: "revert_create_folder",
        folderId: res.data.folderId,
      },
    };
  }

  if (proposal.kind === "rename_folder") {
    const supabase = await createClient();
    const { data: folderBefore } = await supabase
      .from("survey_folders")
      .select("id,name")
      .eq("id", proposal.folderId)
      .maybeSingle();
    if (!folderBefore) return { ok: false, message: "Ordner nicht gefunden." };

    const res = await updateSurveyFolderAction({
      folderId: proposal.folderId,
      name: proposal.name,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Ordner umbenannt.",
      navigateTo: "/dashboard/surveys",
      revertPayload: {
        kind: "revert_rename_folder",
        folderId: proposal.folderId,
        previousName: folderBefore.name,
      },
    };
  }

  if (proposal.kind === "delete_folder") {
    const res = await deleteSurveyFolderAction({ folderId: proposal.folderId });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Ordner gelöscht.",
      navigateTo: "/dashboard/surveys",
    };
  }

  const supabase = await createClient();
  const { data: current } =
    "surveyId" in proposal
      ? await supabase
          .from("surveys")
          .select("id,title,description,visibility,folder_id")
          .eq("id", proposal.surveyId)
          .is("deleted_at", null)
          .maybeSingle()
      : { data: null };

  if ("surveyId" in proposal && !current) {
    return { ok: false, message: "Umfrage nicht gefunden." };
  }

  if (proposal.kind === "assign_folder") {
    const res = await assignSurveyFolderAction({
      surveyId: proposal.surveyId,
      folderId: proposal.folderId,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Ordner aktualisiert.",
      revertPayload: {
        kind: "revert_folder",
        surveyId: proposal.surveyId,
        previousFolderId: current?.folder_id ?? null,
      },
    };
  }

  if (proposal.kind === "publish") {
    const res = await publishSurveyAction({ surveyId: proposal.surveyId });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Umfrage veröffentlicht.",
      revertPayload: {
        kind: "revert_visibility",
        surveyId: proposal.surveyId,
        previousVisibility: current?.visibility ?? "private",
      },
    };
  }

  if (proposal.kind === "unpublish") {
    const res = await unpublishSurveyAction({ surveyId: proposal.surveyId });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Umfrage privat gesetzt.",
      revertPayload: {
        kind: "revert_visibility",
        surveyId: proposal.surveyId,
        previousVisibility: current?.visibility ?? "private",
      },
    };
  }

  if (proposal.kind === "update_survey_metadata") {
    const res = await updateSurveyMetadataAction({
      surveyId: proposal.surveyId,
      title: proposal.title,
      description: proposal.description,
    });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Metadaten aktualisiert.",
      navigateTo: `/dashboard/surveys/${proposal.surveyId}/edit`,
      revertPayload: {
        kind: "revert_metadata",
        surveyId: proposal.surveyId,
        previousTitle: current?.title ?? "",
        previousDescription: current?.description ?? "",
      },
    };
  }

  if (proposal.kind === "delete_survey") {
    const res = await deleteSurveyAction({ surveyId: proposal.surveyId });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message: "Umfrage gelöscht (archiviert).",
      revertPayload: {
        kind: "revert_delete",
        surveyId: proposal.surveyId,
      },
    };
  }

  if (proposal.kind === "edit_dt_agent_prompt") {
    const supabase = await createClient();
    const { data: agent } = await supabase
      .from("dt_agents")
      .select(
        "id, organisation_id, name, slug, prompt_template, prompt_append, uses_global_prompt",
      )
      .eq("id", proposal.agentId)
      .maybeSingle();

    if (!agent) {
      return { ok: false, message: "Agent nicht gefunden." };
    }
    if (
      proposal.organisationId &&
      proposal.organisationId !== agent.organisation_id
    ) {
      return { ok: false, message: "Agent gehört nicht zur angegebenen Organisation." };
    }

    const target = proposal.target ?? "prompt_template";
    const previousPromptTemplate = agent.prompt_template ?? "";
    const previousPromptAppend = agent.prompt_append ?? null;
    const previousUsesGlobal = Boolean(agent.uses_global_prompt);

    const patch: Record<string, unknown> =
      target === "prompt_append"
        ? { prompt_append: proposal.prompt }
        : {
            prompt_template: proposal.prompt,
            // Standalone prompt edit: leave global sync as-is unless target is template
            // while agent was global — then keep append and turn sync off so the new body wins.
            ...(previousUsesGlobal
              ? { uses_global_prompt: false }
              : {}),
          };

    const { ok, error } = await updateDtAgent({
      agentId: proposal.agentId,
      patch,
    });
    if (!ok) {
      return {
        ok: false,
        message: error ?? "Agent-Prompt konnte nicht gespeichert werden.",
      };
    }

    const label = proposal.agentName?.trim() || agent.name;
    return {
      ok: true,
      message: `Prompt von „${label}“ aktualisiert.`,
      navigateTo: `/dashboard/verwaltung/agents?org=${encodeURIComponent(agent.organisation_id)}`,
      revertPayload: {
        kind: "revert_dt_agent_prompt",
        agentId: proposal.agentId,
        previousPromptTemplate,
        previousPromptAppend,
        previousUsesGlobalPrompt: previousUsesGlobal,
        target,
      },
    };
  }

  return { ok: false, message: "Dieser Vorschlag kann serverseitig nicht ausgeführt werden." };
}

async function applySurveyBatchProposal(
  proposal: Extract<SurveyAiProposal, { kind: "batch" }>,
): Promise<AppliedResult> {
  const registry = new Map<string, RefRegistryEntry>();
  const revertsAsc: Record<string, unknown>[] = [];

  async function failRollingBack(message: string): Promise<AppliedResult> {
    await rollbackRevertsAscending(revertsAsc);
    return { ok: false, message };
  }

  async function runSub(sub: NonBatchSurveyProposal, meta: string): Promise<AppliedResult> {
    const r = await applyNonBatchSurveyProposal(sub);
    if (!r.ok) return { ok: false, message: `${meta}: ${r.message}` };
    if (r.revertPayload != null) revertsAsc.push(r.revertPayload);
    return r;
  }

  try {
    for (let i = 0; i < proposal.steps.length; i++) {
      const step = proposal.steps[i];
      const meta = `Batch Schritt ${i + 1}/${proposal.steps.length}`;

      if (step.kind === "create_folder") {
        const ref = "ref" in step ? step.ref : undefined;
        if (!ref) return await failRollingBack(`${meta}: Ungültiger Ordner-Schritt.`);
        const r = await runSub(
          { kind: "create_folder", summary: step.summary, name: step.name },
          meta,
        );
        if (!r.ok) return await failRollingBack(r.message);
        const payload = r.revertPayload;
        const fid =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { folderId?: unknown }).folderId === "string"
            ? (payload as { folderId: string }).folderId
            : null;
        if (!fid) return await failRollingBack(`${meta}: Ordner-ID fehlt nach Erstellung.`);
        registry.set(ref, { tag: "folder", id: fid });
        continue;
      }

      if (step.kind === "create_survey") {
        const ref = "ref" in step ? step.ref : undefined;
        if (!ref) return await failRollingBack(`${meta}: Ungültiger Umfrage-Schritt.`);
        const r = await runSub(
          {
            kind: "create_survey",
            summary: step.summary,
            title: step.title,
            description: step.description ?? "",
            notificationEmails: step.notificationEmails ?? [],
            survey: step.survey,
          },
          meta,
        );
        if (!r.ok) return await failRollingBack(r.message);
        const payload = r.revertPayload;
        const sid =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { surveyId?: unknown }).surveyId === "string"
            ? (payload as { surveyId: string }).surveyId
            : null;
        if (!sid) return await failRollingBack(`${meta}: Umfrage-ID fehlt nach Erstellung.`);
        registry.set(ref, { tag: "survey", id: sid });
        continue;
      }

      if (step.kind === "assign_folder" && "surveyRef" in step) {
        const surveyId = resolveSurveyIdFromRef(registry, step.surveyRef);
        if (!surveyId) {
          return await failRollingBack(
            `${meta}: Unbekannter surveyRef „${step.surveyRef}“ (ref oder gültige Survey-UUID).`,
          );
        }
        const resolved = resolveFolderAssignment(registry, step.folderRef);
        if (!resolved.ok) return await failRollingBack(`${meta}: ${resolved.reason}`);
        const r = await runSub(
          {
            kind: "assign_folder",
            summary: step.summary,
            surveyId,
            folderId: resolved.folderId,
          },
          meta,
        );
        if (!r.ok) return await failRollingBack(r.message);
        continue;
      }

      if (
        step.kind === "assign_folder" &&
        "surveyId" in step &&
        typeof step.surveyId === "string" &&
        "folderRef" in step &&
        // folderId must be absent or models mix invalid shapes — pure surveyId + folderRef
        !(
          typeof (step as { folderId?: unknown }).folderId === "string" ||
          (step as { folderId?: unknown }).folderId === null
        )
      ) {
        const resolved = resolveFolderAssignment(
          registry,
          (step as { folderRef: string | null }).folderRef,
        );
        if (!resolved.ok) return await failRollingBack(`${meta}: ${resolved.reason}`);
        const r = await runSub(
          {
            kind: "assign_folder",
            summary: step.summary,
            surveyId: (step as { surveyId: string }).surveyId,
            folderId: resolved.folderId,
          },
          meta,
        );
        if (!r.ok) return await failRollingBack(r.message);
        continue;
      }

      const sub = step as NonBatchSurveyProposal;
      const r = await runSub(sub, meta);
      if (!r.ok) return await failRollingBack(r.message);
    }
  } catch (e) {
    await rollbackRevertsAscending(revertsAsc);
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Batch fehlgeschlagen und zurückgerollt.",
    };
  }

  return {
    ok: true,
    message: `Batch abgeschlossen (${proposal.steps.length} Schritte).`,
    navigateTo: "/dashboard/surveys",
    revertPayload: { kind: "revert_batch", steps: revertsAsc },
  };
}

export async function applySurveyProposal(proposal: SurveyAiProposal): Promise<AppliedResult> {
  if (proposal.kind === "batch") {
    return applySurveyBatchProposal(proposal);
  }
  return applyNonBatchSurveyProposal(proposal);
}

export async function revertSurveyProposal(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  if (kind === "revert_batch") {
    const raw = payload.steps;
    if (!Array.isArray(raw)) {
      return { ok: false, message: "Ungültiger Batch-Revert-Payload." };
    }
    const steps = raw as Record<string, unknown>[];
    for (let i = steps.length - 1; i >= 0; i--) {
      const inner = steps[i];
      const r = await revertSurveyProposal(inner as Record<string, unknown>);
      if (!r.ok) return r;
    }
    return { ok: true, message: "Batch wurde rückgängig gemacht." };
  }
  if (kind === "revert_create" && typeof payload.surveyId === "string") {
    const res = await deleteSurveyAction({ surveyId: payload.surveyId });
    return { ok: res.ok, message: res.message };
  }
  if (kind === "revert_delete" && typeof payload.surveyId === "string") {
    const res = await restoreSurveyAction({ surveyId: payload.surveyId });
    return { ok: res.ok, message: res.message };
  }
  if (
    kind === "revert_folder" &&
    typeof payload.surveyId === "string" &&
    (typeof payload.previousFolderId === "string" || payload.previousFolderId === null)
  ) {
    const res = await assignSurveyFolderAction({
      surveyId: payload.surveyId,
      folderId: payload.previousFolderId,
    });
    return { ok: res.ok, message: res.message };
  }
  if (
    kind === "revert_visibility" &&
    typeof payload.surveyId === "string" &&
    (payload.previousVisibility === "public" || payload.previousVisibility === "private")
  ) {
    const res =
      payload.previousVisibility === "public"
        ? await publishSurveyAction({ surveyId: payload.surveyId })
        : await unpublishSurveyAction({ surveyId: payload.surveyId });
    return { ok: res.ok, message: res.message };
  }
  if (
    kind === "revert_definition" &&
    typeof payload.surveyId === "string" &&
    typeof payload.previousTitle === "string" &&
    typeof payload.previousDescription === "string" &&
    Array.isArray(payload.previousNotificationEmails)
  ) {
    const res = await upsertSurveyDraftAction({
      surveyId: payload.surveyId,
      title: payload.previousTitle,
      description: payload.previousDescription,
      notificationEmails: payload.previousNotificationEmails as string[],
      definition: payload.previousDefinition,
    });
    return { ok: res.ok, message: res.message };
  }
  if (
    kind === "revert_metadata" &&
    typeof payload.surveyId === "string" &&
    typeof payload.previousTitle === "string" &&
    typeof payload.previousDescription === "string"
  ) {
    const res = await updateSurveyMetadataAction({
      surveyId: payload.surveyId,
      title: payload.previousTitle,
      description: payload.previousDescription,
    });
    return { ok: res.ok, message: res.message };
  }
  if (kind === "revert_create_folder" && typeof payload.folderId === "string") {
    const res = await deleteSurveyFolderAction({ folderId: payload.folderId });
    return { ok: res.ok, message: res.message };
  }
  if (
    kind === "revert_rename_folder" &&
    typeof payload.folderId === "string" &&
    typeof payload.previousName === "string"
  ) {
    const res = await updateSurveyFolderAction({
      folderId: payload.folderId,
      name: payload.previousName,
    });
    return { ok: res.ok, message: res.message };
  }

  if (kind === "revert_dt_agent_prompt" && typeof payload.agentId === "string") {
    const previousTemplate =
      typeof payload.previousPromptTemplate === "string"
        ? payload.previousPromptTemplate
        : "";
    const previousAppend =
      typeof payload.previousPromptAppend === "string"
        ? payload.previousPromptAppend
        : payload.previousPromptAppend === null
          ? null
          : undefined;
    const previousUsesGlobal =
      typeof payload.previousUsesGlobalPrompt === "boolean"
        ? payload.previousUsesGlobalPrompt
        : undefined;

    const patch: Record<string, unknown> = {
      prompt_template: previousTemplate,
    };
    if (previousAppend !== undefined) {
      patch.prompt_append = previousAppend;
    }
    if (previousUsesGlobal !== undefined) {
      patch.uses_global_prompt = previousUsesGlobal;
    }

    const { ok, error } = await updateDtAgent({
      agentId: payload.agentId,
      patch,
    });
    return {
      ok,
      message: ok
        ? "Agent-Prompt wurde zurückgesetzt."
        : (error ?? "Revert des Agent-Prompts fehlgeschlagen."),
    };
  }

  return { ok: false, message: "Kein gültiger Revert-Payload vorhanden." };
}

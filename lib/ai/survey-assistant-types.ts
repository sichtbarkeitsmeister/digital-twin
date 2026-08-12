import { z } from "zod";

import {
  surveyFieldSchema,
  surveySchema,
  surveyStepSchema,
} from "@/lib/surveys/schema";

const builderProposalSchema = z.object({
  kind: z.literal("edit_survey_definition"),
  summary: z.string().min(1),
  surveyId: z.string().uuid().optional(),
  survey: surveySchema,
});

const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_field"),
    stepId: z.string().min(1),
    fieldId: z.string().min(1),
    patch: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0),
  }),
  z.object({
    op: z.literal("add_field"),
    stepId: z.string().min(1),
    // Must be a full field object — z.unknown() in Zod 4 accepts missing keys.
    field: surveyFieldSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("delete_field"),
    stepId: z.string().min(1),
    fieldId: z.string().min(1),
  }),
  z.object({
    op: z.literal("update_step"),
    stepId: z.string().min(1),
    patch: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
      })
      .refine((v) => v.title !== undefined || v.description !== undefined),
  }),
  z.object({
    op: z.literal("add_step"),
    step: surveyStepSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("delete_step"),
    stepId: z.string().min(1),
  }),
  /** Model alias — same as delete_step */
  z.object({
    op: z.literal("remove_step"),
    stepId: z.string().min(1),
  }),
  z.object({
    op: z.literal("update_survey_root"),
    patch: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        infoText: z.string().optional(),
        infoTextEnabled: z.boolean().optional(),
        answerPlaceholder: z.string().optional(),
      })
      .refine(
        (v) =>
          v.title !== undefined ||
          v.description !== undefined ||
          v.infoText !== undefined ||
          v.infoTextEnabled !== undefined ||
          v.answerPlaceholder !== undefined,
        { message: "update_survey_root.patch must set at least one property" },
      ),
  }),
  /** Model alias — sets survey definition infoText (+ enables if non-empty) */
  z.object({
    op: z.literal("update_info_text"),
    infoText: z.string(),
  }),
]);

const patchSurveyProposalSchema = z.object({
  kind: z.literal("patch_survey_definition"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
  operations: z.array(patchOperationSchema).min(1),
});

const createSurveyProposalSchema = z.object({
  kind: z.literal("create_survey"),
  summary: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  notificationEmails: z.array(z.string()).default([]),
  survey: surveySchema,
  /** Optional completed/in-progress answers created together with the survey (raw import). */
  initialResponse: z
    .object({
      status: z.enum(["in_progress", "completed"]).default("completed"),
      answers: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});

const createFolderProposalSchema = z.object({
  kind: z.literal("create_folder"),
  summary: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

const renameFolderProposalSchema = z.object({
  kind: z.literal("rename_folder"),
  summary: z.string().min(1),
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

const deleteFolderProposalSchema = z.object({
  kind: z.literal("delete_folder"),
  summary: z.string().min(1),
  folderId: z.string().uuid(),
});

const assignFolderProposalSchema = z.object({
  kind: z.literal("assign_folder"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
});

const publishProposalSchema = z.object({
  kind: z.literal("publish"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
});

const unpublishProposalSchema = z.object({
  kind: z.literal("unpublish"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
});

const deleteProposalSchema = z.object({
  kind: z.literal("delete_survey"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
});

const updateSurveyMetadataProposalSchema = z.object({
  kind: z.literal("update_survey_metadata"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
});

/** Revise a DigitalTwin persona prompt (system prompt or avatar append). */
const editDtAgentPromptProposalSchema = z.object({
  kind: z.literal("edit_dt_agent_prompt"),
  summary: z.string().min(1),
  agentId: z.string().uuid(),
  agentName: z.string().trim().min(1).max(120).optional(),
  organisationId: z.string().uuid().optional(),
  /** Which stored field to overwrite. */
  target: z.enum(["prompt_template", "prompt_append"]).default("prompt_template"),
  /** Full replacement text for the target field. */
  prompt: z.string().trim().min(40).max(120_000),
});

/** ref names for chaining inside batch steps (surveyRef / folderRef point at earlier refs). */
const batchIdentifierRefSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: "ref must be an identifier starting with a letter",
  });

const batchCreateFolderStepSchema = z.object({
  kind: z.literal("create_folder"),
  ref: batchIdentifierRefSchema,
  summary: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

const batchCreateSurveyStepSchema = z.object({
  kind: z.literal("create_survey"),
  ref: batchIdentifierRefSchema,
  summary: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  notificationEmails: z.array(z.string()).default([]),
  survey: surveySchema,
  initialResponse: z
    .object({
      status: z.enum(["in_progress", "completed"]).default("completed"),
      answers: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});

const batchAssignFolderRefStepSchema = z.object({
  kind: z.literal("assign_folder"),
  summary: z.string().min(1),
  surveyRef: z.string().min(1),
  folderRef: z.union([z.string().min(1), z.null()]),
});

/** survey from Known list UUID; folder still from batch ref */
const batchAssignSurveyIdFolderRefStepSchema = z.object({
  kind: z.literal("assign_folder"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
  folderRef: z.union([batchIdentifierRefSchema, z.string().uuid(), z.null()]),
});

const batchEditSurveyDefinitionStepSchema = z.object({
  kind: z.literal("edit_survey_definition"),
  summary: z.string().min(1),
  surveyId: z.string().uuid(),
  survey: surveySchema,
});

export const surveyAiBatchStepSchema = z.union([
  batchCreateFolderStepSchema,
  batchCreateSurveyStepSchema,
  batchAssignFolderRefStepSchema,
  batchAssignSurveyIdFolderRefStepSchema,
  assignFolderProposalSchema,
  publishProposalSchema,
  unpublishProposalSchema,
  patchSurveyProposalSchema,
  batchEditSurveyDefinitionStepSchema,
  renameFolderProposalSchema,
  deleteFolderProposalSchema,
  deleteProposalSchema,
  updateSurveyMetadataProposalSchema,
  editDtAgentPromptProposalSchema,
]);

const batchProposalSchema = z
  .object({
    kind: z.literal("batch"),
    summary: z.string().min(1),
    steps: z.array(surveyAiBatchStepSchema).min(2).max(60),
  })
  .superRefine((data, ctx) => {
    const declared = new Set<string>();
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i];
      if (step.kind === "create_folder" || step.kind === "create_survey") {
        if (declared.has(step.ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate ref "${step.ref}"`,
            path: ["steps", i, "ref"],
          });
        }
        declared.add(step.ref);
      }
    }
  });

export const surveyAiProposalSchema = z.discriminatedUnion("kind", [
  builderProposalSchema,
  patchSurveyProposalSchema,
  createSurveyProposalSchema,
  createFolderProposalSchema,
  renameFolderProposalSchema,
  deleteFolderProposalSchema,
  assignFolderProposalSchema,
  publishProposalSchema,
  unpublishProposalSchema,
  deleteProposalSchema,
  updateSurveyMetadataProposalSchema,
  editDtAgentPromptProposalSchema,
  batchProposalSchema,
]);

export const surveyAiRouteResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  proposal: surveyAiProposalSchema.optional(),
});

export type SurveyAiProposal = z.infer<typeof surveyAiProposalSchema>;

export type SurveyAiBatchStep = z.infer<typeof surveyAiBatchStepSchema>;

export type SurveyAiRouteResponse = z.infer<typeof surveyAiRouteResponseSchema>;

const UPDATE_FIELD_LIFT_KEYS = [
  "title",
  "description",
  "required",
  "placeholder",
  "type",
  "options",
  "scale",
  "allowOtherOption",
  "allowCustomEntries",
  "allowExtraEntries",
] as const;

const UPDATE_STEP_LIFT_KEYS = ["title", "description"] as const;

const UPDATE_SURVEY_ROOT_LIFT_KEYS = [
  "title",
  "description",
  "infoText",
  "infoTextEnabled",
  "answerPlaceholder",
] as const;

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeLiftedPatch(
  existingPatch: unknown,
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const patch = asPlainObject(existingPatch) ? { ...asPlainObject(existingPatch)! } : {};
  for (const key of keys) {
    if (source[key] !== undefined && patch[key] === undefined) {
      patch[key] = source[key];
    }
  }
  return patch;
}

/**
 * Models often emit flat patch ops like
 * `{ op:"update_field", stepId, fieldId, required:true }`
 * instead of `{ ..., patch:{ required:true } }`. Lift those keys so Zod accepts them.
 */
export function normalizeSurveyPatchOperation(raw: unknown): unknown {
  const op = asPlainObject(raw);
  if (!op || typeof op.op !== "string") return raw;

  if (op.op === "update_field") {
    const fieldId =
      typeof op.fieldId === "string"
        ? op.fieldId
        : typeof op.field === "string"
          ? op.field
          : op.fieldId;
    return {
      op: "update_field",
      stepId: op.stepId,
      fieldId,
      patch: mergeLiftedPatch(op.patch, op, UPDATE_FIELD_LIFT_KEYS),
    };
  }

  if (op.op === "update_step") {
    return {
      op: "update_step",
      stepId: op.stepId,
      patch: mergeLiftedPatch(op.patch, op, UPDATE_STEP_LIFT_KEYS),
    };
  }

  if (op.op === "update_survey_root") {
    return {
      op: "update_survey_root",
      patch: mergeLiftedPatch(op.patch, op, UPDATE_SURVEY_ROOT_LIFT_KEYS),
    };
  }

  return raw;
}

function normalizePatchOperationsArray(operations: unknown): unknown {
  if (!Array.isArray(operations)) return operations;
  return operations.map(normalizeSurveyPatchOperation);
}

/** Normalize common model mistakes before schema validation. */
export function normalizeSurveyAiProposalInput(raw: unknown): unknown {
  const proposal = asPlainObject(raw);
  if (!proposal || typeof proposal.kind !== "string") return raw;

  if (proposal.kind === "patch_survey_definition") {
    return {
      ...proposal,
      operations: normalizePatchOperationsArray(proposal.operations),
    };
  }

  if (proposal.kind === "batch" && Array.isArray(proposal.steps)) {
    return {
      ...proposal,
      steps: proposal.steps.map((step) => {
        const s = asPlainObject(step);
        if (!s || s.kind !== "patch_survey_definition") return step;
        return {
          ...s,
          operations: normalizePatchOperationsArray(s.operations),
        };
      }),
    };
  }

  return raw;
}

/** Normalize then validate a survey AI proposal payload. */
export function parseSurveyAiProposal(raw: unknown) {
  return surveyAiProposalSchema.safeParse(normalizeSurveyAiProposalInput(raw));
}

/** Short German explanation for common invalid proposal shapes. */
export function describeSurveyProposalValidationError(raw: unknown): string {
  const normalized = normalizeSurveyAiProposalInput(raw);
  const parsed = surveyAiProposalSchema.safeParse(normalized);
  if (parsed.success) return "Ungültiger Proposal-Payload.";

  const root = asPlainObject(normalized);
  const operations = Array.isArray(root?.operations) ? root!.operations : null;
  if (root?.kind === "patch_survey_definition" && operations) {
    for (let i = 0; i < operations.length; i++) {
      const op = asPlainObject(operations[i]);
      if (!op || typeof op.op !== "string") continue;
      if (op.op === "add_field" && (op.field === undefined || op.field === null)) {
        return `Ungültiger Proposal-Payload: Operation ${i + 1} (add_field) enthält kein field-Objekt.`;
      }
      if (op.op === "add_step" && (op.step === undefined || op.step === null)) {
        return `Ungültiger Proposal-Payload: Operation ${i + 1} (add_step) enthält kein step-Objekt.`;
      }
      if (op.op === "update_field" && (op.patch === undefined || op.patch === null) && op.required === undefined) {
        return `Ungültiger Proposal-Payload: Operation ${i + 1} (update_field) enthält kein patch-Objekt.`;
      }
    }
  }

  const issue = parsed.error.issues[0];
  if (!issue) return "Ungültiger Proposal-Payload.";
  const path = issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
  if (issue.message === "Invalid input" || issue.message.startsWith("Invalid input:")) {
    return `Ungültiger Proposal-Payload${path}.`;
  }
  return `Ungültiger Proposal-Payload${path}: ${issue.message}`;
}

/** How many Umfragen are archived by delete_survey in this proposal (standalone or batch). */
export function countSurveyDeletesInProposal(proposal: unknown): number {
  if (!proposal || typeof proposal !== "object") return 0;
  const p = proposal as { kind?: unknown; steps?: unknown };
  if (typeof p.kind !== "string") return 0;
  if (p.kind === "delete_survey") return 1;
  if (p.kind !== "batch" || !Array.isArray(p.steps)) return 0;
  let n = 0;
  for (const s of p.steps) {
    if (s && typeof s === "object" && (s as { kind?: unknown }).kind === "delete_survey") {
      n += 1;
    }
  }
  return n;
}


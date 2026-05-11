import { surveySchema } from "@/lib/surveys/schema";

type PatchOperation =
  | {
      op: "update_field";
      stepId: string;
      fieldId: string;
      patch: Record<string, unknown>;
    }
  | {
      op: "add_field";
      stepId: string;
      field: unknown;
      index?: number;
    }
  | {
      op: "delete_field";
      stepId: string;
      fieldId: string;
    }
  | {
      op: "update_step";
      stepId: string;
      patch: {
        title?: string;
        description?: string;
      };
    }
  | {
      op: "add_step";
      step: unknown;
      index?: number;
    }
  | {
      op: "delete_step";
      stepId: string;
    }
  | {
      op: "remove_step";
      stepId: string;
    }
  | {
      op: "update_survey_root";
      patch: {
        title?: string;
        description?: string;
        infoText?: string;
        infoTextEnabled?: boolean;
        answerPlaceholder?: string;
      };
    }
  | {
      op: "update_info_text";
      infoText: string;
    };

export function applySurveyPatchOperations(input: {
  baseSurvey: unknown;
  operations: PatchOperation[];
}) {
  const parsedBase = surveySchema.safeParse(input.baseSurvey);
  if (!parsedBase.success) {
    return { ok: false as const, message: "Aktuelle Umfrage ist ungültig und kann nicht gepatcht werden." };
  }

  const draft = JSON.parse(JSON.stringify(parsedBase.data)) as typeof parsedBase.data;

  const findStepIndex = (stepId: string) => draft.steps.findIndex((s) => s.id === stepId);

  for (const op of input.operations) {
    if (op.op === "update_info_text") {
      draft.infoText = op.infoText;
      draft.infoTextEnabled = op.infoText.trim().length > 0;
      continue;
    }

    if (op.op === "update_survey_root") {
      const p = op.patch;
      if (p.title !== undefined) draft.title = p.title;
      if (p.description !== undefined) draft.description = p.description;
      if (p.infoText !== undefined) draft.infoText = p.infoText;
      if (p.infoTextEnabled !== undefined) draft.infoTextEnabled = p.infoTextEnabled;
      if (p.answerPlaceholder !== undefined) draft.answerPlaceholder = p.answerPlaceholder;
      continue;
    }

    if (op.op === "update_field") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      const fieldIdx = draft.steps[stepIdx].fields.findIndex((f) => f.id === op.fieldId);
      if (fieldIdx < 0) return { ok: false as const, message: `Feld nicht gefunden: ${op.fieldId}` };
      draft.steps[stepIdx].fields[fieldIdx] = {
        ...draft.steps[stepIdx].fields[fieldIdx],
        ...op.patch,
      } as (typeof draft.steps)[number]["fields"][number];
      continue;
    }

    if (op.op === "add_field") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      const idx =
        typeof op.index === "number"
          ? Math.max(0, Math.min(op.index, draft.steps[stepIdx].fields.length))
          : draft.steps[stepIdx].fields.length;
      draft.steps[stepIdx].fields.splice(
        idx,
        0,
        op.field as (typeof draft.steps)[number]["fields"][number],
      );
      continue;
    }

    if (op.op === "delete_field") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      const fieldIdx = draft.steps[stepIdx].fields.findIndex((f) => f.id === op.fieldId);
      if (fieldIdx < 0) {
        return { ok: false as const, message: `Feld nicht gefunden: ${op.fieldId}` };
      }
      // Safety: remove exactly one target field (never all duplicates via filter).
      draft.steps[stepIdx].fields.splice(fieldIdx, 1);
      continue;
    }

    if (op.op === "update_step") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      draft.steps[stepIdx] = {
        ...draft.steps[stepIdx],
        ...op.patch,
      };
      continue;
    }

    if (op.op === "add_step") {
      const idx =
        typeof op.index === "number"
          ? Math.max(0, Math.min(op.index, draft.steps.length))
          : draft.steps.length;
      draft.steps.splice(idx, 0, op.step as (typeof draft.steps)[number]);
      continue;
    }

    if (op.op === "delete_step" || op.op === "remove_step") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) {
        return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      }
      // Safety: remove exactly one target step (never all duplicates via filter).
      draft.steps.splice(stepIdx, 1);
      continue;
    }
  }

  const parsedPatched = surveySchema.safeParse(draft);
  if (!parsedPatched.success) {
    return {
      ok: false as const,
      message: parsedPatched.error.issues[0]?.message ?? "Patch ergibt keine gültige Umfrage.",
    };
  }

  return { ok: true as const, survey: parsedPatched.data };
}


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

export function describeSkippedPatchFields(skippedFieldIds: string[]): string | null {
  if (skippedFieldIds.length === 0) return null;
  const list = skippedFieldIds.join(", ");
  return skippedFieldIds.length === 1
    ? `1 Feld lag nicht (mehr) im Fragebogen und wurde übersprungen: ${list}.`
    : `${skippedFieldIds.length} Felder lagen nicht (mehr) im Fragebogen und wurden übersprungen: ${list}.`;
}

export function describePatchAppliedMessage(skippedFieldIds: string[]): string {
  const skipNote = describeSkippedPatchFields(skippedFieldIds);
  return skipNote
    ? `Umfrage per Patch aktualisiert. ${skipNote}`
    : "Umfrage per Patch aktualisiert.";
}

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

  /** Field ids are unique across the survey — prefer the hinted step, then search globally. */
  const findField = (fieldId: string, preferredStepId?: string) => {
    if (preferredStepId) {
      const stepIdx = findStepIndex(preferredStepId);
      if (stepIdx >= 0) {
        const fieldIdx = draft.steps[stepIdx].fields.findIndex((f) => f.id === fieldId);
        if (fieldIdx >= 0) return { stepIdx, fieldIdx };
      }
    }
    for (let stepIdx = 0; stepIdx < draft.steps.length; stepIdx++) {
      const fieldIdx = draft.steps[stepIdx].fields.findIndex((f) => f.id === fieldId);
      if (fieldIdx >= 0) return { stepIdx, fieldIdx };
    }
    return null;
  };

  const skippedFieldIds: string[] = [];
  let appliedCount = 0;

  for (const op of input.operations) {
    if (op.op === "update_info_text") {
      draft.infoText = op.infoText;
      draft.infoTextEnabled = op.infoText.trim().length > 0;
      appliedCount += 1;
      continue;
    }

    if (op.op === "update_survey_root") {
      const p = op.patch;
      if (p.title !== undefined) draft.title = p.title;
      if (p.description !== undefined) draft.description = p.description;
      if (p.infoText !== undefined) draft.infoText = p.infoText;
      if (p.infoTextEnabled !== undefined) draft.infoTextEnabled = p.infoTextEnabled;
      if (p.answerPlaceholder !== undefined) draft.answerPlaceholder = p.answerPlaceholder;
      appliedCount += 1;
      continue;
    }

    if (op.op === "update_field") {
      const loc = findField(op.fieldId, op.stepId);
      if (!loc) {
        skippedFieldIds.push(op.fieldId);
        continue;
      }
      draft.steps[loc.stepIdx].fields[loc.fieldIdx] = {
        ...draft.steps[loc.stepIdx].fields[loc.fieldIdx],
        ...op.patch,
      } as (typeof draft.steps)[number]["fields"][number];
      appliedCount += 1;
      continue;
    }

    if (op.op === "add_field") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      if (op.field === undefined || op.field === null || typeof op.field !== "object") {
        return {
          ok: false as const,
          message: "add_field ohne field-Objekt — Felddefinition fehlt.",
        };
      }
      const idx =
        typeof op.index === "number"
          ? Math.max(0, Math.min(op.index, draft.steps[stepIdx].fields.length))
          : draft.steps[stepIdx].fields.length;
      draft.steps[stepIdx].fields.splice(
        idx,
        0,
        op.field as (typeof draft.steps)[number]["fields"][number],
      );
      appliedCount += 1;
      continue;
    }

    if (op.op === "delete_field") {
      const loc = findField(op.fieldId, op.stepId);
      if (!loc) {
        skippedFieldIds.push(op.fieldId);
        continue;
      }
      // Safety: remove exactly one target field (never all duplicates via filter).
      draft.steps[loc.stepIdx].fields.splice(loc.fieldIdx, 1);
      appliedCount += 1;
      continue;
    }

    if (op.op === "update_step") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      draft.steps[stepIdx] = {
        ...draft.steps[stepIdx],
        ...op.patch,
      };
      appliedCount += 1;
      continue;
    }

    if (op.op === "add_step") {
      if (op.step === undefined || op.step === null || typeof op.step !== "object") {
        return {
          ok: false as const,
          message: "add_step ohne step-Objekt — Schritt-Definition fehlt.",
        };
      }
      const idx =
        typeof op.index === "number"
          ? Math.max(0, Math.min(op.index, draft.steps.length))
          : draft.steps.length;
      draft.steps.splice(idx, 0, op.step as (typeof draft.steps)[number]);
      appliedCount += 1;
      continue;
    }

    if (op.op === "delete_step" || op.op === "remove_step") {
      const stepIdx = findStepIndex(op.stepId);
      if (stepIdx < 0) {
        return { ok: false as const, message: `Schritt nicht gefunden: ${op.stepId}` };
      }
      // Safety: remove exactly one target step (never all duplicates via filter).
      draft.steps.splice(stepIdx, 1);
      appliedCount += 1;
      continue;
    }
  }

  if (appliedCount === 0) {
    const skipNote = describeSkippedPatchFields(skippedFieldIds);
    return {
      ok: false as const,
      message:
        skipNote ??
        "Keine Änderung übernommen — der Patch hat keine gültigen Operationen.",
    };
  }

  const parsedPatched = surveySchema.safeParse(draft);
  if (!parsedPatched.success) {
    const issue = parsedPatched.error.issues[0];
    const raw = issue?.message ?? "Patch ergibt keine gültige Umfrage.";
    const message =
      raw.includes("expected object, received undefined") ||
      raw.includes("expected object, received null")
        ? "Patch unvollständig: ein Feld- oder Schritt-Objekt fehlt."
        : raw;
    return {
      ok: false as const,
      message,
    };
  }

  return { ok: true as const, survey: parsedPatched.data, skipped: skippedFieldIds };
}

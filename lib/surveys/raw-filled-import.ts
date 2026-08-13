import "server-only";

import { revalidatePath } from "next/cache";

import { extractFilledQuestionnaireWithAi } from "@/lib/surveys/raw-filled-questionnaire-ai";
import {
  parseRawFilledQuestionnaire,
  rawFilledToImportBundle,
  splitRawFilledDocuments,
} from "@/lib/surveys/raw-filled-questionnaire";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

export type RawFilledImportResultRow = {
  title: string;
  surveyId: string;
  responseId?: string;
  fieldCount: number;
  answeredCount: number;
};

export type RawFilledImportBatchResult = {
  ok: boolean;
  message: string;
  results: RawFilledImportResultRow[];
  failed: Array<{ title: string; message: string }>;
};

/**
 * Parse (+ KI) and persist one or more raw filled questionnaires.
 * Intended for the long-running `/api/surveys/import-raw` route (maxDuration 300).
 */
export async function runRawFilledQuestionnairesBatch(params: {
  items: Array<{ text: string; title?: string }>;
  folderId?: string | null;
}): Promise<RawFilledImportBatchResult> {
  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok || !auth.userId) {
    return {
      ok: false,
      message: auth.message,
      results: [],
      failed: [],
    };
  }

  const expanded: Array<{ text: string; title?: string }> = [];
  for (const item of params.items) {
    const parts = splitRawFilledDocuments(item.text);
    for (const part of parts) {
      expanded.push({
        text: part.text,
        title: parts.length === 1 ? item.title : item.title || part.label,
      });
    }
  }

  if (expanded.length === 0) {
    return {
      ok: false,
      message: "Keine Fragebögen im Text erkannt.",
      results: [],
      failed: [],
    };
  }
  if (expanded.length > 30) {
    return {
      ok: false,
      message: "Maximal 30 Fragebögen pro Import.",
      results: [],
      failed: [],
    };
  }

  const { importSurveyBundleAction } = await import(
    "@/app/dashboard/surveys/actions"
  );

  const results: RawFilledImportResultRow[] = [];
  const failed: Array<{ title: string; message: string }> = [];

  for (let i = 0; i < expanded.length; i += 1) {
    const item = expanded[i]!;
    const label = item.title?.trim() || `Fragebogen ${i + 1}`;

    let converted = parseRawFilledQuestionnaire(item.text, {
      title: item.title,
    });

    const textLen = item.text.length;
    const parsedCount = converted.ok ? converted.data.fieldCount : 0;
    // Large Word dumps often under-parse deterministically — always try KI and keep the richer result.
    const shouldTryAi =
      !converted.ok || (textLen >= 6_000 && parsedCount < 12) || (textLen >= 12_000 && parsedCount < 20);

    if (shouldTryAi) {
      const ai = await extractFilledQuestionnaireWithAi({
        text: item.text,
        title: item.title,
      });
      if (ai.ok) {
        if (!converted.ok || ai.data.fieldCount > converted.data.fieldCount) {
          converted = { ok: true, data: ai.data };
        }
      } else if (!converted.ok) {
        const parseMsg = converted.message.replace(/\s+/g, " ").trim();
        const aiMsg = ai.message.replace(/\s+/g, " ").trim();
        failed.push({
          title: label,
          message:
            aiMsg === parseMsg || /Keine Abschnitte|keine Fragen/i.test(aiMsg)
              ? `KI konnte den Fragebogen nicht strukturieren (${textLen.toLocaleString("de-DE")} Zeichen). Bitte erneut versuchen — oder Text mit klaren Fragen (?)/„Antwort:“-Zeilen einfügen. Details: ${aiMsg}`
              : `${parseMsg} — KI: ${aiMsg}`,
        });
        continue;
      }
    }

    if (!converted.ok) {
      failed.push({ title: label, message: converted.message });
      continue;
    }

    const bundle = rawFilledToImportBundle(converted.data);
    const imported = await importSurveyBundleAction({ payload: bundle });
    if (!imported.ok || !imported.data?.surveyId) {
      failed.push({
        title: label,
        message: imported.message || "Speichern fehlgeschlagen.",
      });
      continue;
    }

    const surveyId = imported.data.surveyId;
    const responseId = imported.data.responseId;

    if (params.folderId) {
      await auth.supabase
        .from("surveys")
        .update({ folder_id: params.folderId })
        .eq("id", surveyId);
    }

    results.push({
      title: converted.data.title || label,
      surveyId,
      responseId,
      fieldCount: converted.data.fieldCount,
      answeredCount: converted.data.answeredCount,
    });
  }

  if (results.length === 0) {
    return {
      ok: false,
      message:
        failed[0]?.message ?? "Kein Fragebogen konnte importiert werden.",
      results,
      failed,
    };
  }

  revalidatePath("/dashboard/surveys");
  for (const row of results) {
    revalidatePath(`/dashboard/surveys/${row.surveyId}/edit`);
    if (row.responseId) {
      revalidatePath(
        `/dashboard/surveys/${row.surveyId}/responses/${row.responseId}`,
      );
    }
  }

  return {
    ok: true,
    message:
      failed.length === 0
        ? `${results.length} Fragebogen${results.length === 1 ? "" : "bögen"} importiert.`
        : `${results.length} importiert, ${failed.length} fehlgeschlagen.`,
    results,
    failed,
  };
}

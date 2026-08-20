import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractFirstJsonObject,
  escapeControlCharsInJsonStrings,
} from "@/lib/ai/anthropic-helpers";
import { DEFAULT_SURVEY_ACTION_MODEL } from "@/lib/ai/survey-model-config";
import {
  EMPTY_FIRST_CONVERSATION,
  applyDocumentTextToFirstConversation,
  normalizeFirstConversation,
  type FirstConversationFieldKey,
  type FirstConversationRecord,
} from "@/lib/surveys/first-conversation";

/**
 * Fill empty Erstgespräch fields from meeting-summary documents.
 * Labeled sections first, then KI for remaining gaps. Never overwrites filled fields.
 */
export async function fillFirstConversationFromDocuments(input: {
  record: FirstConversationRecord;
  documentText: string;
}): Promise<{ record: FirstConversationRecord; filledKeys: FirstConversationFieldKey[] }> {
  const labeled = applyDocumentTextToFirstConversation(input.record, input.documentText);
  let record = labeled.record;
  const filledKeys = [...labeled.filledKeys];
  const text = input.documentText.trim();
  if (!text) return { record, filledKeys };

  const emptyKeys = (Object.keys(EMPTY_FIRST_CONVERSATION) as FirstConversationFieldKey[]).filter(
    (key) => !record[key].trim(),
  );
  if (emptyKeys.length === 0) return { record, filledKeys };

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { record, filledKeys };

  const anthropic = new Anthropic({ apiKey });
  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: [DEFAULT_SURVEY_ACTION_MODEL],
    maxTokens: 2500,
    timeoutMs: 45_000,
    stream: false,
    system:
      "Du liest Meeting-Zusammenfassungen und füllst nur Felder, die im Text klar stehen. Nichts erfinden. Antworte nur mit JSON.",
    messages: [
      {
        role: "user",
        content: `Leere Erstgespräch-Felder:
${emptyKeys.map((k) => `- ${k}`).join("\n")}

Dokument(e):
${text.slice(0, 18000)}

JSON: {"fields":[{"key":"legalCompanyName","value":"..."}]}
Nur keys aus der Liste. value leer lassen, wenn nicht belegt.`,
      },
    ],
  });

  if (!result) return { record, filledKeys };
  const raw = extractAnthropicText(result.response);
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) return { record, filledKeys };

  try {
    const parsed = JSON.parse(jsonText) as {
      fields?: Array<{ key?: unknown; value?: unknown }>;
    };
    const allowed = new Set(emptyKeys);
    record = { ...record };
    for (const row of parsed.fields ?? []) {
      const key = String(row.key ?? "").trim() as FirstConversationFieldKey;
      const value = String(row.value ?? "").trim();
      if (!allowed.has(key) || value.length < 2) continue;
      if (record[key].trim()) continue;
      record[key] = value.slice(0, 8000);
      filledKeys.push(key);
    }
  } catch {
    return { record: normalizeFirstConversation(record), filledKeys };
  }

  return { record: normalizeFirstConversation(record), filledKeys: [...new Set(filledKeys)] };
}

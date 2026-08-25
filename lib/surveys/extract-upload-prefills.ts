import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractFirstJsonObject,
  escapeControlCharsInJsonStrings,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyUtilityModels } from "@/lib/ai/survey-model-config";
import { parseServiceLabelList } from "@/lib/surveys/org-crawl-prefill";
import type { PrefillDraft } from "@/lib/surveys/org-crawl-prefill";

/**
 * Map uploaded meeting notes onto core question keys.
 * Separate from crawl-gap prefills so a timeout there does not drop the files.
 */
export async function extractPrefillsFromUploads(input: {
  organisationName: string;
  documentText: string;
  coreItems: Array<{ key: string; title: string }>;
}): Promise<{
  prefills: Record<string, PrefillDraft>;
  optionSets: Record<string, string[]>;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const documentText = input.documentText.trim();
  if (!apiKey || documentText.length < 40) return { prefills: {}, optionSets: {} };

  const anthropic = new Anthropic({ apiKey });
  try {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyUtilityModels(),
      maxTokens: 2800,
      timeoutMs: 25_000,
      stream: false,
      system:
        "Du füllst Fragebogen-Antworten nur aus dem Meeting-Text. Nur JSON. Nichts erfinden. Meeting schlägt Website.",
      messages: [
        {
          role: "user",
          content: `Firma: ${input.organisationName}

Hochgeladene Meeting-Notizen (Quelle der Wahrheit, aktueller als die Website):
${documentText.slice(0, 12_000)}

Kernfragen — fülle prefills nur, wenn der Text die Antwort klar hergibt. key exakt übernehmen. source immer "upload".
${input.coreItems.map((c) => `- [${c.key}] ${c.title}`).join("\n")}

Regeln:
- Wortwörtlich oder knapp zusammenfassen, keine Werbesprache erfinden.
- company_name: der im Meeting genannte aktuelle Name, auch wenn die Website noch anders heißt.
- location_catchment: Sitz und woher Patienten kommen.
- online_channels / typical_process: Buchungsweg (Doctolib, Telefon, …).
- no_fit_clients: unattraktive Anfragen oder was die Praxis nicht macht.
- usp / qualifications: echte Unterschiede aus dem Gespräch (z. B. Schulungszentrum).
- team_members: genannte Personen und Rollen.
- optionSets.portfolio: Leistungsnamen aus dem Meeting, kurz, keine Sätze.
questions=[].

{"prefills":[{"key":"location_catchment","value":"...","note":"aus Meeting","source":"upload"}],"optionSets":{"portfolio":["Leistung A"]},"questions":[]}`,
        },
      ],
    });
    if (!result) return { prefills: {}, optionSets: {} };
    const raw = extractAnthropicText(result.response);
    const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
    if (!jsonText) return { prefills: {}, optionSets: {} };
    const parsed = JSON.parse(jsonText) as {
      prefills?: Array<{ key?: unknown; value?: unknown; note?: unknown }>;
      optionSets?: Record<string, unknown>;
    };
    const allowedKeys = new Set(input.coreItems.map((c) => c.key));
    const prefills: Record<string, PrefillDraft> = {};
    for (const row of parsed.prefills ?? []) {
      const key = String(row.key ?? "").trim();
      const value = String(row.value ?? "").trim();
      if (!allowedKeys.has(key) || value.length < 3) continue;
      prefills[key] = {
        value: value.slice(0, 2000),
        source: "upload",
        note: String(row.note ?? "Aus hochgeladener Datei — bitte prüfen").slice(0, 160),
      };
    }
    const optionSets: Record<string, string[]> = {};
    if (parsed.optionSets && typeof parsed.optionSets === "object") {
      for (const [key, rawLabels] of Object.entries(parsed.optionSets)) {
        if (!Array.isArray(rawLabels)) continue;
        const labels = rawLabels
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length >= 2 && item.length <= 80);
        const cleaned =
          key === "portfolio" || key === "services_ranked"
            ? parseServiceLabelList(labels.join("\n"))
            : labels.slice(0, 10);
        if (cleaned.length >= 2) optionSets[key] = cleaned.slice(0, 10);
      }
    }
    return { prefills, optionSets };
  } catch {
    return { prefills: {}, optionSets: {} };
  }
}

import { z } from "zod";

import { tryParseJsonObject } from "@/lib/ai/anthropic-helpers";
import {
  surveyAgentPreviewSchema,
  type SurveyAgentPreview,
} from "@/lib/dt/survey-to-agent-prompt";
import {
  surveyAgentRefineSchema,
  type SurveyAgentRefinePreview,
} from "@/lib/dt/survey-refine-agent-prompt";

/**
 * Delimiter format keeps the long Markdown prompt OUTSIDE JSON strings.
 * Nested prompt_template inside JSON is the main cause of "invalid JSON" failures.
 */
export const DT_AGENT_META_START = "===DT_AGENT_META===";
export const DT_AGENT_PROMPT_START = "===DT_AGENT_PROMPT===";
export const DT_AGENT_END = "===DT_AGENT_END===";

export const SURVEY_AGENT_DELIMITER_FORMAT_INSTRUCTIONS = [
  "AUSGABEFORMAT (verbindlich — überschreibt „nur JSON“-Hinweise):",
  "Gib EXAKT dieses Format aus. Der Persona-Prompt steht als normales Markdown AUSSERHALB von JSON (keine \\n-Escapes nötig).",
  "",
  DT_AGENT_META_START,
  '{ "name": "...", "role": "...", "slug": "snake_case", "avatar_data": { ... }, "summary": "...", "quick_actions": [], "qa_hinweise": [] }',
  DT_AGENT_PROMPT_START,
  "(vollständiger deutscher Markdown-Prompt, mind. 200 Zeichen, alle Facts abdecken)",
  DT_AGENT_END,
  "",
  "Regeln:",
  "- META ist kleines JSON OHNE prompt_template.",
  "- Zwischen PROMPT und END steht nur der Prompt-Text (Markdown), kein JSON.",
  "- Keine Code-Fences um das Gesamtformat.",
  "- slug nur a-z0-9_.",
].join("\n");

export const SURVEY_AGENT_REFINE_DELIMITER_FORMAT_INSTRUCTIONS = [
  "AUSGABEFORMAT (verbindlich — überschreibt „nur JSON“-Hinweise):",
  "",
  DT_AGENT_META_START,
  '{ "summary": "...", "changed_sections": ["..."] }',
  DT_AGENT_PROMPT_START,
  "(vollständiger überarbeiteter Markdown-Prompt, mind. 200 Zeichen)",
  DT_AGENT_END,
  "",
  "META ist kleines JSON OHNE prompt_template. Der Prompt steht als Markdown zwischen PROMPT und END.",
].join("\n");

function sliceBetween(raw: string, startMarker: string, endMarker: string): string | null {
  const start = raw.indexOf(startMarker);
  if (start < 0) return null;
  const afterStart = start + startMarker.length;
  const end = raw.indexOf(endMarker, afterStart);
  if (end < 0) return raw.slice(afterStart).trim() || null;
  return raw.slice(afterStart, end).trim() || null;
}

function parseCreateFromDelimiters(
  raw: string,
  opts?: { allowIncompletePrompt?: boolean },
): SurveyAgentPreview | null {
  const metaRaw = sliceBetween(raw, DT_AGENT_META_START, DT_AGENT_PROMPT_START);
  if (!metaRaw) return null;

  const promptStart = raw.indexOf(DT_AGENT_PROMPT_START);
  if (promptStart < 0) return null;
  const afterPrompt = promptStart + DT_AGENT_PROMPT_START.length;
  const endIdx = raw.indexOf(DT_AGENT_END, afterPrompt);
  let prompt =
    endIdx >= 0 ? raw.slice(afterPrompt, endIdx).trim() : raw.slice(afterPrompt).trim();

  // Strip accidental fences around prompt only
  prompt = prompt
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (prompt.length < 200) {
    if (!opts?.allowIncompletePrompt || prompt.length < 50) return null;
  }

  const meta = tryParseJsonObject(metaRaw);
  if (!meta) return null;

  const merged = {
    ...meta,
    prompt_template: prompt,
    quick_actions: Array.isArray(meta.quick_actions) ? meta.quick_actions : [],
  };

  const schema = opts?.allowIncompletePrompt
    ? surveyAgentPreviewSchema.extend({
        prompt_template: z.string().min(50).max(120_000),
      })
    : surveyAgentPreviewSchema;

  const validated = schema.safeParse(merged);
  return validated.success ? (validated.data as SurveyAgentPreview) : null;
}

function parseRefineFromDelimiters(
  raw: string,
  opts?: { allowIncompletePrompt?: boolean },
): SurveyAgentRefinePreview | null {
  const metaRaw = sliceBetween(raw, DT_AGENT_META_START, DT_AGENT_PROMPT_START);
  if (!metaRaw) return null;

  const promptStart = raw.indexOf(DT_AGENT_PROMPT_START);
  if (promptStart < 0) return null;
  const afterPrompt = promptStart + DT_AGENT_PROMPT_START.length;
  const endIdx = raw.indexOf(DT_AGENT_END, afterPrompt);
  let prompt =
    endIdx >= 0 ? raw.slice(afterPrompt, endIdx).trim() : raw.slice(afterPrompt).trim();

  prompt = prompt
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (prompt.length < 200) {
    if (!opts?.allowIncompletePrompt || prompt.length < 50) return null;
  }

  const meta = tryParseJsonObject(metaRaw);
  if (!meta) return null;

  const merged = {
    ...meta,
    prompt_template: prompt,
  };

  const schema = opts?.allowIncompletePrompt
    ? surveyAgentRefineSchema.extend({
        prompt_template: z.string().min(50).max(120_000),
      })
    : surveyAgentRefineSchema;

  const validated = schema.safeParse(merged);
  return validated.success ? (validated.data as SurveyAgentRefinePreview) : null;
}

function parseCreateFromLegacyJson(raw: string): SurveyAgentPreview | null {
  const parsed = tryParseJsonObject(raw);
  if (!parsed) return null;
  const validated = surveyAgentPreviewSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

function parseRefineFromLegacyJson(raw: string): SurveyAgentRefinePreview | null {
  const parsed = tryParseJsonObject(raw);
  if (!parsed) return null;
  const validated = surveyAgentRefineSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

/**
 * Parse create-agent model output (delimiter format preferred, legacy JSON fallback).
 * When truncated at max_tokens, allowIncompletePrompt accepts a long enough partial prompt.
 */
export function parseSurveyAgentCreateOutput(
  raw: string,
  opts?: { truncated?: boolean },
): SurveyAgentPreview | null {
  const fromDelim = parseCreateFromDelimiters(raw, {
    allowIncompletePrompt: Boolean(opts?.truncated),
  });
  if (fromDelim) return fromDelim;
  return parseCreateFromLegacyJson(raw);
}

export function parseSurveyAgentRefineOutput(
  raw: string,
  opts?: { truncated?: boolean },
): SurveyAgentRefinePreview | null {
  const fromDelim = parseRefineFromDelimiters(raw, {
    allowIncompletePrompt: Boolean(opts?.truncated),
  });
  if (fromDelim) return fromDelim;
  return parseRefineFromLegacyJson(raw);
}

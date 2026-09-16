import { sanitizeWebsiteStructureText } from "@/lib/dt/seo/website-structure";

import { DT_TRANSCRIPT_MAX_RAW_CHARS } from "@/lib/dt/transcripts/types";

export function sanitizeTranscriptText(text: string): string {
  return sanitizeWebsiteStructureText(text).replace(/\r\n/g, "\n");
}

export function clipTranscriptRaw(text: string): string {
  const trimmed = sanitizeTranscriptText(text).trim();
  if (trimmed.length <= DT_TRANSCRIPT_MAX_RAW_CHARS) return trimmed;
  return trimmed.slice(0, DT_TRANSCRIPT_MAX_RAW_CHARS);
}

export function slugFromPersonaName(name: string): string {
  const mapped = name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return mapped || "persona";
}

export function normalizePersonaKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

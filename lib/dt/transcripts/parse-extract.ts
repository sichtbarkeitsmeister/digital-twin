import { z } from "zod";

import type {
  DtTranscriptExtract,
  DtTranscriptPersonaExtract,
} from "@/lib/dt/transcripts/types";

const personaSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().max(200).nullable().optional(),
  priority: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const t = value.trim().toUpperCase();
    return t === "A" || t === "B" || t === "C" ? t : undefined;
  }, z.enum(["A", "B", "C"]).optional()),
  isPrimary: z.boolean().optional(),
  is_primary: z.boolean().optional(),
  description: z.string().trim().max(4000).optional().default(""),
  goals: z.string().trim().max(2000).nullable().optional(),
  pains: z.string().trim().max(2000).nullable().optional(),
  objections: z.string().trim().max(2000).nullable().optional(),
  language: z.string().trim().max(1000).nullable().optional(),
  buyingTriggers: z.string().trim().max(2000).nullable().optional(),
  buying_triggers: z.string().trim().max(2000).nullable().optional(),
  promptAppend: z.string().trim().max(12_000).optional(),
  prompt_append: z.string().trim().max(12_000).optional(),
});

const extractSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().min(1).max(4000),
  anbieterMarkdown: z.string().trim().max(20_000).optional(),
  anbieter_markdown: z.string().trim().max(20_000).optional(),
  personas: z.array(z.unknown()).max(8).optional().default([]),
});

function emptyToNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t ? t : null;
}

function normalizePersona(raw: z.infer<typeof personaSchema>): DtTranscriptPersonaExtract | null {
  const promptAppend = (raw.promptAppend ?? raw.prompt_append ?? "").trim();
  const description = raw.description.trim();
  if (!description && promptAppend.length < 120) return null;
  const priority = raw.priority ?? "A";
  return {
    name: raw.name.trim(),
    role: emptyToNull(raw.role),
    priority,
    isPrimary: Boolean(raw.isPrimary ?? raw.is_primary ?? priority === "A"),
    description: description || promptAppend.slice(0, 800),
    goals: emptyToNull(raw.goals),
    pains: emptyToNull(raw.pains),
    objections: emptyToNull(raw.objections),
    language: emptyToNull(raw.language),
    buyingTriggers: emptyToNull(raw.buyingTriggers ?? raw.buying_triggers),
    promptAppend:
      promptAppend ||
      [
        `Ich bin ${raw.name.trim()}${raw.role ? `, ${raw.role.trim()}` : ""}.`,
        description,
        raw.goals ? `Was mir wichtig ist: ${raw.goals}` : "",
        raw.pains ? `Was mich belastet: ${raw.pains}` : "",
        raw.objections ? `Worüber ich stolpere: ${raw.objections}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  };
}

export function parseTranscriptExtractJson(raw: unknown): DtTranscriptExtract {
  const parsed = extractSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Die Auswertung des Transkripts war unvollständig. Bitte erneut versuchen.");
  }
  const data = parsed.data;
  const personas = (data.personas ?? [])
    .map((item) => {
      const persona = personaSchema.safeParse(item);
      return persona.success ? normalizePersona(persona.data) : null;
    })
    .filter((p): p is DtTranscriptPersonaExtract => p != null)
    .slice(0, 6);
  if (personas.length > 0 && !personas.some((p) => p.isPrimary)) {
    personas[0]!.isPrimary = true;
  }
  return {
    title: emptyToNull(data.title),
    summary: data.summary.trim(),
    anbieterMarkdown: (data.anbieterMarkdown ?? data.anbieter_markdown ?? "").trim(),
    personas,
  };
}

export function personasFromJson(raw: unknown): DtTranscriptPersonaExtract[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const parsed = personaSchema.safeParse(item);
      if (!parsed.success) return null;
      return normalizePersona(parsed.data);
    })
    .filter((p): p is DtTranscriptPersonaExtract => p != null);
}

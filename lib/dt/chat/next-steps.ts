/**
 * „Nächste Schritte“ under an assistant answer: the model appends a fenced `dt-next` block
 * with up to four buttons; a click sends the button's message as the user's next turn.
 * The block is stripped from the visible text and stored on the message metadata.
 */

import { z } from "zod";

const stepSchema = z.object({
  label: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
});

export type DtChatNextStep = z.infer<typeof stepSchema>;

export const DT_NEXT_STEPS_MAX = 4;
const DT_NEXT_FENCE_RE = /```(?:dt-next|json:dt-next)\s*\n([\s\S]*?)```/gi;

export function parseDtNextStepsFromText(text: string): DtChatNextStep[] {
  const steps: DtChatNextStep[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DT_NEXT_FENCE_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      const json = JSON.parse(body) as unknown;
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const parsed = stepSchema.safeParse(item);
        if (!parsed.success) continue;
        const key = parsed.data.message.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        steps.push(parsed.data);
      }
    } catch {
      continue;
    }
  }
  return steps.slice(0, DT_NEXT_STEPS_MAX);
}

export function stripDtNextStepBlocks(text: string): string {
  return text.replace(DT_NEXT_FENCE_RE, "").trimEnd();
}

export function extractDtNextStepsFromMessage(input: {
  content: string;
  metadata?: Record<string, unknown> | null;
}): DtChatNextStep[] {
  const raw = input.metadata?.next_steps;
  if (Array.isArray(raw)) {
    const fromMeta = raw
      .map((item) => stepSchema.safeParse(item))
      .filter((r): r is { success: true; data: DtChatNextStep } => r.success)
      .map((r) => r.data);
    if (fromMeta.length > 0) return fromMeta.slice(0, DT_NEXT_STEPS_MAX);
  }
  return parseDtNextStepsFromText(input.content);
}

export const DT_NEXT_STEPS_INSTRUCTIONS = `
## Nächste Schritte als Buttons
Schließe jede Antwort, nach der der Nutzer etwas entscheiden oder bestätigen soll, mit genau einem Block ab (wird im Chat als Buttons gezeigt, nicht als Text):

\`\`\`dt-next
[{"label":"Hub-Entwurf jetzt erstellen","message":"Ja, erstelle den Hub-Entwurf unter https://…/grounding/."}]
\`\`\`

Regeln: 1–4 Einträge; label kurz (max. 6 Wörter); message = die vollständige Bestätigung, die der Nutzer sonst tippen würde (mit allen nötigen Angaben wie URL oder Name), damit du sie beim nächsten Zug direkt ausführen kannst. Der erste Eintrag ist der empfohlene Schritt. Kein Block bei reinen Rückfragen ohne klare Optionen.
`.trim();

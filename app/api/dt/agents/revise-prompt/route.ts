import { NextResponse } from "next/server";
import { z } from "zod";

import { callDtAnthropicChat } from "@/lib/dt/anthropic-chat";
import { requireAuthUser } from "@/lib/dt/db";
import { canManageDtAgents } from "@/lib/dt/org-access";
import {
  AGENT_PROMPT_REVISE_SYSTEM,
  buildAgentPromptReviseUserMessage,
  normalizeRevisedPromptText,
} from "@/lib/dt/prompts/revise-agent-prompt";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { createServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agentName: z.string().trim().min(1).max(120),
  agentRole: z.string().trim().max(200).nullable().optional(),
  target: z.enum(["prompt", "prompt_append"]).default("prompt"),
  currentPrompt: z.string().trim().min(20).max(120_000),
  instruction: z.string().trim().min(3).max(4_000),
});

/**
 * Natural-language prompt edit for the Agents UI.
 * Returns a full revised draft — caller applies it to the form and saves.
 */
export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const allowed = await canManageDtAgents(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung für diese Organisation." },
      { status: 403 },
    );
  }

  try {
    const direct = await callDtAnthropicChat({
      system: AGENT_PROMPT_REVISE_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildAgentPromptReviseUserMessage({
            agentName: parsed.data.agentName,
            agentRole: parsed.data.agentRole,
            target: parsed.data.target,
            currentPrompt: parsed.data.currentPrompt,
            instruction: parsed.data.instruction,
          }),
        },
      ],
      mode: "ghost",
    });

    const revisedPrompt = normalizeRevisedPromptText(direct.text);
    if (revisedPrompt.length < 20) {
      return NextResponse.json(
        { ok: false, message: "Die KI lieferte keinen brauchbaren Prompt." },
        { status: 502 },
      );
    }

    if (direct.usage.inputTokens > 0 || direct.usage.outputTokens > 0) {
      const service = createServiceClient();
      await recordLlmUsageEvent(service, {
        organisationId: parsed.data.organisationId,
        userId: auth.userId,
        mode: "ghost",
        via: "ghost",
        model: direct.model,
        inputTokens: direct.usage.inputTokens,
        outputTokens: direct.usage.outputTokens,
      });
    }

    return NextResponse.json({
      ok: true,
      revisedPrompt,
      model: direct.model,
      summary: "Prompt-Entwurf aktualisiert — bitte prüfen und speichern.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prompt-Anpassung fehlgeschlagen.";
    console.warn("[dt] revise-prompt:", message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

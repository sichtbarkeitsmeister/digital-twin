import { NextResponse } from "next/server";
import { z } from "zod";

import { callDtAnthropicChat } from "@/lib/dt/anthropic-chat";
import { requireAuthUser } from "@/lib/dt/db";
import { canManageDtAgents } from "@/lib/dt/org-access";
import { buildDtSystemPrompt } from "@/lib/dt/prompts/build-system-prompt";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { createServiceClient } from "@/lib/supabase/service";

const historySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(32_000),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(200).nullable().optional(),
  promptTemplate: z.string().trim().min(40).max(120_000),
  content: z.string().trim().min(1).max(8_000),
  history: z.array(historySchema).max(40).default([]),
});

/**
 * Ephemeral probe chat against an unsaved survey→agent preview.
 * Does not create dt_agents / dt_chats rows.
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

  const { data: orgConfig } = await auth.supabase
    .from("dt_org_config")
    .select("display_name, website_url")
    .eq("organisation_id", parsed.data.organisationId)
    .maybeSingle();

  const { data: org } = await auth.supabase
    .from("organisations")
    .select("name")
    .eq("id", parsed.data.organisationId)
    .maybeSingle();

  const system = buildDtSystemPrompt({
    agent: {
      name: parsed.data.name,
      role: parsed.data.role?.trim() || null,
      prompt_template: parsed.data.promptTemplate,
      kind: "persona",
      slug: "preview_persona",
    },
    org: {
      display_name: orgConfig?.display_name?.trim() || org?.name || parsed.data.name,
      website_url: orgConfig?.website_url,
    },
    mode: "ghost",
    ghostMode: true,
  });

  const messages = [
    ...parsed.data.history.slice(-30).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: parsed.data.content },
  ];

  try {
    const direct = await callDtAnthropicChat({
      system,
      messages,
      mode: "ghost",
    });

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
      reply: direct.text,
      model: direct.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Probe-Chat fehlgeschlagen.";
    console.warn("[dt] preview-agent-chat:", message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

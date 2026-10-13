import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  isDefaultGroundingModeInstructions,
  resolveGroundingModeInstructions,
} from "@/lib/dt/prompts/grounding-mode";
import {
  GROUNDING_PAGES_RULES_MIGRATION_MESSAGE,
  GROUNDING_RULES_MAX_CHARS,
  loadGroundingPagesRules,
} from "@/lib/dt/prompts/grounding-pages-rules";
import {
  isDefaultGroundingAgentBase,
  isDefaultGroundingAgentStandard,
  resolveGroundingAgentRules,
} from "@/lib/dt/seo/grounding-run/prompts";

const text = z.string().max(GROUNDING_RULES_MAX_CHARS, "Ein Regeltext ist zu lang (maximal 100.000 Zeichen).");

const patchSchema = z.object({
  modePrompt: text,
  agentBase: text,
  agentStandard: text,
});

function missingColumn(message: string): boolean {
  return (
    /grounding_mode_prompt|grounding_agent_base_prompt|grounding_agent_standard_prompt|schema cache/i.test(
      message,
    ) && /does not exist|schema cache/i.test(message)
  );
}

function payload(input: {
  mode: string | null;
  base: string | null;
  standard: string | null;
  persisted: boolean;
  message: string | null;
}) {
  const agent = resolveGroundingAgentRules({ base: input.base, standard: input.standard });
  return {
    ok: true as const,
    modePrompt: resolveGroundingModeInstructions(input.mode),
    agentBase: agent.base,
    agentStandard: agent.standard,
    modeIsDefault: isDefaultGroundingModeInstructions(input.mode),
    agentBaseIsDefault: isDefaultGroundingAgentBase(input.base),
    agentStandardIsDefault: isDefaultGroundingAgentStandard(input.standard),
    persisted: input.persisted,
    message: input.message,
  };
}

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const state = await loadGroundingPagesRules(auth.supabase);
  return NextResponse.json({
    ok: true,
    modePrompt: state.modePrompt,
    agentBase: state.agentBase,
    agentStandard: state.agentStandard,
    modeIsDefault: state.modeIsDefault,
    agentBaseIsDefault: state.agentBaseIsDefault,
    agentStandardIsDefault: state.agentStandardIsDefault,
    persisted: state.persisted,
    message: state.message,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Die Grounding-Regeln kann nur ein Administrator ändern." },
      { status: 403 },
    );
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const mode = parsed.data.modePrompt.trim();
  const base = parsed.data.agentBase.trim();
  const standard = parsed.data.agentStandard.trim();
  const next = {
    id: "default",
    grounding_mode_prompt: !mode || isDefaultGroundingModeInstructions(mode) ? null : mode,
    grounding_agent_base_prompt: !base || isDefaultGroundingAgentBase(base) ? null : base,
    grounding_agent_standard_prompt:
      !standard || isDefaultGroundingAgentStandard(standard) ? null : standard,
  };

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .upsert(next, { onConflict: "id" })
    .select("grounding_mode_prompt, grounding_agent_base_prompt, grounding_agent_standard_prompt")
    .single();

  if (error || !data) {
    const message = error?.message ?? "Speichern fehlgeschlagen.";
    if (missingColumn(message)) {
      return NextResponse.json(
        { ok: false, message: GROUNDING_PAGES_RULES_MIGRATION_MESSAGE },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }

  return NextResponse.json(
    payload({
      mode: typeof data.grounding_mode_prompt === "string" ? data.grounding_mode_prompt : null,
      base:
        typeof data.grounding_agent_base_prompt === "string"
          ? data.grounding_agent_base_prompt
          : null,
      standard:
        typeof data.grounding_agent_standard_prompt === "string"
          ? data.grounding_agent_standard_prompt
          : null,
      persisted: true,
      message: null,
    }),
  );
}

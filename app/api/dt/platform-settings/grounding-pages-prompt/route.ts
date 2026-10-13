import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  GROUNDING_PAGES_RULES_MAX_CHARS,
  isDefaultGroundingPagesRules,
  resolveGroundingPagesRules,
} from "@/lib/dt/prompts/grounding-pages-prompt";
import {
  GROUNDING_PAGES_RULES_MIGRATION_MESSAGE,
  loadGroundingPagesRules,
} from "@/lib/dt/prompts/grounding-pages-rules";

const patchSchema = z.object({
  prompt: z
    .string()
    .max(
      GROUNDING_PAGES_RULES_MAX_CHARS,
      "Die Regeln sind zu lang (maximal 100.000 Zeichen).",
    ),
});

function missingColumn(message: string): boolean {
  return /grounding_pages_prompt|schema cache|does not exist/i.test(message);
}

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const state = await loadGroundingPagesRules(auth.supabase);
  return NextResponse.json({
    ok: true,
    prompt: state.prompt,
    isDefault: state.isDefault,
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

  const trimmed = parsed.data.prompt.trim();
  const nextStored = !trimmed || isDefaultGroundingPagesRules(trimmed) ? null : trimmed;

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .upsert({ id: "default", grounding_pages_prompt: nextStored }, { onConflict: "id" })
    .select("grounding_pages_prompt")
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

  const stored =
    typeof data.grounding_pages_prompt === "string" ? data.grounding_pages_prompt : null;
  return NextResponse.json({
    ok: true,
    prompt: resolveGroundingPagesRules(stored),
    isDefault: isDefaultGroundingPagesRules(stored),
    persisted: true,
    message: null,
  });
}

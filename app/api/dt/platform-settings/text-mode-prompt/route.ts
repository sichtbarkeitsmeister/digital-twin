import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
  resolveTextModeInstructions,
} from "@/lib/dt/prompts/text-mode";

const patchSchema = z.object({
  prompt: z.string().max(20_000),
});

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .select("text_mode_prompt")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const stored =
    typeof data?.text_mode_prompt === "string" ? data.text_mode_prompt.trim() : "";
  const prompt = resolveTextModeInstructions(stored);

  return NextResponse.json({
    ok: true,
    prompt,
    isDefault: !stored || stored === DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Der Text-Modus-Prompt kann nur von Administratoren bearbeitet werden." },
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
  const nextStored =
    !trimmed || trimmed === DT_DEFAULT_TEXT_MODE_INSTRUCTIONS ? null : trimmed;

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .upsert(
      { id: "default", text_mode_prompt: nextStored },
      { onConflict: "id" },
    )
    .select("text_mode_prompt")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  const stored =
    typeof data.text_mode_prompt === "string" ? data.text_mode_prompt.trim() : "";
  const prompt = resolveTextModeInstructions(stored);

  return NextResponse.json({
    ok: true,
    prompt,
    isDefault: !stored || stored === DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
  });
}

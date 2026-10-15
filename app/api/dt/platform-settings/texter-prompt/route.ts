import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  DEFAULT_TEXTER_PROMPT,
  TEXTER_PROMPT_MAX_CHARS,
  TEXTER_PROMPT_MIGRATION_FILE,
  isDefaultTexterPrompt,
  resolveTexterPrompt,
} from "@/lib/dt/content/texter-prompt";

const patchSchema = z.object({
  prompt: z.string().max(TEXTER_PROMPT_MAX_CHARS),
});

function missingColumn(message: string): boolean {
  return /texter_prompt|schema cache/i.test(message) && /does not exist|schema cache/i.test(message);
}

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Nur für Administratoren." }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .select("texter_prompt")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    if (missingColumn(error.message)) {
      return NextResponse.json({
        ok: true,
        prompt: DEFAULT_TEXTER_PROMPT,
        isDefault: true,
        persisted: false,
        message: `Die Datenbank kennt den Text-Prompt noch nicht: Bitte ${TEXTER_PROMPT_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin gilt der Standard, Speichern ist noch nicht möglich.`,
      });
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const stored = typeof data?.texter_prompt === "string" ? data.texter_prompt : null;
  return NextResponse.json({
    ok: true,
    prompt: resolveTexterPrompt(stored),
    isDefault: isDefaultTexterPrompt(stored),
    persisted: true,
    message: null,
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Der Text-Prompt kann nur von Administratoren bearbeitet werden." },
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

  const trimmed = parsed.data.prompt.replace(/\r\n?/g, "\n").trim();
  const nextStored = !trimmed || trimmed === DEFAULT_TEXTER_PROMPT ? null : trimmed.slice(0, TEXTER_PROMPT_MAX_CHARS);

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .upsert({ id: "default", texter_prompt: nextStored }, { onConflict: "id" })
    .select("texter_prompt")
    .single();

  if (error || !data) {
    if (error && missingColumn(error.message)) {
      return NextResponse.json(
        {
          ok: false,
          message: `Die Datenbank kennt den Text-Prompt noch nicht: Bitte ${TEXTER_PROMPT_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  const stored = typeof data.texter_prompt === "string" ? data.texter_prompt : null;
  return NextResponse.json({
    ok: true,
    prompt: resolveTexterPrompt(stored),
    isDefault: isDefaultTexterPrompt(stored),
    persisted: true,
    message: null,
  });
}

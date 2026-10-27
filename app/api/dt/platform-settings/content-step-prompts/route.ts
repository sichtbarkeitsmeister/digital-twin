import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  CONTENT_STEP_PROMPT_KEYS,
  CONTENT_STEP_PROMPT_MAX_CHARS,
  CONTENT_STEP_PROMPTS_MIGRATION_FILE,
  DEFAULT_CONTENT_STEP_PROMPTS,
  normalizeStoredContentStepPrompts,
  resolveContentStepPrompts,
  type ContentStepPromptKey,
} from "@/lib/dt/content/step-prompts";

const patchSchema = z.object({
  key: z.enum(CONTENT_STEP_PROMPT_KEYS),
  prompt: z.string().max(CONTENT_STEP_PROMPT_MAX_CHARS, `Höchstens ${CONTENT_STEP_PROMPT_MAX_CHARS.toLocaleString("de-DE")} Zeichen.`),
});

function missingColumn(message: string): boolean {
  return /content_step_prompts|schema cache/i.test(message) && /does not exist|schema cache/i.test(message);
}

/** What the cards show (one per key of `CONTENT_STEP_PROMPT_KEYS`): the effective text per step and which ones are own texts. */
function payload(stored: unknown, persisted: boolean, message: string | null) {
  const own = normalizeStoredContentStepPrompts(stored);
  return {
    ok: true,
    prompts: resolveContentStepPrompts(stored),
    custom: Object.fromEntries(CONTENT_STEP_PROMPT_KEYS.map((key) => [key, key in own])) as Record<ContentStepPromptKey, boolean>,
    persisted,
    message,
  };
}

async function gate() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 }) };
  }
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Die Schritt-Prompts können nur von Administratoren bearbeitet werden." },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, supabase: auth.supabase };
}

export async function GET() {
  const gated = await gate();
  if (!gated.ok) return gated.response;

  const { data, error } = await gated.supabase
    .from("dt_platform_settings")
    .select("content_step_prompts")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    if (missingColumn(error.message)) {
      return NextResponse.json(
        payload(
          null,
          false,
          `Die Datenbank kennt die Schritt-Prompts noch nicht: Bitte ${CONTENT_STEP_PROMPTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin gelten die Standards, Speichern ist noch nicht möglich.`,
        ),
      );
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json(payload((data as { content_step_prompts?: unknown } | null)?.content_step_prompts, true, null));
}

/** Saves one step; the other five stay as they are. An empty text (or the default) means the default. */
export async function PATCH(req: Request) {
  const gated = await gate();
  if (!gated.ok) return gated.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const { key } = parsed.data;
  const text = parsed.data.prompt.replace(/\r\n?/g, "\n").trim();

  const { data: current, error: readError } = await gated.supabase
    .from("dt_platform_settings")
    .select("content_step_prompts")
    .eq("id", "default")
    .maybeSingle();
  if (readError) {
    const message = missingColumn(readError.message)
      ? `Die Datenbank kennt die Schritt-Prompts noch nicht: Bitte ${CONTENT_STEP_PROMPTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`
      : readError.message;
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }

  const next = normalizeStoredContentStepPrompts((current as { content_step_prompts?: unknown } | null)?.content_step_prompts);
  if (!text || text === DEFAULT_CONTENT_STEP_PROMPTS[key]) delete next[key];
  else next[key] = text;
  const stored = Object.keys(next).length > 0 ? next : null;

  const { data, error } = await gated.supabase
    .from("dt_platform_settings")
    .upsert({ id: "default", content_step_prompts: stored }, { onConflict: "id" })
    .select("content_step_prompts")
    .single();
  if (error || !data) {
    const message =
      error && missingColumn(error.message)
        ? `Die Datenbank kennt die Schritt-Prompts noch nicht: Bitte ${CONTENT_STEP_PROMPTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`
        : (error?.message ?? "Speichern fehlgeschlagen.");
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
  return NextResponse.json(payload((data as { content_step_prompts?: unknown }).content_step_prompts, true, null));
}

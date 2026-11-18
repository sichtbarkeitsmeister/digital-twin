import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  CONTENT_CORE_RULES_MAX_CHARS,
  CONTENT_CORE_RULES_MIGRATION_FILE,
  isMissingCoreRulesColumn,
  resolveContentCoreRules,
} from "@/lib/dt/content/core-rules";

const patchSchema = z.object({
  // Checked again after trimming; this bound only keeps absurd bodies out.
  rules: z.string().max(CONTENT_CORE_RULES_MAX_CHARS * 4, "Die Kernregeln sind zu lang."),
});

const MIGRATION_MESSAGE = `Die Datenbank kennt die Kernregeln noch nicht: Bitte ${CONTENT_CORE_RULES_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`;

async function admin() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) return { error: NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 }) } as const;
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return { error: NextResponse.json({ ok: false, message: "Die Kernregeln können nur Administratoren bearbeiten." }, { status: 403 }) } as const;
  }
  return { supabase: auth.supabase } as const;
}

/** The Kernregeln of Texte (Globale Prompts): one text for every step. */
export async function GET() {
  const gate = await admin();
  if ("error" in gate) return gate.error;
  const { data, error } = await gate.supabase.from("dt_platform_settings").select("content_core_rules").eq("id", "default").maybeSingle();
  if (error) {
    if (isMissingCoreRulesColumn(error.message)) {
      return NextResponse.json({ ok: true, rules: "", persisted: false, message: `${MIGRATION_MESSAGE} Bis dahin gibt es keine Kernregeln, Speichern ist noch nicht möglich.` });
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  const stored = (data as { content_core_rules?: unknown } | null)?.content_core_rules;
  return NextResponse.json({ ok: true, rules: resolveContentCoreRules(typeof stored === "string" ? stored : null), persisted: true, message: null });
}

export async function PATCH(req: Request) {
  const gate = await admin();
  if ("error" in gate) return gate.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." }, { status: 400 });
  }
  const trimmed = parsed.data.rules.replace(/\r\n?/g, "\n").trim();
  // Never cut to fit: the end of the rules would be missing without anyone noticing.
  if (trimmed.length > CONTENT_CORE_RULES_MAX_CHARS) {
    const n = (value: number) => value.toLocaleString("de-DE");
    return NextResponse.json(
      {
        ok: false,
        message: `Die Kernregeln haben ${n(trimmed.length)} Zeichen, erlaubt sind ${n(CONTENT_CORE_RULES_MAX_CHARS)}. Sie wurden nicht gespeichert; es gilt weiter die zuletzt gespeicherte Fassung.`,
      },
      { status: 400 },
    );
  }
  const { data, error } = await gate.supabase
    .from("dt_platform_settings")
    .upsert({ id: "default", content_core_rules: trimmed || null }, { onConflict: "id" })
    .select("content_core_rules")
    .single();
  if (error || !data) {
    if (error && isMissingCoreRulesColumn(error.message)) return NextResponse.json({ ok: false, message: MIGRATION_MESSAGE }, { status: 500 });
    return NextResponse.json({ ok: false, message: error?.message ?? "Speichern fehlgeschlagen." }, { status: 500 });
  }
  const stored = (data as { content_core_rules?: unknown }).content_core_rules;
  return NextResponse.json({ ok: true, rules: resolveContentCoreRules(typeof stored === "string" ? stored : null), persisted: true, message: null });
}

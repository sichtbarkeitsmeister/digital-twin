import { NextResponse } from "next/server";
import { z } from "zod";

import { MIX_PROMPT_MIGRATION_FILE, MIX_PROMPT_NAME, MIX_PROMPT_SLUG } from "@/lib/dt/agents/mix-prompt";
import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";

import { SURVEY_AGENT_GLOBAL_PROMPT_SLUGS } from "@/lib/dt/survey-agent-global-prompts";
import {
  AVATAR_GENERATOR_PROMPT_MIGRATION_FILE,
  AVATAR_GENERATOR_PROMPT_NAME,
  AVATAR_GENERATOR_PROMPT_SLUG,
} from "@/lib/dt/transcripts/avatar-generator-prompt";

const GLOBAL_PROMPT_SLUGS = [
  "default",
  "seo_advisor",
  ...SURVEY_AGENT_GLOBAL_PROMPT_SLUGS,
  AVATAR_GENERATOR_PROMPT_SLUG,
  MIX_PROMPT_SLUG,
] as const;

/** Prompts added by a migration of their own: name and file for the hint when it has not run. */
const PROMPT_MIGRATIONS: Partial<Record<(typeof GLOBAL_PROMPT_SLUGS)[number], { name: string; file: string }>> = {
  [AVATAR_GENERATOR_PROMPT_SLUG]: { name: AVATAR_GENERATOR_PROMPT_NAME, file: AVATAR_GENERATOR_PROMPT_MIGRATION_FILE },
  [MIX_PROMPT_SLUG]: { name: MIX_PROMPT_NAME, file: MIX_PROMPT_MIGRATION_FILE },
};

const patchSchema = z.object({
  slug: z.enum(GLOBAL_PROMPT_SLUGS),
  prompt: z.string().trim().min(1).max(32_000),
});

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("dt_agent_templates")
    .select("slug,name,default_prompt")
    .in("slug", [...GLOBAL_PROMPT_SLUGS]);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const prompts: Record<string, string> = {};
  for (const row of data ?? []) {
    prompts[row.slug] = row.default_prompt ?? "";
  }

  return NextResponse.json({ ok: true, prompts });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Globale Prompts können nur von Administratoren bearbeitet werden." },
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

  const { error } = await auth.supabase.rpc("dt_update_default_prompt", {
    p_slug: parsed.data.slug,
    p_prompt: parsed.data.prompt,
  });

  if (error) {
    // Before the migration the function does not accept the slug, or the row is missing.
    const migration = PROMPT_MIGRATIONS[parsed.data.slug];
    const missingMigration = migration && /invalid_slug|template_not_found/.test(error.message ?? "") ? migration : null;
    return NextResponse.json(
      {
        ok: false,
        message: missingMigration
          ? `Die Datenbank kennt den Prompt „${missingMigration.name}“ noch nicht: Bitte ${missingMigration.file} einmal im Supabase SQL Editor ausführen. Bis dahin gilt der Standard.`
          : error.message || "Speichern fehlgeschlagen.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

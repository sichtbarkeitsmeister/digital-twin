import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureSurveyAiUserPreferences,
  SURVEY_AI_MAX_ASSISTANT_RULES_CHARS,
} from "@/lib/settings/survey-ai-server";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  autoNavigate: z.boolean().optional(),
  showArchivedChats: z.boolean().optional(),
  globalAssistantRules: z.string().max(SURVEY_AI_MAX_ASSISTANT_RULES_CHARS).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const ensured = await ensureSurveyAiUserPreferences(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json({ ok: false, message: ensured.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    preferences: {
      autoNavigate: ensured.prefs.auto_navigate,
      showArchivedChats: ensured.prefs.show_archived_chats,
      globalAssistantRules: ensured.prefs.global_assistant_rules,
      updatedAt: ensured.prefs.updated_at,
    },
  });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const ensured = await ensureSurveyAiUserPreferences(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json({ ok: false, message: ensured.message }, { status: 500 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.autoNavigate !== undefined) patch.auto_navigate = parsed.data.autoNavigate;
  if (parsed.data.showArchivedChats !== undefined)
    patch.show_archived_chats = parsed.data.showArchivedChats;
  if (parsed.data.globalAssistantRules !== undefined)
    patch.global_assistant_rules = parsed.data.globalAssistantRules;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen übergeben." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("survey_ai_user_preferences")
    .update(patch)
    .eq("user_id", user.id)
    .select("user_id,auto_navigate,show_archived_chats,global_assistant_rules,updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Speichern fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    preferences: {
      autoNavigate: data.auto_navigate,
      showArchivedChats: data.show_archived_chats,
      globalAssistantRules: data.global_assistant_rules,
      updatedAt: data.updated_at,
    },
  });
}

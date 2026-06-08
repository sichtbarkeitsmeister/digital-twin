import { NextResponse } from "next/server";
import { z } from "zod";

import {
  DT_MAX_ASSISTANT_RULES_CHARS,
  ensureDtUserPreferences,
} from "@/lib/settings/dt-user-preferences-server";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  showArchivedChats: z.boolean().optional(),
  globalAssistantRules: z.string().max(DT_MAX_ASSISTANT_RULES_CHARS).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const ensured = await ensureDtUserPreferences(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json({ ok: false, message: ensured.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    preferences: {
      showArchivedChats: ensured.prefs.show_archived_chats,
      globalAssistantRules: ensured.prefs.global_assistant_rules,
      defaultAgentId: ensured.prefs.default_agent_id,
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
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const ensured = await ensureDtUserPreferences(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json({ ok: false, message: ensured.message }, { status: 500 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.showArchivedChats !== undefined) {
    patch.show_archived_chats = parsed.data.showArchivedChats;
  }
  if (parsed.data.globalAssistantRules !== undefined) {
    patch.global_assistant_rules = parsed.data.globalAssistantRules;
  }
  if (parsed.data.defaultAgentId !== undefined) {
    patch.default_agent_id = parsed.data.defaultAgentId;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen übergeben." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dt_user_preferences")
    .update(patch)
    .eq("user_id", user.id)
    .select("user_id,global_assistant_rules,show_archived_chats,default_agent_id,updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Speichern fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    preferences: {
      showArchivedChats: data.show_archived_chats,
      globalAssistantRules: data.global_assistant_rules,
      defaultAgentId: data.default_agent_id,
      updatedAt: data.updated_at,
    },
  });
}

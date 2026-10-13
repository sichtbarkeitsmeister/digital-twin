import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  groundingCommandTitle,
  groundingStartDraft,
  type GroundingCommand,
} from "@/lib/dt/seo/grounding-pages";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  command: z.enum(["erstelle", "pruefe", "aktualisiere"]),
});

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

  const orgId = parsed.data.organisationId;
  const command = parsed.data.command as GroundingCommand;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { data: agents, error: agentError } = await auth.supabase
    .from("dt_agents")
    .select("id, slug, kind")
    .eq("organisation_id", orgId)
    .eq("is_enabled", true);

  if (agentError) {
    return NextResponse.json({ ok: false, message: agentError.message }, { status: 500 });
  }

  const advisor =
    agents?.find((agent) => agent.slug === "seo_advisor") ??
    agents?.find((agent) => agent.kind === "seo_advisor");
  if (!advisor) {
    return NextResponse.json(
      { ok: false, message: "Kein SEO-Berater für diese Organisation gefunden." },
      { status: 404 },
    );
  }

  const { data: config } = await auth.supabase
    .from("dt_org_config")
    .select("grounding_page_url")
    .eq("organisation_id", orgId)
    .maybeSingle();

  const hasHub = Boolean(config?.grounding_page_url?.trim());
  const { data: chatId, error: chatError } = await auth.supabase.rpc("dt_create_chat", {
    p_organisation_id: orgId,
    p_agent_id: advisor.id,
    p_mode: "seo",
    p_title: groundingCommandTitle(command),
  });

  if (chatError || typeof chatId !== "string") {
    return NextResponse.json(
      { ok: false, message: chatError?.message ?? "Chat konnte nicht erstellt werden." },
      { status: 500 },
    );
  }

  const { error: jobError } = await auth.supabase.from("dt_grounding_jobs").insert({
    chat_id: chatId,
    organisation_id: orgId,
    command,
    created_by: auth.userId,
  });

  if (jobError) {
    await auth.supabase.from("dt_chats").delete().eq("id", chatId);
    const missingTable = /dt_grounding_jobs|schema cache|does not exist/i.test(jobError.message);
    return NextResponse.json(
      {
        ok: false,
        message: missingTable
          ? "Die Migration 20261012_dt_grounding_entity_pages.sql ist noch nicht eingespielt."
          : jobError.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    chatId,
    draft: groundingStartDraft(command, hasHub),
    command,
  });
}

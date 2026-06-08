import { NextResponse } from "next/server";
import { z } from "zod";

import { createDtChat, listDtChats, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import type { DtChatMode } from "@/lib/dt/types";

const listSchema = z.object({
  org: z.string().uuid(),
  scope: z.enum(["mine", "team", "all"]).default("mine"),
  mode: z.enum(["default", "seo", "team"]).optional(),
  archived: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

const createSchema = z.object({
  organisationId: z.string().uuid(),
  agentId: z.string().uuid(),
  mode: z.enum(["default", "seo", "team", "ghost"]).default("default"),
  title: z.string().trim().max(120).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = listSchema.safeParse({
    org: url.searchParams.get("org"),
    scope: url.searchParams.get("scope") ?? "mine",
    mode: url.searchParams.get("mode") ?? undefined,
    archived: url.searchParams.get("archived") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Parameter." }, { status: 400 });
  }

  if (parsed.data.mode === "seo") {
    const gate = await requireDtSeoAccess(
      auth.supabase,
      auth.userId!,
      parsed.data.org,
    );
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const chats = await listDtChats({
    organisationId: parsed.data.org,
    scope: parsed.data.scope,
    userId: auth.userId!,
    includeArchived: parsed.data.archived,
    chatMode: parsed.data.mode,
  });

  return NextResponse.json({ ok: true, chats });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "seo") {
    const gate = await requireDtSeoAccess(
      auth.supabase,
      auth.userId!,
      parsed.data.organisationId,
    );
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const { chatId, error } = await createDtChat({
    organisationId: parsed.data.organisationId,
    agentId: parsed.data.agentId,
    mode: parsed.data.mode as DtChatMode,
    title: parsed.data.title ?? "Neuer Chat",
  });

  if (!chatId) {
    return NextResponse.json({ ok: false, message: error ?? "Chat konnte nicht erstellt werden." }, { status: 500 });
  }

  const { data: chat } = await auth.supabase
    .from("dt_chats")
    .select(
      "id,organisation_id,agent_id,mode,owner_user_id,title,archived_at,pinned,created_at,updated_at",
    )
    .eq("id", chatId)
    .single();

  return NextResponse.json({ ok: true, chat });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/ai/chat-db";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("includeArchived") === "1";
  const query = (searchParams.get("q") ?? "").trim();

  let queryBuilder = auth.supabase
    .from("ai_chats")
    .select("id,title,archived_at,assistant_rules,created_at,updated_at")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false });

  if (!includeArchived) queryBuilder = queryBuilder.is("archived_at", null);

  const { data, error } = await queryBuilder;
  if (error) return NextResponse.json({ ok: false, message: "Chats konnten nicht geladen werden." }, { status: 500 });

  let chats = (data ?? []) as Array<{
    id: string;
    title: string;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  }>;

  if (query) {
    const { data: msgMatches } = await auth.supabase
      .from("ai_chat_messages")
      .select("chat_id")
      .ilike("content", `%${query}%`)
      .limit(500);
    const hitIds = new Set((msgMatches ?? []).map((x: { chat_id: string }) => x.chat_id));
    const lowerQ = query.toLowerCase();
    chats = chats.filter((c) => c.title.toLowerCase().includes(lowerQ) || hitIds.has(c.id));
  }

  return NextResponse.json({ ok: true, chats });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase
    .from("ai_chats")
    .insert({
      user_id: auth.userId,
      title: parsed.data.title ?? "Neuer Chat",
    })
    .select("id,title,archived_at,assistant_rules,created_at,updated_at")
    .single();
  if (error || !data) {
    return NextResponse.json({ ok: false, message: "Chat konnte nicht erstellt werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, chat: data });
}


import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";

const querySchema = z.object({
  org: z.string().uuid(),
  mode: z.enum(["default", "seo", "team", "ghost"]).default("default"),
  q: z.string().trim().min(1).max(120),
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

function escapeIlike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export type DtChatSearchHit = {
  chatId: string;
  title: string;
  snippet: string;
  updatedAt: string;
  archivedAt: string | null;
};

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org"),
    mode: url.searchParams.get("mode") ?? "default",
    q: url.searchParams.get("q") ?? "",
    includeArchived: url.searchParams.get("archived") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Suchparameter." }, { status: 400 });
  }

  if (parsed.data.mode === "seo" && auth.userId) {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, parsed.data.org);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const pattern = `%${escapeIlike(parsed.data.q)}%`;

  let chatsQuery = auth.supabase
    .from("dt_chats")
    .select("id,title,updated_at,archived_at")
    .eq("organisation_id", parsed.data.org)
    .eq("mode", parsed.data.mode)
    .ilike("title", pattern)
    .order("updated_at", { ascending: false })
    .limit(15);

  if (!parsed.data.includeArchived) {
    chatsQuery = chatsQuery.is("archived_at", null);
  }

  const { data: titleHits } = await chatsQuery;

  let msgQuery = auth.supabase
    .from("dt_chat_messages")
    .select("chat_id, content, dt_chats!inner(id, title, updated_at, archived_at, organisation_id, mode)")
    .eq("dt_chats.organisation_id", parsed.data.org)
    .eq("dt_chats.mode", parsed.data.mode)
    .ilike("content", pattern)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!parsed.data.includeArchived) {
    msgQuery = msgQuery.is("dt_chats.archived_at", null);
  }

  const { data: messageHits } = await msgQuery;

  const byChat = new Map<string, DtChatSearchHit>();

  for (const row of titleHits ?? []) {
    byChat.set(row.id, {
      chatId: row.id,
      title: row.title,
      snippet: "Titel-Treffer",
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    });
  }

  for (const row of messageHits ?? []) {
    const chat = row.dt_chats as
      | { id: string; title: string; updated_at: string; archived_at: string | null }
      | Array<{ id: string; title: string; updated_at: string; archived_at: string | null }>;
    const c = Array.isArray(chat) ? chat[0] : chat;
    if (!c?.id) continue;
    if (byChat.has(c.id)) continue;
    const content = String(row.content ?? "");
    const idx = content.toLowerCase().indexOf(parsed.data.q.toLowerCase());
    const start = Math.max(0, idx - 40);
    const snippet =
      idx >= 0
        ? `…${content.slice(start, start + 100).replace(/\s+/g, " ").trim()}…`
        : content.slice(0, 100);
    byChat.set(c.id, {
      chatId: c.id,
      title: c.title,
      snippet,
      updatedAt: c.updated_at,
      archivedAt: c.archived_at,
    });
  }

  const results = [...byChat.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return NextResponse.json({ ok: true, results, query: parsed.data.q });
}

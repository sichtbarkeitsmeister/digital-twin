import { NextResponse } from "next/server";
import { z } from "zod";

import { dtChatTeamOrFilter, dtChatVisibleOrFilter, requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";

const querySchema = z.object({
  org: z.string().uuid(),
  scope: z.enum(["mine", "team", "all", "org"]).optional(),
  mode: z.enum(["default", "seo", "team", "ghost"]).optional(),
  q: z.string().trim().min(1).max(120),
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  oversight: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  owner: z.string().uuid().optional(),
  /** @deprecated use scope=mine */
  mine: z
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
    scope: url.searchParams.get("scope") ?? undefined,
    mode: url.searchParams.get("mode") ?? undefined,
    q: url.searchParams.get("q") ?? "",
    includeArchived: url.searchParams.get("archived") ?? undefined,
    oversight: url.searchParams.get("oversight") ?? undefined,
    owner: url.searchParams.get("owner") ?? undefined,
    mine: url.searchParams.get("mine") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Suchparameter." }, { status: 400 });
  }

  const adminOversight = parsed.data.scope === "org" || parsed.data.oversight === true;
  if (adminOversight && auth.userId) {
    if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
      return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
    }
  }

  const listScope: "mine" | "team" | "all" | "org" =
    parsed.data.scope ??
    (parsed.data.mine ? "mine" : parsed.data.mode === "team" ? "team" : "all");

  const chatMode = parsed.data.mode ?? "default";

  if (chatMode === "seo" && auth.userId && !adminOversight) {
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
    .ilike("title", pattern)
    .order("updated_at", { ascending: false })
    .limit(15);

  if (adminOversight && listScope === "org") {
    if (parsed.data.owner) {
      chatsQuery = chatsQuery.eq("owner_user_id", parsed.data.owner);
    }
  } else if (chatMode === "seo") {
    chatsQuery = chatsQuery.eq("mode", "seo");
  } else if (listScope === "mine") {
    chatsQuery = chatsQuery
      .eq("mode", "default")
      .eq("owner_user_id", auth.userId!)
      .is("legacy_session_id", null);
  } else if (listScope === "team") {
    chatsQuery = chatsQuery.or(dtChatTeamOrFilter());
  } else if (listScope === "all") {
    chatsQuery = chatsQuery.or(dtChatVisibleOrFilter(auth.userId!));
  } else {
    chatsQuery = chatsQuery.eq("mode", chatMode);
  }

  if (!parsed.data.includeArchived) {
    chatsQuery = chatsQuery.is("archived_at", null);
  }

  const { data: titleHits } = await chatsQuery;

  let msgQuery = auth.supabase
    .from("dt_chat_messages")
    .select("chat_id, content, dt_chats!inner(id, title, updated_at, archived_at, organisation_id, mode)")
    .eq("dt_chats.organisation_id", parsed.data.org)
    .ilike("content", pattern)
    .order("created_at", { ascending: false })
    .limit(30);

  if (adminOversight && listScope === "org") {
    if (parsed.data.owner) {
      msgQuery = msgQuery.eq("dt_chats.owner_user_id", parsed.data.owner);
    }
  } else if (chatMode === "seo") {
    msgQuery = msgQuery.eq("dt_chats.mode", "seo");
  } else if (listScope === "mine") {
    msgQuery = msgQuery
      .eq("dt_chats.mode", "default")
      .eq("dt_chats.owner_user_id", auth.userId!)
      .is("dt_chats.legacy_session_id", null);
  } else if (listScope === "team") {
    msgQuery = msgQuery.or(dtChatTeamOrFilter("dt_chats"));
  } else if (listScope === "all") {
    msgQuery = msgQuery.or(dtChatVisibleOrFilter(auth.userId!, "dt_chats"));
  } else {
    msgQuery = msgQuery.eq("dt_chats.mode", chatMode);
  }

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

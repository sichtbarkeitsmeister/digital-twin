import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DT_CHAT_ATTACHMENTS_BUCKET,
  isSkippedStoragePath,
} from "@/lib/dt/attachments";
import type { DtChatMode } from "@/lib/dt/types";

const SELECT_BATCH = 500;
const STORAGE_REMOVE_BATCH = 100;
const DELETE_BATCH = 100;

/**
 * Delete matching dt_chats (messages/attachments cascade) and clean storage.
 * Caller must enforce authorization before invoking.
 */
export async function deleteDtChatsBulk(params: {
  supabase: SupabaseClient;
  organisationId: string;
  agentId?: string;
  mode?: Exclude<DtChatMode, "ghost">;
  /** When set, only chats owned by this user (personal chats). */
  ownerUserId?: string;
}): Promise<{ ok: true; deletedCount: number } | { ok: false; message: string }> {
  const chatIds: string[] = [];
  let from = 0;

  for (;;) {
    let q = params.supabase
      .from("dt_chats")
      .select("id")
      .eq("organisation_id", params.organisationId)
      .order("id", { ascending: true })
      .range(from, from + SELECT_BATCH - 1);

    if (params.agentId) q = q.eq("agent_id", params.agentId);
    if (params.mode) q = q.eq("mode", params.mode);
    if (params.ownerUserId) q = q.eq("owner_user_id", params.ownerUserId);

    const { data, error } = await q;
    if (error) {
      return { ok: false, message: error.message || "Chats konnten nicht geladen werden." };
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (row?.id) chatIds.push(row.id);
    }
    if (rows.length < SELECT_BATCH) break;
    from += SELECT_BATCH;
  }

  if (chatIds.length === 0) {
    return { ok: true, deletedCount: 0 };
  }

  const storagePaths: string[] = [];
  for (let i = 0; i < chatIds.length; i += SELECT_BATCH) {
    const slice = chatIds.slice(i, i + SELECT_BATCH);
    const { data: attachRows, error: attachError } = await params.supabase
      .from("dt_chat_attachments")
      .select("storage_path")
      .in("chat_id", slice);
    if (attachError) {
      console.warn("[dt] bulk chat attachment lookup", attachError.message);
      continue;
    }
    for (const row of attachRows ?? []) {
      const path = row.storage_path;
      if (path && !isSkippedStoragePath(path)) storagePaths.push(path);
    }
  }

  for (let i = 0; i < storagePaths.length; i += STORAGE_REMOVE_BATCH) {
    const slice = storagePaths.slice(i, i + STORAGE_REMOVE_BATCH);
    const rm = await params.supabase.storage.from(DT_CHAT_ATTACHMENTS_BUCKET).remove(slice);
    if (rm.error) console.warn("[dt] bulk chat attachment cleanup", rm.error.message);
  }

  let deletedCount = 0;
  for (let i = 0; i < chatIds.length; i += DELETE_BATCH) {
    const slice = chatIds.slice(i, i + DELETE_BATCH);
    const { error, count } = await params.supabase
      .from("dt_chats")
      .delete({ count: "exact" })
      .in("id", slice);
    if (error) {
      return {
        ok: false,
        message: error.message || "Chats konnten nicht gelöscht werden.",
      };
    }
    deletedCount += count ?? slice.length;
  }

  return { ok: true, deletedCount };
}

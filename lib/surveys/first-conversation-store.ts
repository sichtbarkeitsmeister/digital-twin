import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  firstConversationHasContent,
  normalizeFirstConversation,
  prepareFirstConversationForSave,
  type FirstConversationRecord,
} from "@/lib/surveys/first-conversation";

export async function loadFirstConversation(
  organisationId: string,
): Promise<{
  record: FirstConversationRecord;
  updatedAt: string | null;
  updatedByUserId: string | null;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_org_first_conversations")
    .select("briefing, updated_at, updated_by_user_id")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  return {
    record: normalizeFirstConversation(data?.briefing),
    updatedAt: data?.updated_at ?? null,
    updatedByUserId: data?.updated_by_user_id ?? null,
  };
}

export async function saveFirstConversation(input: {
  organisationId: string;
  record: FirstConversationRecord;
  userId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createServiceClient();
  const briefing = prepareFirstConversationForSave(input.record);

  const { error } = await supabase.from("dt_org_first_conversations").upsert(
    {
      organisation_id: input.organisationId,
      briefing,
      updated_by_user_id: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organisation_id" },
  );

  if (error) {
    return { ok: false, message: error.message || "Erstgespräch konnte nicht gespeichert werden." };
  }
  return { ok: true };
}

export async function loadFirstConversationIfAny(
  organisationId: string,
): Promise<FirstConversationRecord | null> {
  const loaded = await loadFirstConversation(organisationId);
  return firstConversationHasContent(loaded.record) ? loaded.record : null;
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Deletes the auto-seeded Standard-Avatar (slug=default, is_default) for one org.
 * Chats on that avatar are removed with it. The SEO-Berater is never touched.
 * No-op when the service role is unavailable or no such row exists.
 */
export async function removeSeededStandardAvatars(organisationId: string): Promise<void> {
  if (!organisationId) return;

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return;
  }

  const { data, error } = await service
    .from("dt_agents")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("slug", "default")
    .eq("is_default", true)
    .neq("kind", "seo_advisor");

  if (error || !data?.length) return;

  const ids = data.map((row) => row.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return;

  const { error: chatError } = await service.from("dt_chats").delete().in("agent_id", ids);
  if (chatError) {
    console.warn("[dt] Standard-Avatar chats could not be removed:", chatError.message);
    return;
  }

  const { error: agentError } = await service.from("dt_agents").delete().in("id", ids);
  if (agentError) {
    console.warn("[dt] Standard-Avatar could not be removed:", agentError.message);
  }
}

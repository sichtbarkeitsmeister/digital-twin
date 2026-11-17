import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONTENT_MODEL_SETTING_KEYS,
  resolveContentModels,
  type ContentModelConfig,
} from "@/lib/dt/content/model-config";

/**
 * Model config with the `app_settings` override applied. Needs the service client:
 * `app_settings` has no RLS policies, so only the service role can read it.
 * A failing read falls back to env/default so a settings problem never blocks a text.
 */
export async function loadContentModelConfig(service: SupabaseClient): Promise<ContentModelConfig> {
  const keys = Object.values(CONTENT_MODEL_SETTING_KEYS);
  const { data, error } = await service.from("app_settings").select("key, value").in("key", keys);
  if (error) {
    console.warn("[content] app_settings not readable, using env/default model:", error.message);
    return resolveContentModels();
  }
  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));
  return resolveContentModels({
    write: byKey.get(CONTENT_MODEL_SETTING_KEYS.write) ?? null,
    check: byKey.get(CONTENT_MODEL_SETTING_KEYS.check) ?? null,
  });
}

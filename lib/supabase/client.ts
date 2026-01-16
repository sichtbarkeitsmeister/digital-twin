import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnvOrThrow } from "./env";

export function createClient() {
  const { url, key } = getSupabasePublicEnvOrThrow("lib/supabase/client.ts");
  return createBrowserClient(
    url,
    key,
  );
}

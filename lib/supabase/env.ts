export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Supabase has historically called the public browser key the "anon key".
 * Newer templates/docs may call it the "publishable key".
 *
 * Support both names to make deployments less brittle.
 */
export function getSupabasePublicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabasePublicEnvOrThrow(where: string) {
  const url = getSupabaseUrl();
  const key = getSupabasePublicKey();

  if (!url || !key) {
    throw new Error(
      [
        "@supabase/ssr: Missing Supabase env vars.",
        `Required: NEXT_PUBLIC_SUPABASE_URL + (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY).`,
        `Where: ${where}.`,
        "Note: NEXT_PUBLIC_* variables must be present during `next build` to be bundled into the client.",
      ].join(" ")
    );
  }

  return { url, key };
}

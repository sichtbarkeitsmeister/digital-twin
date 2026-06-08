import { createClient } from "@/lib/supabase/server";

export async function requireSurveyPlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  if (authError || !userId) {
    return { ok: false as const, message: "Nicht angemeldet.", supabase, userId: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { ok: false as const, message: "Keine Berechtigung.", supabase, userId: null };
  }

  return { ok: true as const, message: "ok", supabase, userId };
}

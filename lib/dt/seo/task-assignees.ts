import { createServiceClient } from "@/lib/supabase/service";

export type DtSeoTaskAssignee = {
  id: string;
  email: string;
};

export async function loadDtSeoTaskAssignees(): Promise<DtSeoTaskAssignee[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "admin")
    .order("email", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
  }));
}

export async function resolveUserAssigneeLabel(
  userId: string,
): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data?.email) {
    return { ok: false, message: "Profil nicht gefunden." };
  }

  return { ok: true, email: data.email };
}

export async function resolvePlatformAdminAssignee(
  userId: string,
): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("profiles")
    .select("id, email, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data || data.role !== "admin") {
    return { ok: false, message: "Zuweisung nur an Plattform-Admins möglich." };
  }

  return { ok: true, email: data.email };
}

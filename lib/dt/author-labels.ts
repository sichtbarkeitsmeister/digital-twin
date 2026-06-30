import { createServiceClient } from "@/lib/supabase/service";
import { formatPersonDisplayName } from "@/lib/dt/display-name";

export async function loadDtAuthorLabels(
  userIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const labels: Record<string, string> = {};
  if (unique.length === 0) return labels;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .in("id", unique);

  for (const row of data ?? []) {
    const name = row.full_name?.trim();
    if (name) {
      labels[row.id] = name;
      continue;
    }
    const email = row.email?.trim() ?? "";
    labels[row.id] = email.includes("@")
      ? formatPersonDisplayName(email.split("@")[0]!)
      : email || "Nutzer";
  }

  return labels;
}

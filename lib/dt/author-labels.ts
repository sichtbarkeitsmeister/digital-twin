import { createServiceClient } from "@/lib/supabase/service";
import { formatPersonDisplayName } from "@/lib/dt/display-name";

export type DtAuthorProfiles = {
  labels: Record<string, string>;
  emails: Record<string, string | null>;
};

function labelFromEmail(email: string): string {
  const local = email.includes("@") ? email.split("@")[0]! : email;
  return formatPersonDisplayName(local);
}

export async function loadDtAuthorProfiles(
  userIds: string[],
): Promise<DtAuthorProfiles> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const labels: Record<string, string> = {};
  const emails: Record<string, string | null> = {};
  if (unique.length === 0) return { labels, emails };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .in("id", unique);

  if (error) {
    console.warn("[dt] author profiles:", error.message);
  }

  for (const row of data ?? []) {
    const email = row.email?.trim() ?? null;
    emails[row.id] = email;
    labels[row.id] = email ? labelFromEmail(email) : "Nutzer";
  }

  const unresolved = unique.filter((id) => !labels[id]);
  await Promise.all(
    unresolved.map(async (id) => {
      try {
        const { data: authData } = await supabase.auth.admin.getUserById(id);
        const email = authData.user?.email?.trim() ?? null;
        emails[id] = email;
        if (email) {
          labels[id] = labelFromEmail(email);
          return;
        }
        const metaName =
          (authData.user?.user_metadata?.full_name as string | undefined)?.trim() ||
          (authData.user?.user_metadata?.name as string | undefined)?.trim();
        labels[id] = metaName || "Nutzer";
      } catch {
        labels[id] = "Nutzer";
        emails[id] = null;
      }
    }),
  );

  return { labels, emails };
}

export async function loadDtAuthorLabels(
  userIds: string[],
): Promise<Record<string, string>> {
  const { labels } = await loadDtAuthorProfiles(userIds);
  return labels;
}

import { isPlatformAdmin } from "@/lib/dt/org-access";
import { surveyBelongsToOrganisation } from "@/lib/dt/list-organisation-surveys";
import { createClient } from "@/lib/supabase/server";

/**
 * Platform admins see all surveys. Any org member (including employees) may open
 * questionnaires that belong to their organisation.
 */
export async function canAccessSurveyForDashboard(input: {
  userId: string;
  surveyId: string;
}): Promise<boolean> {
  const supabase = await createClient();
  if (await isPlatformAdmin(supabase, input.userId)) return true;

  const [{ data: memberships }, { data: ownedOrgs }] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", input.userId),
    supabase
      .from("organisations")
      .select("id")
      .eq("owner_user_id", input.userId)
      .is("archived_at", null),
  ]);

  const orgIds = [
    ...new Set([
      ...(memberships ?? [])
        .map((m) => m.organisation_id)
        .filter((id): id is string => typeof id === "string"),
      ...(ownedOrgs ?? []).map((o) => o.id),
    ]),
  ];

  for (const organisationId of orgIds) {
    if (
      await surveyBelongsToOrganisation({
        surveyId: input.surveyId,
        organisationId,
      })
    ) {
      return true;
    }
  }

  return false;
}

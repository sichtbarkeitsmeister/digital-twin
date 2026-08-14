import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { surveyBelongsToOrganisation } from "@/lib/dt/list-organisation-surveys";
import { createClient } from "@/lib/supabase/server";

/**
 * Platform admins see all surveys. Org owners/admins may open surveys that
 * belong to their organisation (organisation_id, matching folder, or agent source).
 */
export async function canAccessSurveyForDashboard(input: {
  userId: string;
  surveyId: string;
}): Promise<boolean> {
  const supabase = await createClient();
  if (await isPlatformAdmin(supabase, input.userId)) return true;

  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id, org_role")
    .eq("user_id", input.userId)
    .in("org_role", ["owner", "admin"]);

  const orgIds = [
    ...new Set(
      (memberships ?? [])
        .map((m) => m.organisation_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  for (const organisationId of orgIds) {
    if (!(await canManageDtAgents(supabase, input.userId, organisationId))) {
      continue;
    }
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

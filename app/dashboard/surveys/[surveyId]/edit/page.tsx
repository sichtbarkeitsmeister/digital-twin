import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { canAccessSurveyForDashboard } from "@/lib/surveys/survey-dashboard-access";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";
import type { Survey } from "@/lib/surveys/types";
import {
  loadDtFragebogenOrganisations,
  loadDtManageOrganisations,
} from "@/lib/dt/load-manage-organisations";

import { SurveyBuilder } from "@/app/dashboard/_components/surveys/survey-builder";
import { SurveyOrganisationAssignmentMenu } from "@/app/dashboard/surveys/_components/survey-organisation-assignment-menu";

export default async function EditSurveyPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";
  const canAccess =
    isPlatformAdmin ||
    (await canAccessSurveyForDashboard({ userId, surveyId }));
  if (!canAccess) {
    redirect("/dashboard/inbox");
  }

  // Surveys are RLS-locked to platform admins; after the access check we load via service role.
  const db = isPlatformAdmin ? supabase : createServiceClient();

  const [{ data: survey }, fragebogen, manage] = await Promise.all([
    db
      .from("surveys")
      .select("id,definition,visibility,slug,notification_emails,purpose,organisation_id")
      .eq("id", surveyId)
      .is("deleted_at", null)
      .maybeSingle(),
    loadDtFragebogenOrganisations(userId),
    loadDtManageOrganisations(userId),
  ]);

  if (!survey?.definition) {
    redirect("/dashboard/frageboegen");
  }

  const assignableOrganisations = isPlatformAdmin
    ? fragebogen.organisations
    : manage.organisations;

  const { data: latestResponses } = await db
    .from("survey_responses")
    .select("answers,updated_at")
    .eq("survey_id", surveyId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const latestAnswersRaw = latestResponses?.[0]?.answers;
  const initialResponseAnswers =
    latestAnswersRaw && typeof latestAnswersRaw === "object" && !Array.isArray(latestAnswersRaw)
      ? (latestAnswersRaw as Record<string, unknown>)
      : {};

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sbkm-navy/10 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <p className="text-sm font-medium text-primary">Organisation</p>
        <SurveyOrganisationAssignmentMenu
          surveyId={survey.id}
          currentOrganisationId={survey.organisation_id ?? null}
          organisations={assignableOrganisations}
          labelOrganisations={fragebogen.organisations}
          canEdit={assignableOrganisations.length > 0}
          allowUnassign={isPlatformAdmin}
        />
      </div>
      <SurveyBuilder
        surveyId={survey.id}
        initialSurvey={survey.definition as unknown as Survey}
        initialPurpose={normalizeSurveyPurpose((survey as { purpose?: unknown }).purpose)}
        initialVisibility={survey.visibility === "public" ? "public" : "private"}
        initialSlug={survey.slug}
        initialNotificationEmails={(survey.notification_emails ?? []) as string[]}
        initialResponseAnswers={initialResponseAnswers}
      />
    </div>
  );
}

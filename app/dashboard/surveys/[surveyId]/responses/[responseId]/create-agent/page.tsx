import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SurveyAnbieterToSeoWizard } from "@/components/surveys/survey-anbieter-to-seo-wizard";
import { SurveyToAgentWizard } from "@/components/surveys/survey-to-agent-wizard";
import { findAgentForSurveyResponse } from "@/lib/dt/survey-to-agent-context";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";
import { createClient } from "@/lib/supabase/server";

export default async function SurveyCreateAgentPage({
  params,
}: {
  params: Promise<{ surveyId: string; responseId: string }>;
}) {
  const { surveyId, responseId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") redirect("/dashboard/inbox");

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, organisation_id, purpose")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) return notFound();

  const purpose = normalizeSurveyPurpose((survey as { purpose?: unknown }).purpose);

  const { data: response } = await supabase
    .from("survey_responses")
    .select("id, status")
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (!response) return notFound();

  if (response.status !== "completed") {
    redirect(`/dashboard/surveys/${surveyId}/responses/${responseId}`);
  }

  const { organisations } = await loadDtManageOrganisations(user.id);
  if (organisations.length === 0) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-secondary">
          <Link href={`/dashboard/surveys/${surveyId}/responses/${responseId}`}>
            ← Zurück
          </Link>
        </p>
        <p className="text-sm text-secondary">
          Keine Organisation verfügbar. Lege zuerst eine Organisation an.
        </p>
      </div>
    );
  }

  if (purpose === "anbieter") {
    return (
      <SurveyAnbieterToSeoWizard
        surveyId={surveyId}
        responseId={responseId}
        surveyTitle={survey.title}
        initialOrganisationId={survey.organisation_id}
        organisations={organisations}
      />
    );
  }

  const existingAgent = await findAgentForSurveyResponse(responseId);
  if (existingAgent) {
    redirect(
      `/dashboard/verwaltung/agents?org=${encodeURIComponent(existingAgent.organisation_id)}`,
    );
  }

  return (
    <SurveyToAgentWizard
      surveyId={surveyId}
      responseId={responseId}
      surveyTitle={survey.title}
      initialOrganisationId={survey.organisation_id}
      organisations={organisations}
    />
  );
}

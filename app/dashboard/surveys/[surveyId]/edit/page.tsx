import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Survey } from "@/lib/surveys/types";

import { SurveyBuilder } from "@/app/dashboard/_components/surveys/survey-builder";

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
  if (!isPlatformAdmin) {
    redirect("/dashboard/inbox");
  }

  const { data: survey } = await supabase
    .from("surveys")
    .select("id,definition,visibility,slug,notification_emails")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey?.definition) {
    redirect("/dashboard/surveys");
  }

  const { data: latestResponses } = await supabase
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
    <SurveyBuilder
      surveyId={survey.id}
      initialSurvey={survey.definition as unknown as Survey}
      initialVisibility={survey.visibility === "public" ? "public" : "private"}
      initialSlug={survey.slug}
      initialNotificationEmails={(survey.notification_emails ?? []) as string[]}
      initialResponseAnswers={initialResponseAnswers}
    />
  );
}


import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { canAccessSurveyForDashboard } from "@/lib/surveys/survey-dashboard-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SurveyResponsesPage({
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
    const canAccess = await canAccessSurveyForDashboard({ userId, surveyId });
    if (!canAccess) {
      redirect("/dashboard/inbox");
    }
  }

  const db = isPlatformAdmin ? supabase : createServiceClient();

  const { data: survey } = await db
    .from("surveys")
    .select("id")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) return notFound();

  const { data: response } = await db
    .from("survey_responses")
    .select("id")
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (response?.id) {
    redirect(`/dashboard/surveys/${surveyId}/responses/${response.id}`);
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          <Link href="/dashboard/frageboegen" className="hover:text-primary transition-colors">
            ← Zurück zu Fragebögen
          </Link>
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/surveys/${surveyId}/edit`}>Umfrage bearbeiten</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antwort</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          Noch keine Antwort vorhanden.
        </CardContent>
      </Card>
    </div>
  );
}

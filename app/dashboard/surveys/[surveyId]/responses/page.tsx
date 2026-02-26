import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
    redirect("/dashboard/inbox");
  }

  const { data: survey } = await supabase
    .from("surveys")
    .select("id")
    .eq("id", surveyId)
    .maybeSingle();

  if (!survey) return notFound();

  const { data: response } = await supabase
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
          <Link href="/dashboard/surveys" className="hover:text-primary transition-colors">
            ← Zurück zu Umfragen
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


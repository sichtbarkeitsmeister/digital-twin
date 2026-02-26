import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { CopyToClipboardButton } from "@/app/dashboard/_components/copy-to-clipboard-button";
import { publishSurveyAction, unpublishSurveyAction } from "@/app/dashboard/surveys/actions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function visibilityLabel(v: string) {
  return v === "public" ? "Öffentlich" : "Privat";
}

function statusLabel(v: string) {
  if (v === "completed") return "Abgeschlossen";
  if (v === "in_progress") return "In Bearbeitung";
  return v;
}

function countTotalFields(definition: unknown): number {
  if (!isRecord(definition)) return 0;
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  let total = 0;
  for (const st of steps) {
    if (isRecord(st) && Array.isArray(st.fields)) total += st.fields.length;
  }
  return total;
}

function countAnswered(answers: unknown): number {
  if (!isRecord(answers)) return 0;
  return Object.keys(answers).length;
}

function PublicLink({ slug }: { slug: string }) {
  const path = `/s/${slug}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={path} className="text-sm underline underline-offset-4">
        {path}
      </Link>
      <CopyToClipboardButton text={path} label="Link kopieren" />
    </div>
  );
}

export default async function SurveysPage() {
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

  const { data: surveys } = await supabase
    .from("surveys")
    .select("id,title,description,visibility,slug,updated_at,published_at,definition")
    .order("updated_at", { ascending: false });

  const surveyIds = (surveys ?? []).map((s) => s.id);
  const { data: responses } =
    surveyIds.length > 0
      ? await supabase
          .from("survey_responses")
          .select("id,survey_id,status,answers,updated_at,completed_at")
          .in("survey_id", surveyIds)
      : { data: [] as Array<{
          id: string;
          survey_id: string;
          status: string;
          answers: unknown;
          updated_at: string;
          completed_at: string | null;
        }> };

  const responseBySurveyId = new Map((responses ?? []).map((r) => [r.survey_id, r]));

  const { data: pendingQuestions } =
    surveyIds.length > 0
      ? await supabase
          .from("survey_field_questions")
          .select("survey_id")
          .in("survey_id", surveyIds)
          .is("answer", null)
      : { data: [] as Array<{ survey_id: string }> };

  const pendingBySurveyId = new Map<string, number>();
  for (const q of pendingQuestions ?? []) {
    pendingBySurveyId.set(q.survey_id, (pendingBySurveyId.get(q.survey_id) ?? 0) + 1);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Umfragen</h1>
          <p className="text-secondary">
            Entwürfe sind standardmäßig privat. Veröffentliche, um per Link zu teilen.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/surveys/new">Neue Umfrage</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alle Umfragen</CardTitle>
          <CardDescription>Erstellen, veröffentlichen und Fortschritt ansehen.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {surveys?.length ? (
            <div className="grid gap-3">
              {surveys.map((s) => {
                const isPublic = s.visibility === "public" && !!s.slug;
                const response = responseBySurveyId.get(s.id) ?? null;
                const totalFields = countTotalFields(s.definition);
                const answered = countAnswered(response?.answers);
                const pct =
                  totalFields > 0 ? Math.min(100, Math.round((answered / totalFields) * 100)) : 0;
                const pendingCount = pendingBySurveyId.get(s.id) ?? 0;
                const responseHref = response?.id
                  ? `/dashboard/surveys/${s.id}/responses/${response.id}`
                  : `/dashboard/surveys/${s.id}/responses`;
                return (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold truncate">{s.title}</p>
                        <Badge variant={s.visibility === "public" ? "default" : "secondary"}>
                          {visibilityLabel(s.visibility)}
                        </Badge>
                        <Badge variant="outline">{pct}%</Badge>
                        {response?.status ? (
                          <span className="text-xs text-secondary">{statusLabel(response.status)}</span>
                        ) : (
                          <span className="text-xs text-secondary">Noch keine Antwort</span>
                        )}
                        {s.published_at ? (
                          <span className="text-xs text-secondary">
                            Veröffentlicht {new Date(s.published_at).toLocaleString()}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 h-2 w-full max-w-[360px] overflow-hidden rounded-full bg-primary/20">
                        <div className="h-2 bg-primary" style={{ width: `${pct}%` }} />
                      </div>

                      {s.description ? (
                        <p className="text-sm text-secondary line-clamp-2">{s.description}</p>
                      ) : null}

                      {isPublic ? <PublicLink slug={s.slug!} /> : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/surveys/${s.id}/edit`}>Bearbeiten</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={responseHref}>
                          <span className="inline-flex items-center gap-2">
                            Antwort
                            {pendingCount > 0 ? (
                              <span
                                aria-label="Neue Frage"
                                className="h-2 w-2 rounded-full bg-red-500"
                              />
                            ) : null}
                          </span>
                        </Link>
                      </Button>

                      {s.visibility === "public" ? (
                        <form
                          action={async () => {
                            "use server";
                            await unpublishSurveyAction({ surveyId: s.id });
                          }}
                        >
                          <Button size="sm" variant="secondary" type="submit">
                            Privat machen
                          </Button>
                        </form>
                      ) : (
                        <form
                          action={async () => {
                            "use server";
                            await publishSurveyAction({ surveyId: s.id });
                          }}
                        >
                          <Button size="sm" type="submit">
                            Veröffentlichen
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-secondary">
              Noch keine Umfragen. Klicke auf „Neue Umfrage“, um deinen ersten Entwurf zu erstellen.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


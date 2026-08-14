import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BellRing, Bot } from "lucide-react";

import {
  findAgentForSurveyResponse,
  normalizeSurveyAnswer,
} from "@/lib/dt/survey-to-agent-context";
import type { SurveyField, SurveyStep } from "@/lib/surveys/types";
import { canAccessSurveyForDashboard } from "@/lib/surveys/survey-dashboard-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { answerSurveyFieldQuestionAction, reopenSurveyResponseAction } from "@/app/dashboard/surveys/actions";
import { ResponseExportActions } from "./response-export-actions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function statusLabel(v: string) {
  if (v === "completed") return "Abgeschlossen";
  if (v === "in_progress") return "In Bearbeitung";
  return v;
}

function getSteps(definition: unknown): SurveyStep[] {
  if (!isRecord(definition)) return [];
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  return steps as SurveyStep[];
}

function getTotalFields(definition: unknown): number {
  return getSteps(definition).reduce((sum, st) => sum + (Array.isArray(st.fields) ? st.fields.length : 0), 0);
}

function normalizeAnswer(v: unknown, field?: SurveyField) {
  return normalizeSurveyAnswer(v, field);
}

export default async function SurveyResponseDetailPage({
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

  const { data: survey } = await db
    .from("surveys")
    .select("id,title,definition,purpose")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!survey) return notFound();

  const surveyPurpose =
    (survey as { purpose?: string }).purpose === "anbieter" ? "anbieter" : "persona";

  const { data: response } = await db
    .from("survey_responses")
    .select("id,status,answers,created_at,updated_at,completed_at")
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .maybeSingle();
  if (!response) return notFound();

  const existingAgent =
    response.status === "completed"
      ? await findAgentForSurveyResponse(responseId)
      : null;

  const { data: questions } = await db
    .from("survey_field_questions")
    .select("id,field_id,kind,question,asked_at,answer,answered_at,answered_by_user_id")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  const answers: Record<string, unknown> = isRecord(response.answers) ? response.answers : {};
  const steps = getSteps(survey.definition);
  const totalFields = getTotalFields(survey.definition);
  const answeredCount = Object.keys(answers).length;
  const pct = totalFields > 0 ? Math.round((answeredCount / totalFields) * 100) : 0;

  function fieldQuestions(fieldId: string) {
    return (questions ?? []).filter((q) => q.field_id === fieldId);
  }

  const exportItems = steps.flatMap((step, stepIndex) =>
    (step.fields ?? []).map((field: SurveyField) => ({
      stepTitle: step.title || `Schritt ${stepIndex + 1}`,
      fieldId: field.id,
      fieldTitle: field.title || "Unbenannte Frage/Bemerkung",
      fieldDescription: field.description || null,
      answer: normalizeAnswer(answers?.[field.id], field),
    })),
  );

  const exportPayload = {
    survey: { id: survey.id, title: survey.title },
    response: {
      id: response.id,
      status: response.status,
      created_at: response.created_at ?? null,
      updated_at: response.updated_at ?? null,
      completed_at: response.completed_at ?? null,
    },
    items: exportItems,
    fieldQuestions: (questions ?? []).map((q) => ({
      id: q.id,
      field_id: q.field_id,
      kind: (q.kind === "remark" ? "remark" : "question") as "question" | "remark",
      question: q.question,
      asked_at: q.asked_at ?? null,
      answer: q.answer ?? null,
      answered_at: q.answered_at ?? null,
    })),
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm text-secondary">
          <Link
            href="/dashboard/frageboegen"
            className="hover:text-primary transition-colors"
          >
            ← Zurück zu Fragebögen
          </Link>
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Antwort-Details</h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-secondary">
            <span className="font-medium">{survey.title}</span> ·{" "}
            <Badge variant={response.status === "completed" ? "default" : "secondary"}>
              {statusLabel(response.status)}
            </Badge>{" "}
            · {pct}% ({answeredCount}/{totalFields})
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <ResponseExportActions payload={exportPayload} />
            {response.status === "completed" && existingAgent && surveyPurpose === "persona" ? (
              <Button asChild size="sm" variant="secondary">
                <Link
                  href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(existingAgent.organisation_id)}`}
                >
                  <Bot className="size-4" aria-hidden />
                  Agent ansehen ({existingAgent.name})
                </Link>
              </Button>
            ) : null}
            {response.status === "completed" &&
            (surveyPurpose === "anbieter" || !existingAgent) ? (
              <Button asChild size="sm">
                <Link
                  href={`/dashboard/surveys/${surveyId}/responses/${responseId}/create-agent`}
                >
                  <Bot className="size-4" aria-hidden />
                  {surveyPurpose === "anbieter"
                    ? "In SEO-Berater übernehmen"
                    : "In Agent umwandeln"}
                </Link>
              </Button>
            ) : null}
            {response.status === "completed" ? (
              <form
                action={async () => {
                  "use server";
                  await reopenSurveyResponseAction({ surveyId, responseId });
                }}
              >
                <Button type="submit" size="sm" variant="outline">
                  Wieder öffnen
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antworten</CardTitle>
          <CardDescription>Was bisher ausgefüllt wurde.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {steps.map((step, stepIndex) => (
            <div key={step.id} className="grid gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{step.title || `Schritt ${stepIndex + 1}`}</h2>
                <span className="text-xs text-secondary">{step.fields.length} Felder</span>
              </div>
              <div className="grid gap-3">
                {step.fields.map((field: SurveyField) => {
                  const value = normalizeAnswer(answers?.[field.id], field);
                  const qs = fieldQuestions(field.id);
                  const hasUnanswered = qs.some((q) => q.kind !== "remark" && !q.answer);
                  return (
                    <div key={field.id} className="rounded-lg border p-4">
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{field.title || "Unbenannte Frage/Bemerkung"}</p>
                          {hasUnanswered ? (
                            <span
                              aria-label="Neue Frage/Bemerkung"
                              className="h-2 w-2 rounded-full bg-red-500"
                            />
                          ) : null}
                        </div>
                        {field.description ? (
                          <p className="text-sm text-secondary">{field.description}</p>
                        ) : null}
                        <p className="text-sm">
                          <span className="text-secondary">Antwort:</span>{" "}
                          {value ? <span className="font-medium">{value}</span> : <em>—</em>}
                        </p>
                      </div>

                      {qs.length ? (
                        <div className="mt-4 grid gap-3">
                          <p className="text-sm font-semibold">Fragen & Bemerkungen</p>
                          {qs.map((q) => (
                            <div key={q.id} className="rounded-md bg-accent/30 p-3">
                              <p className="text-sm">
                                <span className="inline-flex items-center gap-2">
                                  {q.kind !== "remark" && !q.answer ? (
                                    <BellRing className="h-4 w-4 text-red-500" aria-hidden />
                                  ) : null}
                                  <span className="font-medium">
                                    Nutzer ({q.kind === "remark" ? "Bemerkung" : "Frage"}):
                                  </span>{" "}
                                  {q.question}
                                </span>
                              </p>
                              {q.kind === "remark" ? null : q.answer ? (
                                <p className="mt-2 text-sm">
                                  <span className="font-medium">Admin:</span> {q.answer}
                                </p>
                              ) : (
                                <form
                                  action={async (formData) => {
                                    "use server";
                                    const answer = String(formData.get("answer") ?? "");
                                    await answerSurveyFieldQuestionAction({ questionId: q.id, answer });
                                  }}
                                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                                >
                                  <div className="grid gap-1">
                                    <Label htmlFor={`answer_${q.id}`}>Antwort</Label>
                                    <Input id={`answer_${q.id}`} name="answer" placeholder="Antwort schreiben…" />
                                  </div>
                                  <div className="flex items-end">
                                    <Button type="submit" size="sm">
                                      Senden
                                    </Button>
                                  </div>
                                </form>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}


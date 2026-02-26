"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";

import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { SurveyProgress } from "@/app/dashboard/_components/surveys/survey-progress";

type ResponseSession = {
  responseId: string;
};

type Answers = Record<string, unknown>;

type PublicFieldQuestion = {
  id: string;
  field_id: string;
  question: string;
  asked_at: string;
  answer: string | null;
  answered_at: string | null;
};

type CreatePublicResponseRow = {
  response_id: string;
};

type PublicSurveyResponseRow = {
  answers: unknown;
  status: "in_progress" | "completed";
  updated_at: string;
  completed_at: string | null;
};

function storageKey(slug: string) {
  return `dt_survey_response_v1:${slug}`;
}

function answersStorageKey(slug: string) {
  return `dt_survey_answers_v1:${slug}`;
}

function getStep(survey: Survey, idx: number): SurveyStep {
  return survey.steps[idx] ?? survey.steps[0]!;
}

function countFields(survey: Survey) {
  return survey.steps.reduce((sum, st) => sum + st.fields.length, 0);
}

function countAnswered(answers: Answers) {
  return Object.keys(answers).length;
}

function FieldHelp({
  surveyTitle,
  field,
  slug,
}: {
  surveyTitle: string;
  field: SurveyField;
  slug: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [items, setItems] = React.useState<PublicFieldQuestion[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function refresh() {
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_public_field_questions", {
      p_slug: slug,
      p_field_id: field.id,
    });
    if (error) {
      setErr("Fragen konnten nicht geladen werden.");
      return;
    }
    setItems((data ?? []) as PublicFieldQuestion[]);
  }

  React.useEffect(() => {
    if (!open) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send() {
    const text = question.trim();
    if (!text) return;

    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("ask_public_field_question", {
        p_slug: slug,
        p_field_id: field.id,
        p_question: text,
      });
      if (error) {
        setErr("Deine Frage konnte nicht gesendet werden.");
        return;
      }
      setQuestion("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <HelpCircle className="h-4 w-4" />
        Frage stellen
      </button>

      {open ? (
        <div className="mt-3 grid gap-3 rounded-lg border p-3">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Hilfe · {surveyTitle || "Umfrage"}
            </p>
            <p className="text-sm font-medium">{field.title || "Frage"}</p>
          </div>

          {items.length ? (
            <div className="grid gap-2">
              {items.map((it) => (
                <div key={it.id} className="rounded-md bg-accent/30 p-3">
                  <p className="text-sm">
                    <span className="font-medium">Du:</span> {it.question}
                  </p>
                  {it.answer ? (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Admin:</span> {it.answer}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-secondary">Warten auf eine Admin-Antwort…</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">Noch keine Fragen.</p>
          )}

          <div className="grid gap-2">
            <Label htmlFor={`ask_${field.id}`}>Deine Frage</Label>
            <Textarea
              id={`ask_${field.id}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Schreibe deine Frage…"
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={send} disabled={busy || !question.trim()}>
                Senden
              </Button>
              {err ? <span className="text-xs text-red-400">{err}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SurveyFill({ slug, survey }: { slug: string; survey: Survey }) {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Answers>({});
  const [session, setSession] = React.useState<ResponseSession | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [latestAdminAnswerByFieldId, setLatestAdminAnswerByFieldId] = React.useState<
    Record<string, { answer: string; answeredAt: string | null }>
  >({});
  const [status, setStatus] = React.useState<
    | { kind: "idle" }
    | { kind: "loading"; message: string }
    | { kind: "error"; message: string }
    | { kind: "ok"; message: string }
  >({ kind: "loading", message: "Umfrage wird gestartet…" });

  const steps = survey.steps;
  const step = getStep(survey, stepIndex);
  const canBack = stepIndex > 0;
  const canNext = stepIndex < steps.length - 1;

  const total = Math.max(countFields(survey), 1);
  const answered = countAnswered(answers);
  const pct = Math.min(100, Math.round((answered / total) * 100));

  function isFilled(field: SurveyField, value: unknown) {
    if (field.type === "text") return typeof value === "string" && value.trim().length > 0;
    if (field.type === "radio") return typeof value === "string" && value.trim().length > 0;
    if (field.type === "checkbox") return Array.isArray(value) && value.length > 0;
    if (field.type === "rating") return typeof value === "number" && Number.isFinite(value);
    return false;
  }

  function getMissingRequired() {
    const missing: string[] = [];
    for (const st of survey.steps) {
      for (const f of st.fields) {
        if (!f.required) continue;
        if (!isFilled(f, answers[f.id])) {
          missing.push(f.title?.trim() ? f.title : "Pflichtfeld");
        }
      }
    }
    return missing;
  }

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((a) => ({ ...a, [fieldId]: value }));
  }

  // Create or restore response session
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!cancelled) {
        setHydrated(false);
        setStatus({ kind: "loading", message: "Lade…" });
      }

      // Fast-path: show cached answers immediately (while DB loads).
      try {
        const rawAnswers = window.localStorage.getItem(answersStorageKey(slug));
        if (rawAnswers) {
          const parsed = JSON.parse(rawAnswers) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            if (!cancelled) setAnswers(parsed as Answers);
          }
        }
      } catch {
        // ignore
      }

      try {
        const raw = window.localStorage.getItem(storageKey(slug));
        if (raw) {
          const parsed = JSON.parse(raw) as ResponseSession;
          if (parsed?.responseId) {
            if (!cancelled) {
              setSession(parsed);
            }
            // Continue below to load the latest answers from DB.
          }
        }
      } catch {
        // ignore
      }

      const supabase = createClient();

      // Ensure the single response exists.
      const { data: ensureData, error: ensureError } = await supabase.rpc(
        "create_public_survey_response",
        { p_slug: slug },
      );
      const first = (ensureData?.[0] ?? null) as CreatePublicResponseRow | null;
      if (ensureError || !first?.response_id) {
        if (!cancelled) setStatus({ kind: "error", message: "Umfrage konnte nicht gestartet werden." });
        return;
      }

      const next: ResponseSession = { responseId: first.response_id };
      try {
        window.localStorage.setItem(storageKey(slug), JSON.stringify(next));
      } catch {
        // ignore
      }
      if (!cancelled) {
        setSession(next);
      }

      // Load latest saved answers so refresh does not reset progress.
      const { data: responseData } = await supabase.rpc("get_public_survey_response", { p_slug: slug });
      const row = (responseData?.[0] ?? null) as PublicSurveyResponseRow | null;
      if (row && row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)) {
        if (!cancelled) setAnswers(row.answers as Answers);
      }
      if (!cancelled) {
        setHydrated(true);
        setStatus(row?.status === "completed" ? { kind: "ok", message: "Bereits gesendet." } : { kind: "idle" });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Local cache for instant reloads (doesn't replace DB persistence)
  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(answersStorageKey(slug), JSON.stringify(answers));
    } catch {
      // ignore
    }
  }, [answers, hydrated, slug]);

  // Autosave answers (debounced)
  React.useEffect(() => {
    if (!session) return;
    if (status.kind === "loading") return;
    if (!hydrated) return;
    if (status.kind === "ok") return; // already submitted

    const handle = window.setTimeout(async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("save_public_survey_response", {
        p_slug: slug,
        p_answers: answers,
        p_mark_completed: false,
      });
      if (error) {
        setStatus({ kind: "error", message: "Speichern fehlgeschlagen. Bitte erneut versuchen." });
        return;
      }
      setStatus({ kind: "idle" });
    }, 700);

    return () => window.clearTimeout(handle);
  }, [answers, session, slug, status.kind, hydrated]);

  // Load latest admin answers for fields in the current step (so replies are visible without opening "Frage stellen")
  React.useEffect(() => {
    if (!hydrated) return;
    const current = getStep(survey, stepIndex);
    if (!current?.fields?.length) return;

    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const entries = await Promise.all(
        current.fields.map(async (f) => {
          const { data } = await supabase.rpc("list_public_field_questions", {
            p_slug: slug,
            p_field_id: f.id,
          });
          const rows = (data ?? []) as PublicFieldQuestion[];
          const answered = rows
            .filter((r) => !!r.answer)
            .sort((a, b) => {
              const aT = a.answered_at ? new Date(a.answered_at).getTime() : 0;
              const bT = b.answered_at ? new Date(b.answered_at).getTime() : 0;
              return bT - aT;
            })[0];

          return answered?.answer
            ? ({ fieldId: f.id, answer: answered.answer, answeredAt: answered.answered_at ?? null } as const)
            : null;
        }),
      );

      if (cancelled) return;
      setLatestAdminAnswerByFieldId((prev) => {
        const next = { ...prev };
        for (const e of entries) {
          if (!e) continue;
          next[e.fieldId] = { answer: e.answer, answeredAt: e.answeredAt };
        }
        return next;
      });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [hydrated, slug, stepIndex, survey]);

  async function submit() {
    if (!session) return;
    const missing = getMissingRequired();
    if (missing.length > 0) {
      const list = missing.slice(0, 8).map((t) => `- ${t}`).join("\n");
      const more = missing.length > 8 ? `\n… und ${missing.length - 8} weitere.` : "";
      window.alert(`Bitte fülle zuerst alle Pflichtfelder aus.\n\nFehlend:\n${list}${more}`);
      setStatus({ kind: "error", message: "Bitte fülle zuerst alle Pflichtfelder aus." });
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("save_public_survey_response", {
      p_slug: slug,
      p_answers: answers,
      p_mark_completed: true,
    });
    if (error) {
      setStatus({ kind: "error", message: "Senden fehlgeschlagen. Bitte erneut versuchen." });
      return;
    }
    setStatus({ kind: "ok", message: "Vielen Dank! Deine Antworten wurden gesendet." });
  }

  if (status.kind === "ok") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Vielen Dank!</CardTitle>
            <CardDescription>{survey.title || "Umfrage"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-secondary">{status.message}</p>
            <p className="text-sm text-secondary">Du kannst diese Seite jetzt schließen.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="grid gap-6">
        <div className="sticky top-0 z-40 -mx-4 px-4 py-3 bg-background/80 backdrop-blur border-b">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Umfrage</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-secondary">{survey.title || "Umfrage"}</p>
                  <Badge variant="secondary">Öffentlich</Badge>
                  <Badge variant="outline">{pct}%</Badge>
                </div>
              </div>
              <div />
            </div>

            {status.kind === "error" ? <p className="text-sm text-red-400">{status.message}</p> : null}

            <SurveyProgress steps={steps} currentStepIndex={stepIndex} />

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!canBack}
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                Zurück
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!session || status.kind === "loading"}
                onClick={() => {
                  if (canNext) setStepIndex(stepIndex + 1);
                  else void submit();
                }}
              >
                {canNext ? "Weiter" : "Senden"}
              </Button>
            </div>
          </div>
        </div>

        {survey.description ? <p className="text-secondary">{survey.description}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle>{step.title || `Schritt ${stepIndex + 1}`}</CardTitle>
            {step.description ? <CardDescription>{step.description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {step.fields.length === 0 ? (
              <p className="text-sm text-secondary">Keine Fragen in diesem Schritt.</p>
            ) : (
              <div className="grid gap-5">
                {step.fields.map((field) => (
                  <div key={field.id} className="grid gap-2">
                    <div className="grid gap-1">
                      <p className="text-sm font-semibold">
                        {field.title || "Unbenannte Frage"}{" "}
                        {field.required ? <span className="text-red-400">*</span> : null}
                      </p>
                      {field.description ? <p className="text-sm text-secondary">{field.description}</p> : null}
                    </div>

                    {field.type === "text" ? (
                      <Input
                        value={(answers[field.id] as string) ?? ""}
                        onChange={(e) => setAnswer(field.id, e.target.value)}
                        placeholder={field.placeholder || "Deine Antwort…"}
                      />
                    ) : null}

                    {field.type === "radio" ? (
                      <div className="grid gap-2">
                        {field.options.map((opt) => {
                          const selected = answers[field.id] === opt.label;
                          return (
                            <label key={opt.id} className={cn("flex items-center gap-2 text-sm", !session && "opacity-70")}>
                              <input
                                type="radio"
                                name={field.id}
                                checked={selected}
                                disabled={!session}
                                onChange={() => setAnswer(field.id, opt.label)}
                              />
                              {opt.label}
                            </label>
                          );
                        })}
                      </div>
                    ) : null}

                    {field.type === "checkbox" ? (
                      <div className="grid gap-2">
                        {field.options.map((opt) => {
                          const set = new Set((answers[field.id] as string[]) ?? []);
                          const checked = set.has(opt.label);
                          return (
                            <label key={opt.id} className={cn("flex items-center gap-2 text-sm", !session && "opacity-70")}>
                              <Checkbox
                                checked={checked}
                                disabled={!session}
                                onCheckedChange={(next) => {
                                  const nextSet = new Set((answers[field.id] as string[]) ?? []);
                                  if (next) nextSet.add(opt.label);
                                  else nextSet.delete(opt.label);
                                  setAnswer(field.id, Array.from(nextSet));
                                }}
                              />
                              {opt.label}
                            </label>
                          );
                        })}
                      </div>
                    ) : null}

                    {field.type === "rating" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {Array.from({ length: field.scale.max - field.scale.min + 1 }).map((_, i) => {
                          const value = field.scale.min + i;
                          const selected = answers[field.id] === value;
                          return (
                            <Button
                              key={value}
                              type="button"
                              variant={selected ? "default" : "outline"}
                              size="sm"
                              disabled={!session}
                              onClick={() => setAnswer(field.id, value)}
                            >
                              {value}
                            </Button>
                          );
                        })}
                      </div>
                    ) : null}

                    {latestAdminAnswerByFieldId[field.id]?.answer ? (
                      <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                          Antwort vom Admin
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {latestAdminAnswerByFieldId[field.id]!.answer}
                        </p>
                        {latestAdminAnswerByFieldId[field.id]!.answeredAt ? (
                          <p className="mt-1 text-xs text-secondary">
                            {new Date(latestAdminAnswerByFieldId[field.id]!.answeredAt!).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <FieldHelp surveyTitle={survey.title} field={field} slug={slug} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


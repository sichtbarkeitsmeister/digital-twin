"use client";

import * as React from "react";
import { HelpCircle, Plus, X } from "lucide-react";

import { SurveyRankingInput } from "@/components/surveys/survey-ranking-input";
import { FormattedInfoText } from "@/components/surveys/formatted-info-text";
import {
  addCheckboxOtherEntry,
  buildCheckboxAnswer,
  buildRadioAnswer,
  CHECKBOX_OTHER_PREFIX,
  CHECKBOX_OTHER_TOKEN,
  decodeOtherValueForDisplay,
  getRadioOtherState,
  parseCheckboxOtherEntries,
  RADIO_OTHER_TOKEN,
  removeCheckboxOtherEntry,
  setCheckboxOtherEntryText,
} from "@/lib/surveys/other-option";
import { isRankingAnswerValid } from "@/lib/surveys/ranking-answer";
import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { SurveyFillHeader } from "@/app/s/[slug]/_components/survey-fill-header";

type ResponseSession = {
  responseId: string;
};

type Answers = Record<string, unknown>;

type PublicFieldQuestion = {
  id: string;
  field_id: string;
  kind: "question" | "remark";
  question: string;
  asked_at: string;
  answer: string | null;
  answered_at: string | null;
};

type PublicFieldRemark = {
  id: string;
  field_id: string;
  remark: string;
  updated_at: string;
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
  const [mode, setMode] = React.useState<"question" | "remark">("question");
  const [question, setQuestion] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [items, setItems] = React.useState<PublicFieldQuestion[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function toggleMode(nextMode: "question" | "remark") {
    if (open && mode === nextMode) {
      setOpen(false);
      return;
    }
    setMode(nextMode);
    setOpen(true);
  }

  async function refresh() {
    setErr(null);
    const supabase = createClient();
    const { data: qData, error } = await supabase.rpc("list_public_field_questions", {
      p_slug: slug,
      p_field_id: field.id,
    });
    if (error) {
      setErr("Fragen konnten nicht geladen werden.");
      return;
    }
    setItems((qData ?? []) as PublicFieldQuestion[]);

    const { data: rData } = await supabase.rpc("get_public_field_remark", {
      p_slug: slug,
      p_field_id: field.id,
    });
    const first = (rData?.[0] ?? null) as PublicFieldRemark | null;
    setRemark(first?.remark ?? "");
  }

  React.useEffect(() => {
    if (!open) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function send() {
    const text = question.trim();
    if (!text) return;

    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ask_public_field_question", {
        p_slug: slug,
        p_field_id: field.id,
        p_question: text,
      });
      if (error) {
        setErr("Deine Frage/Bemerkung konnte nicht gesendet werden.");
        return;
      }
      const questionId = typeof data === "string" ? data : null;
      if (questionId) {
        // Non-blocking: notification failures should not affect user flow.
        void fetch("/api/notifications/survey-question-asked", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ questionId }),
        }).catch(() => null);
      }
      setQuestion("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveRemark() {
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("upsert_public_field_remark", {
        p_slug: slug,
        p_field_id: field.id,
        p_remark: remark,
      });
      if (error) {
        setErr("Deine Bemerkung konnte nicht gespeichert werden.");
        return;
      }
      await refresh();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-secondary transition-colors hover:text-primary sm:h-auto sm:border-0 sm:px-0"
          onClick={() => toggleMode("question")}
        >
          <HelpCircle className="h-4 w-4" />
          Frage stellen
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-secondary transition-colors hover:text-primary sm:ml-3 sm:h-auto sm:border-0 sm:px-0"
          onClick={() => toggleMode("remark")}
        >
          <HelpCircle className="h-4 w-4" />
          {remark.trim() ? "Bemerkung bearbeiten" : "Bemerkung hinzufügen"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 grid gap-3 rounded-lg border p-3 sm:p-4">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
              {mode === "remark" ? "Bemerkung" : "Frage"} · {surveyTitle || "Umfrage"}
            </p>
            <p className="text-base font-medium sm:text-sm">{field.title || "Frage/Bemerkung"}</p>
          </div>

          {mode === "question" ? (
            <>
              {items.length ? (
                <div className="grid gap-2">
                  {items.map((it) => (
                    <div key={it.id} className="rounded-md bg-accent/30 p-3">
                      <p className="text-base sm:text-sm">
                        <span className="font-medium">Du (Frage):</span> {it.question}
                      </p>
                      {it.answer ? (
                        <p className="mt-2 text-base sm:text-sm">
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
                  className="text-base sm:text-sm"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={send} disabled={busy || !question.trim()}>
                    Senden
                  </Button>
                  {err ? <span className="text-xs text-red-400">{err}</span> : null}
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor={`remark_${field.id}`}>Bemerkung</Label>
              <Textarea
                id={`remark_${field.id}`}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Schreibe deine Bemerkung…"
                className="text-base sm:text-sm"
              />
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={saveRemark} disabled={busy}>
                  Speichern
                </Button>
                {err ? <span className="text-xs text-red-400">{err}</span> : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SurveyFill({ slug, survey }: { slug: string; survey: Survey }) {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [isInfoOpen, setIsInfoOpen] = React.useState(false);
  const [mobileCompactProgress, setMobileCompactProgress] = React.useState(0);
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
  const isInfoIntroStep = survey.infoTextEnabled === true && stepIndex === 0;
  const visibleFields =
    isInfoIntroStep ? [] : step.fields;
  const canBack = stepIndex > 0;
  const canNext = stepIndex < steps.length - 1;
  const hasInfoText = survey.infoTextEnabled === true && (survey.infoText?.trim().length ?? 0) > 0;

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [stepIndex]);

  React.useEffect(() => {
    setIsInfoOpen(false);
  }, [stepIndex]);

  React.useEffect(() => {
    const computeProgress = () => {
      if (window.innerWidth >= 1024) {
        setMobileCompactProgress(0);
        return;
      }
      // Linear interpolation instead of state switching prevents oscillation.
      const startY = 8;
      const endY = 88;
      const raw = (window.scrollY - startY) / (endY - startY);
      const next = Math.max(0, Math.min(1, raw));
      setMobileCompactProgress((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };

    let raf = 0;
    const onViewportChange = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        computeProgress();
      });
    };

    computeProgress();
    window.addEventListener("scroll", onViewportChange, { passive: true });
    window.addEventListener("resize", onViewportChange);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  function isFilled(field: SurveyField, value: unknown) {
    if (field.type === "text") return typeof value === "string" && value.trim().length > 0;
    if (field.type === "radio") {
      if (typeof value !== "string") return false;
      const raw = value.trim();
      if (!raw.length) return false;
      if (raw === RADIO_OTHER_TOKEN) return false;
      const presetSet = new Set(field.options.map((o) => o.label));
      if (presetSet.has(value)) return true;
      return field.allowOtherOption === true;
    }
    if (field.type === "checkbox") {
      if (!Array.isArray(value)) return false;
      const presetSet = new Set(field.options.map((o) => o.label));
      return value.some((entry) => {
        if (typeof entry !== "string") return false;
        if (presetSet.has(entry)) return true;
        if (entry === CHECKBOX_OTHER_TOKEN) return false;
        if (entry.startsWith(CHECKBOX_OTHER_PREFIX)) {
          return decodeOtherValueForDisplay(entry).trim().length > 0;
        }
        return field.allowOtherOption !== false && entry.trim().length > 0;
      });
    }
    if (field.type === "rating") return typeof value === "number" && Number.isFinite(value);
    if (field.type === "ranking") {
      return isRankingAnswerValid(
        value,
        field.options.map((o) => o.label),
        field.required,
      );
    }
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

  const missingRequiredStepIndices = survey.steps.flatMap((st, idx) => {
    const hasMissingRequired = st.fields.some(
      (field) => field.required && !isFilled(field, answers[field.id]),
    );
    return hasMissingRequired ? [idx] : [];
  });

  const missingRequiredInCurrentStep = visibleFields.filter(
    (field) => field.required && !isFilled(field, answers[field.id]),
  ).length;

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
    // Non-blocking: notification failures should not affect user flow.
    void fetch("/api/notifications/survey-completed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    }).catch(() => null);
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
    <div className="mx-auto w-full max-w-5xl overflow-x-clip px-3 py-5 sm:px-5 sm:py-8 lg:snap-none snap-y snap-mandatory">
      <div className="grid gap-5 sm:gap-6">
        <SurveyFillHeader
          title={survey.title || "Umfrage"}
          steps={steps}
          stepIndex={stepIndex}
          canBack={canBack}
          canNext={canNext}
          showInfoButton={hasInfoText && stepIndex >= 1}
          missingRequiredInCurrentStep={missingRequiredInCurrentStep}
          missingRequiredStepIndices={missingRequiredStepIndices}
          mobileCompactProgress={mobileCompactProgress}
          isLoading={!session || status.kind === "loading"}
          errorMessage={status.kind === "error" ? status.message : undefined}
          onBack={() => setStepIndex(stepIndex - 1)}
          onNext={() => setStepIndex(stepIndex + 1)}
          onSubmit={() => void submit()}
          onInfoOpen={() => setIsInfoOpen(true)}
          onStepChange={setStepIndex}
        />

        {survey.description ? (
          <p className="text-sm leading-relaxed text-sbkm-ink-600 dark:text-white/70 sm:text-base">
            {survey.description}
          </p>
        ) : null}
        {hasInfoText && stepIndex === 0 ? (
          <Card className="rounded-dt border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Info</CardTitle>
            </CardHeader>
            <CardContent>
              <FormattedInfoText text={survey.infoText ?? ""} />
            </CardContent>
          </Card>
        ) : null}

        {!isInfoIntroStep ? (
        <Card className="rounded-dt border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
          <CardHeader>
            <CardTitle>{step.title || `Schritt ${stepIndex + 1}`}</CardTitle>
            {step.description ? <CardDescription>{step.description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-4 px-3 pb-4 pt-0 sm:p-6 sm:pt-0">
            {visibleFields.length === 0 ? (
              <p className="text-sm text-secondary">Keine Fragen/Bemerkung in diesem Schritt.</p>
            ) : (
              <div className="grid gap-4 lg:gap-5">
                {visibleFields.map((field) => (
                  <div
                    key={field.id}
                    className={cn(
                      "grid snap-start gap-3 overflow-x-clip rounded-xl border bg-card/30 p-2.5 lg:overflow-visible lg:p-4",
                      field.required && !isFilled(field, answers[field.id])
                        ? "border border-red-300/60 bg-red-500/5"
                        : "",
                    )}
                  >
                    <div className="grid gap-1">
                      <p className="text-lg font-semibold lg:text-sm">
                        {field.title || "Unbenanntes Feld"}{" "}
                        {field.required ? <span className="text-red-400">*</span> : null}
                      </p>
                      {field.description ? <p className="text-base text-secondary lg:text-sm">{field.description}</p> : null}
                      {field.required && !isFilled(field, answers[field.id]) ? (
                        <p className="text-sm text-red-400 lg:text-xs">Pflichtfeld noch nicht beantwortet.</p>
                      ) : null}
                    </div>

                    {field.type === "text" ? (
                      <Input
                        value={(answers[field.id] as string) ?? ""}
                        onChange={(e) => setAnswer(field.id, e.target.value)}
                        placeholder={survey.answerPlaceholder?.trim() || "Deine Antwort…"}
                        className="h-11 text-base lg:h-9 lg:text-sm"
                      />
                    ) : null}

                    {field.type === "radio" ? (
                      <div className="grid gap-2">
                        {field.options.map((opt) => {
                          const selected = answers[field.id] === opt.label;
                          return (
                            <label
                              key={opt.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2.5 text-base shadow-sm transition-colors hover:bg-accent lg:px-3 lg:py-2 lg:text-sm",
                                selected ? "border-primary bg-primary/5" : "border-input bg-background",
                                !session && "cursor-not-allowed opacity-70",
                              )}
                            >
                              <input
                                type="radio"
                                name={field.id}
                                checked={selected}
                                disabled={!session}
                                className="peer sr-only"
                                onChange={() => setAnswer(field.id, opt.label)}
                              />
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                                  selected ? "border-primary" : "border-primary/70",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full bg-primary transition-opacity",
                                    selected ? "opacity-100" : "opacity-0",
                                  )}
                                />
                              </span>
                              <span className="min-w-0">{opt.label}</span>
                            </label>
                          );
                        })}
                        {field.allowOtherOption === true ? (
                          (() => {
                            const presetLabels = field.options.map((opt) => opt.label);
                            const otherState = getRadioOtherState(answers[field.id], presetLabels);
                            return (
                              <label
                                className={cn(
                                  "grid cursor-pointer gap-2 rounded-md border px-2.5 py-2.5 text-base shadow-sm transition-colors lg:px-3 lg:py-2 lg:text-sm",
                                  otherState.selected
                                    ? "border-primary bg-primary/5"
                                    : "border-input bg-background",
                                  !session && "cursor-not-allowed opacity-70",
                                )}
                              >
                                <span className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name={field.id}
                                    checked={otherState.selected}
                                    disabled={!session}
                                    className="peer sr-only"
                                    onChange={() => setAnswer(field.id, RADIO_OTHER_TOKEN)}
                                  />
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "flex h-4 w-4 items-center justify-center rounded-full border bg-background",
                                      otherState.selected ? "border-primary" : "border-primary/70",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "h-2 w-2 rounded-full bg-primary transition-opacity",
                                        otherState.selected ? "opacity-100" : "opacity-0",
                                      )}
                                    />
                                  </span>
                                  <span>Andere</span>
                                </span>
                                {otherState.selected ? (
                                  <Input
                                    value={otherState.text}
                                    disabled={!session}
                                    placeholder="Eigene Option eingeben…"
                                    className="h-11 text-base lg:h-9 lg:text-sm"
                                    onChange={(e) =>
                                      setAnswer(field.id, buildRadioAnswer(e.target.value))
                                    }
                                  />
                                ) : null}
                              </label>
                            );
                          })()
                        ) : null}
                      </div>
                    ) : null}

                    {field.type === "checkbox" ? (
                      <div className="grid gap-2">
                        {(() => {
                          const presetLabels = field.options.map((o) => o.label);
                          const otherState = parseCheckboxOtherEntries(answers[field.id], presetLabels);
                          return (
                            <>
                              {field.options.map((opt) => {
                                const checked = otherState.selectedPresets.has(opt.label);
                                return (
                                  <label
                                    key={opt.id}
                                    className={cn(
                                      "flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2.5 text-base shadow-sm transition-colors hover:bg-accent lg:px-3 lg:py-2 lg:text-sm",
                                      checked ? "border-primary bg-primary/5" : "border-input bg-background",
                                      !session && "cursor-not-allowed opacity-70",
                                    )}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      disabled={!session}
                                      onCheckedChange={(next) => {
                                        const nextSet = new Set(otherState.selectedPresets);
                                        if (next) nextSet.add(opt.label);
                                        else nextSet.delete(opt.label);
                                        setAnswer(
                                          field.id,
                                          buildCheckboxAnswer(
                                            presetLabels,
                                            nextSet,
                                            otherState.otherEntries,
                                          ),
                                        );
                                      }}
                                    />
                                    <span className="min-w-0">{opt.label}</span>
                                  </label>
                                );
                              })}

                              {field.allowOtherOption !== false
                                ? otherState.otherEntries.map((entry, entryIdx) => (
                                    <div
                                      key={entry.id}
                                      className={cn(
                                        "flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent",
                                        "border-primary bg-primary/5",
                                        !session && "cursor-not-allowed opacity-70",
                                      )}
                                    >
                                      <Checkbox
                                        checked
                                        disabled={!session}
                                        onCheckedChange={(next) => {
                                          if (next !== false) return;
                                          setAnswer(
                                            field.id,
                                            removeCheckboxOtherEntry(
                                              answers[field.id],
                                              presetLabels,
                                              entry.id,
                                            ),
                                          );
                                        }}
                                      />
                                      <Input
                                        value={entry.text}
                                        disabled={!session}
                                        placeholder={`Eigene Option ${entryIdx + 1}…`}
                                        className="h-11 min-w-0 flex-1 text-base lg:h-9 lg:text-sm"
                                        onChange={(e) =>
                                          setAnswer(
                                            field.id,
                                            setCheckboxOtherEntryText(
                                              answers[field.id],
                                              presetLabels,
                                              entry.id,
                                              e.target.value,
                                            ),
                                          )
                                        }
                                      />
                                    </div>
                                  ))
                                : null}

                              {field.allowOtherOption !== false ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!session}
                                  className="h-11 w-full justify-center text-base lg:h-9 lg:w-auto lg:text-sm"
                                  onClick={() =>
                                    setAnswer(
                                      field.id,
                                      addCheckboxOtherEntry(answers[field.id], presetLabels),
                                    )
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Andere / eigene Option hinzufügen
                                </Button>
                              ) : null}
                            </>
                          );
                        })()}
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
                              className="h-11 min-w-11 text-base lg:h-9 lg:min-w-9 lg:text-sm"
                              onClick={() => setAnswer(field.id, value)}
                            >
                              {value}
                            </Button>
                          );
                        })}
                      </div>
                    ) : null}

                    {field.type === "ranking" ? (
                      <SurveyRankingInput
                        fieldId={field.id}
                        presetLabels={field.options.map((opt) => opt.label)}
                        value={answers[field.id]}
                        onChange={(next) => setAnswer(field.id, next)}
                        disabled={!session}
                        allowCustomEntries={field.allowCustomEntries !== false}
                      />
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
        ) : null}
        {hasInfoText && isInfoOpen ? (
          <div
            className="fixed inset-0 z-[120] bg-black/50 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsInfoOpen(false);
            }}
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-4">
              <Card className="w-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Info</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Info schließen"
                      onClick={() => setIsInfoOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <FormattedInfoText text={survey.infoText ?? ""} />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}


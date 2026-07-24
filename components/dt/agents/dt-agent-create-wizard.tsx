"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ClipboardList, Loader2, Plus, Sparkles } from "lucide-react";

import { DtAgentQuickActionsField } from "@/components/dt/agents/dt-agent-quick-actions-field";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSearchableOptionList } from "@/components/dt/dt-searchable-option-list";
import { CenteredModal } from "@/components/ui/centered-modal";
import { Textarea } from "@/components/ui/textarea";
import { slugifyAgentCandidate } from "@/lib/dt/survey-to-agent-prompt";
import type { SurveyAgentPreview } from "@/lib/dt/survey-to-agent-prompt";
import { cn } from "@/lib/utils";

type WizardMethod = "choose" | "blank" | "survey" | "survey_preview";
type SurveyOption = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  completedAt: string | null;
};

const fieldInputClass =
  "h-10 w-full rounded-pill border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 focus-visible:border-sbkm-mint/45 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/5 dark:text-white";

const fieldTextareaClass =
  "min-h-[100px] resize-y rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2.5 text-sm text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 focus-visible:border-sbkm-mint/45 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 dark:border-white/15 dark:bg-white/5 dark:text-white";

function formatCompletedAt(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function DtAgentCreateWizard(props: {
  open: boolean;
  organisationId: string;
  organisationName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<WizardMethod>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState("");
  const [prompt, setPrompt] = useState("");
  const [quickActions, setQuickActions] = useState<string[]>([]);

  const [surveyOptions, setSurveyOptions] = useState<SurveyOption[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [selectedSurvey, setSelectedSurvey] = useState("");
  const [extraRules, setExtraRules] = useState("");
  const [preview, setPreview] = useState<SurveyAgentPreview | null>(null);

  const selectedOption = useMemo(
    () => surveyOptions.find((o) => o.responseId === selectedSurvey) ?? null,
    [surveyOptions, selectedSurvey],
  );

  const reset = useCallback(() => {
    setStep("choose");
    setBusy(false);
    setError(null);
    setName("");
    setSlug("");
    setRole("");
    setPrompt("");
    setQuickActions([]);
    setSurveyOptions([]);
    setSurveysLoading(false);
    setSelectedSurvey("");
    setExtraRules("");
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!props.open) {
      reset();
    }
  }, [props.open, reset]);

  useEffect(() => {
    if (!props.open || step !== "survey") return;
    let cancelled = false;
    setSurveysLoading(true);
    setError(null);
    void (async () => {
      const res = await fetch("/api/dt/agents/survey-options");
      const json = (await res.json()) as {
        ok?: boolean;
        options?: SurveyOption[];
        message?: string;
      };
      if (cancelled) return;
      setSurveysLoading(false);
      if (!json.ok) {
        setError(json.message ?? "Umfragen konnten nicht geladen werden.");
        return;
      }
      const options = json.options ?? [];
      setSurveyOptions(options);
      setSelectedSurvey((prev) => {
        if (prev && options.some((o) => o.responseId === prev)) return prev;
        return options[0]?.responseId ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, step]);

  function handleClose() {
    if (busy) return;
    props.onClose();
  }

  function handleBack() {
    setError(null);
    if (step === "survey_preview") setStep("survey");
    else if (step === "blank" || step === "survey") setStep("choose");
    else handleClose();
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!slug || slug === slugifyAgentCandidate(name)) {
      setSlug(slugifyAgentCandidate(value));
    }
  }

  async function createBlank() {
    if (!name.trim() || !slug.trim() || !prompt.trim()) {
      setError("Name, Slug und Prompt sind erforderlich.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dt/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: props.organisationId,
        name: name.trim(),
        slug: slug.trim(),
        role: role.trim() || undefined,
        prompt: prompt.trim(),
        quickActions,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setError(json.message ?? "Agent konnte nicht angelegt werden.");
      return;
    }
    props.onCreated();
    props.onClose();
  }

  async function generateSurveyPreview() {
    if (!selectedOption) {
      setError("Bitte eine Umfrage wählen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/surveys/${selectedOption.surveyId}/responses/${selectedOption.responseId}/generate-agent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organisationId: props.organisationId,
            extraRules: extraRules.trim() || undefined,
          }),
          signal: AbortSignal.timeout(780_000),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        preview?: SurveyAgentPreview;
        message?: string;
      } | null;
      if (!json?.ok || !json.preview) {
        setError(json?.message ?? "Generierung fehlgeschlagen.");
        return;
      }
      setPreview(json.preview);
      setStep("survey_preview");
    } catch (err) {
      const aborted =
        err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
      setError(
        aborted
          ? "Die Generierung dauert zu lange (Zeitlimit). Bitte erneut versuchen."
          : err instanceof Error
            ? err.message
            : "Generierung fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createFromSurvey() {
    if (!preview || !selectedOption) return;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/surveys/${selectedOption.surveyId}/responses/${selectedOption.responseId}/create-agent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          agent: preview,
        }),
      },
    );
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setError(json.message ?? "Agent konnte nicht angelegt werden.");
      return;
    }
    props.onCreated();
    props.onClose();
  }

  const title =
    step === "choose"
      ? "Neuer Agent"
      : step === "blank"
        ? "Agent leer erstellen"
        : step === "survey"
          ? "Aus Umfrage erstellen"
          : "Vorschau bearbeiten";

  const surveySearchOptions = useMemo(
    () =>
      surveyOptions.map((o) => ({
        value: o.responseId,
        label: o.surveyTitle,
        description: formatCompletedAt(o.completedAt)
          ? `Abgeschlossen am ${formatCompletedAt(o.completedAt)}`
          : undefined,
        keywords: o.surveyId,
      })),
    [surveyOptions],
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleBack}
        className="rounded-pill px-4 py-2 text-sm font-medium text-sbkm-ink-600 transition-colors hover:bg-sbkm-navy/5 active:scale-[0.98] dark:text-white/60 dark:hover:bg-white/10"
      >
        {step === "choose" ? "Abbrechen" : "Zurück"}
      </button>
      <div className="flex gap-2">
        {step === "blank" ? (
          <DtPillButton type="button" disabled={busy} onClick={() => void createBlank()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Agent anlegen
          </DtPillButton>
        ) : null}
        {step === "survey" ? (
          <DtPillButton
            type="button"
            disabled={busy || surveysLoading || surveyOptions.length === 0}
            onClick={() => void generateSurveyPreview()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Vorschau generieren
          </DtPillButton>
        ) : null}
        {step === "survey_preview" ? (
          <DtPillButton type="button" disabled={busy} onClick={() => void createFromSurvey()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Agent anlegen
          </DtPillButton>
        ) : null}
      </div>
    </div>
  );

  return (
    <CenteredModal
      open={props.open}
      onClose={handleClose}
      title={title}
      description={props.organisationName}
      closeDisabled={busy}
      size={step === "survey_preview" ? "lg" : "sm"}
      bodyClassName="grid gap-4"
      footer={footer}
    >
      {step === "choose" ? (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => setStep("blank")}
            className="flex items-start gap-3 rounded-dt border border-sbkm-navy/10 bg-white/50 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.99] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-sbkm-mint/10"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
              <Bot className="size-5" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-sbkm-navy dark:text-white">Leer erstellen</p>
              <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                Name, Rolle und Prompt manuell festlegen.
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStep("survey")}
            className="flex items-start gap-3 rounded-dt border border-sbkm-navy/10 bg-white/50 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.99] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-sbkm-mint/10"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sbkm-navy/5 text-sbkm-navy dark:bg-white/10 dark:text-white">
              <ClipboardList className="size-5" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-sbkm-navy dark:text-white">Aus Umfrage</p>
              <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                Abgeschlossene Umfrage per KI in eine Persona umwandeln.
              </p>
            </div>
          </button>
        </div>
      ) : null}

      {step === "blank" ? (
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Name</span>
            <input
              value={name}
              disabled={busy}
              onChange={(e) => handleNameChange(e.target.value)}
              className={fieldInputClass}
              placeholder="z. B. Marketing-Persona"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Slug</span>
            <input
              value={slug}
              disabled={busy}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
              }
              className={fieldInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Rolle</span>
            <input
              value={role}
              disabled={busy}
              onChange={(e) => setRole(e.target.value)}
              className={fieldInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
              System-Prompt
            </span>
            <Textarea
              value={prompt}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              className={cn(fieldTextareaClass, "min-h-[140px]")}
            />
          </label>
          <DtAgentQuickActionsField
            actions={quickActions}
            onChange={setQuickActions}
            disabled={busy}
          />
        </div>
      ) : null}

      {step === "survey" ? (
        <div className="grid gap-4">
          <DtSearchableOptionList
            label="Umfrage"
            value={selectedSurvey}
            onValueChange={setSelectedSurvey}
            options={surveySearchOptions}
            loading={surveysLoading}
            disabled={busy}
            searchPlaceholder="Umfrage suchen …"
            emptyMessage="Keine verfügbaren abgeschlossenen Umfragen ohne bestehenden Agenten."
            noResultsMessage="Keine Umfrage passt zu deiner Suche."
            maxListHeight="max-h-48"
          />
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
              Zusatzregeln (optional)
            </span>
            <Textarea
              value={extraRules}
              disabled={busy}
              onChange={(e) => setExtraRules(e.target.value)}
              className={fieldTextareaClass}
              placeholder="Ton, Schwerpunkte, Tabus …"
            />
          </label>
        </div>
      ) : null}

      {step === "survey_preview" && preview ? (
        <div className="grid gap-3">
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">{preview.summary}</p>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Name</span>
            <input
              value={preview.name}
              disabled={busy}
              onChange={(e) => setPreview({ ...preview, name: e.target.value })}
              className={fieldInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Slug</span>
            <input
              value={preview.slug}
              disabled={busy}
              onChange={(e) =>
                setPreview({
                  ...preview,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                })
              }
              className={fieldInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Rolle</span>
            <input
              value={preview.role}
              disabled={busy}
              onChange={(e) => setPreview({ ...preview, role: e.target.value })}
              className={fieldInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
              Persona-Prompt
            </span>
            <Textarea
              value={preview.prompt_template}
              disabled={busy}
              onChange={(e) => setPreview({ ...preview, prompt_template: e.target.value })}
              className={cn(fieldTextareaClass, "min-h-[200px] font-mono text-xs")}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </CenteredModal>
  );
}

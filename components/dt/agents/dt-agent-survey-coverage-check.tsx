"use client";

import { useCallback, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";

import { FactCoverageReview } from "@/components/surveys/fact-coverage-review";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import type { SurveyFactCoverageSummary } from "@/lib/dt/survey-facts";
import { cn } from "@/components/dt/cn";

/**
 * Compare the current DigitalTwin prompt draft against the source questionnaire.
 * Always renders a visible button; explains when survey lineage is missing.
 */
export function DtAgentSurveyCoverageCheck(props: {
  agentId: string;
  agentName: string;
  /** False when the agent was not created from a survey response. */
  available: boolean;
  promptTemplate: string;
  promptAppend: string;
  onInsertIntoPrompt: (insertion: string) => void;
  disabled?: boolean;
  className?: string;
  /** Render only the trigger button (results still expand below in place). */
  buttonOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surveyTitle, setSurveyTitle] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SurveyFactCoverageSummary | null>(null);
  const [acceptedFactIds, setAcceptedFactIds] = useState<Set<string>>(() => new Set());

  const runCheck = useCallback(async () => {
    if (props.disabled) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    setCoverage(null);

    if (!props.available) {
      setBusy(false);
      setError(
        "Keine Fragebogen-Herkunft hinterlegt — Abgleich ist nur für Agenten möglich, die aus einer Umfrage-Antwort erzeugt wurden.",
      );
      return;
    }

    try {
      const res = await fetch(`/api/dt/agents/${props.agentId}/survey-coverage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptTemplate: props.promptTemplate,
          promptAppend: props.promptAppend || null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        surveyTitle?: string;
        coverage?: SurveyFactCoverageSummary;
      };
      if (!json.ok || !json.coverage) {
        setCoverage(null);
        setError(json.message ?? "Abgleich fehlgeschlagen.");
        return;
      }
      setSurveyTitle(json.surveyTitle ?? null);
      setCoverage(json.coverage);
      setAcceptedFactIds(new Set());
    } catch {
      setCoverage(null);
      setError("Abgleich fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [
    props.agentId,
    props.available,
    props.disabled,
    props.promptAppend,
    props.promptTemplate,
  ]);

  const openGaps =
    (coverage?.missingCount ?? 0) + (coverage?.weakCount ?? 0) - acceptedFactIds.size;
  const allOk =
    coverage &&
    coverage.total > 0 &&
    coverage.missingCount === 0 &&
    coverage.weakCount === 0;

  return (
    <div className={cn("grid gap-3", props.className)}>
      <div className="flex flex-wrap items-center gap-2">
        <DtPillButton
          type="button"
          size="sm"
          variant="outline"
          disabled={props.disabled || busy}
          onClick={() => void runCheck()}
          className="gap-1.5 border-sbkm-navy/25 bg-white font-semibold dark:border-white/20 dark:bg-white/5"
          title="Prompt mit dem ausgefüllten Fragebogen vergleichen"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ClipboardCheck className="size-4" aria-hidden />
          )}
          Fragebogen-Abgleich
        </DtPillButton>
        {open && (coverage || error) && !busy ? (
          <DtPillButton
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Schließen
          </DtPillButton>
        ) : null}
      </div>

      {open ? (
        <div className="rounded-2xl border border-sbkm-navy/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04] sm:p-4">
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-sbkm-ink-600 dark:text-white/55">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Prompt wird mit dem Fragebogen verglichen …
            </p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : coverage ? (
            <div className="grid gap-3">
              <div>
                <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                  Abgleich: {props.agentName}
                  {surveyTitle ? (
                    <span className="font-medium text-sbkm-ink-500 dark:text-white/55">
                      {" "}
                      · {surveyTitle}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Prüft, ob die aktuellen Prompt-Texte die ausgefüllten Fragebogen-Angaben
                  wirklich enthalten (auch nach manuellen Edits).
                </p>
                <p className="mt-2 text-sm text-sbkm-navy dark:text-white">
                  {coverage.coveredCount}/{coverage.total} Facts erkannt
                  {coverage.weakCount > 0 ? ` · ${coverage.weakCount} unsicher` : ""}
                  {coverage.missingCount > 0 ? ` · ${coverage.missingCount} fehlen` : ""}
                  {acceptedFactIds.size > 0
                    ? ` · ${acceptedFactIds.size} manuell akzeptiert`
                    : ""}
                </p>
              </div>

              {allOk || openGaps <= 0 ? (
                <p className="text-sm text-sbkm-mint">
                  Abgleich ok — keine offenen Lücken mehr.
                </p>
              ) : (
                <FactCoverageReview
                  factCoverage={coverage}
                  acceptedFactIds={acceptedFactIds}
                  onAccept={(factId) =>
                    setAcceptedFactIds((prev) => new Set(prev).add(factId))
                  }
                  onInsertIntoPrompt={(factId, insertion) => {
                    props.onInsertIntoPrompt(insertion);
                    setAcceptedFactIds((prev) => new Set(prev).add(factId));
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

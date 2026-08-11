"use client";

import { useCallback, useState } from "react";
import { ClipboardCheck, Link2, Loader2 } from "lucide-react";

import { FactCoverageReview } from "@/components/surveys/fact-coverage-review";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import type { SurveyFactCoverageSummary } from "@/lib/dt/survey-facts";
import {
  formatCoverageOptionLabel,
  suggestCoverageOptionForAgent,
  type AgentCoverageSurveyOption,
} from "@/lib/dt/agent-survey-coverage-option-helpers";
import { cn } from "@/components/dt/cn";

/**
 * Compare the current DigitalTwin prompt draft against a completed questionnaire.
 * Allows picking and permanently assigning which questionnaire this twin belongs to.
 */
export function DtAgentSurveyCoverageCheck(props: {
  agentId: string;
  agentName: string;
  promptTemplate: string;
  promptAppend: string;
  onInsertIntoPrompt: (insertion: string) => void;
  /** Called after the twin↔questionnaire link was saved. */
  onSourceSaved?: (source: {
    sourceSurveyId: string;
    sourceSurveyResponseId: string;
  }) => void;
  disabled?: boolean;
  className?: string;
  /** Render only the trigger button (results still expand below in place). */
  buttonOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<AgentCoverageSurveyOption[]>([]);
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(null);
  const [surveyTitle, setSurveyTitle] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SurveyFactCoverageSummary | null>(null);
  const [acceptedFactIds, setAcceptedFactIds] = useState<Set<string>>(() => new Set());

  const loadOptions = useCallback(async (): Promise<{
    options: AgentCoverageSurveyOption[];
    defaultResponseId: string | null;
  }> => {
    const res = await fetch(`/api/dt/agents/${props.agentId}/survey-coverage`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      options?: AgentCoverageSurveyOption[];
      defaultResponseId?: string | null;
    };
    if (!json.ok) {
      throw new Error(json.message ?? "Fragebögen konnten nicht geladen werden.");
    }
    const list = Array.isArray(json.options) ? json.options : [];
    const defaultId =
      json.defaultResponseId ??
      suggestCoverageOptionForAgent(list, props.agentName)?.responseId ??
      null;
    return { options: list, defaultResponseId: defaultId };
  }, [props.agentId, props.agentName]);

  const runCheck = useCallback(
    async (responseIdOverride?: string | null) => {
      if (props.disabled) return;
      setOpen(true);
      setBusy(true);
      setError(null);
      setSourceMessage(null);
      setCoverage(null);

      try {
        let list = options;
        let responseId = responseIdOverride ?? selectedResponseId;

        if (list.length === 0 || !responseId) {
          setLoadingOptions(true);
          const loaded = await loadOptions();
          list = loaded.options;
          setOptions(list);
          responseId = responseId ?? loaded.defaultResponseId;
          setSelectedResponseId(responseId);
          setLoadingOptions(false);
        }

        if (!responseId || list.length === 0) {
          setError(
            "Keine abgeschlossene Umfrage-Antwort für diese Organisation gefunden. Bitte zuerst einen Fragebogen ausfüllen.",
          );
          return;
        }

        const selected = list.find((o) => o.responseId === responseId) ?? list[0];
        if (!selected) {
          setError("Keine Umfrage-Antwort ausgewählt.");
          return;
        }

        setSelectedResponseId(selected.responseId);

        const res = await fetch(`/api/dt/agents/${props.agentId}/survey-coverage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            promptTemplate: props.promptTemplate,
            promptAppend: props.promptAppend || null,
            surveyId: selected.surveyId,
            responseId: selected.responseId,
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
        setSurveyTitle(json.surveyTitle ?? selected.surveyTitle);
        setCoverage(json.coverage);
        setAcceptedFactIds(new Set());
      } catch (err) {
        setCoverage(null);
        setError(err instanceof Error ? err.message : "Abgleich fehlgeschlagen.");
      } finally {
        setLoadingOptions(false);
        setBusy(false);
      }
    },
    [
      loadOptions,
      options,
      props.agentId,
      props.disabled,
      props.promptAppend,
      props.promptTemplate,
      selectedResponseId,
    ],
  );

  const saveAsSource = useCallback(async () => {
    const selected = options.find((o) => o.responseId === selectedResponseId);
    if (!selected || props.disabled || savingSource) return;
    if (selected.usedByOtherAgentName) {
      setSourceMessage(
        `Bereits dem Zwilling „${selected.usedByOtherAgentName}“ zugeordnet.`,
      );
      return;
    }

    setSavingSource(true);
    setSourceMessage(null);
    try {
      const res = await fetch(`/api/dt/agents/${props.agentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceSurveyId: selected.surveyId,
          sourceSurveyResponseId: selected.responseId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setSourceMessage(json.message ?? "Zuordnung konnte nicht gespeichert werden.");
        return;
      }
      setOptions((prev) =>
        prev.map((o) => ({
          ...o,
          isSource: o.responseId === selected.responseId,
          usedByOtherAgentName:
            o.responseId === selected.responseId ? null : o.usedByOtherAgentName,
        })),
      );
      setSourceMessage("Fragebogen als Herkunft dieses Zwillings gespeichert.");
      props.onSourceSaved?.({
        sourceSurveyId: selected.surveyId,
        sourceSurveyResponseId: selected.responseId,
      });
    } catch {
      setSourceMessage("Zuordnung konnte nicht gespeichert werden.");
    } finally {
      setSavingSource(false);
    }
  }, [
    options,
    props,
    savingSource,
    selectedResponseId,
  ]);

  const openGaps =
    (coverage?.missingCount ?? 0) + (coverage?.weakCount ?? 0) - acceptedFactIds.size;
  const allOk =
    coverage &&
    coverage.total > 0 &&
    coverage.missingCount === 0 &&
    coverage.weakCount === 0;

  const selected = options.find((o) => o.responseId === selectedResponseId) ?? null;
  const canSaveSource =
    Boolean(selected) &&
    !selected?.isSource &&
    !selected?.usedByOtherAgentName;

  const selectOptions = options.map((o) => ({
    value: o.responseId,
    label: formatCoverageOptionLabel(o),
    description: o.purpose === "anbieter" ? "Anbieter" : "Persona",
  }));

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
          title="Prompt mit dem aktuellen Fragebogen vergleichen"
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
          {selectOptions.length > 0 && !loadingOptions ? (
            <div className="mb-3 grid gap-2">
              <DtSelect
                label="Zugehöriger Fragebogen"
                size="sm"
                fullWidth
                value={selectedResponseId ?? selectOptions[0]?.value ?? ""}
                disabled={props.disabled || busy || savingSource}
                options={selectOptions}
                onValueChange={(value) => {
                  setSelectedResponseId(value);
                  setSourceMessage(null);
                  void runCheck(value);
                }}
                placeholder="Fragebogen wählen"
              />
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Wähle den Fragebogen, zu dem dieser Zwilling gehört. Der Abgleich nutzt
                immer die aktuellen Antworten.
              </p>
              {canSaveSource ? (
                <div>
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.disabled || busy || savingSource}
                    onClick={() => void saveAsSource()}
                    className="gap-1.5"
                  >
                    {savingSource ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Link2 className="size-4" aria-hidden />
                    )}
                    Als Herkunft speichern
                  </DtPillButton>
                </div>
              ) : selected?.isSource ? (
                <p className="text-xs font-medium text-sbkm-mint">
                  Dieser Fragebogen ist als Herkunft des Zwillings gespeichert.
                </p>
              ) : selected?.usedByOtherAgentName ? (
                <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                  Bereits bei „{selected.usedByOtherAgentName}“ hinterlegt — Abgleich
                  trotzdem möglich.
                </p>
              ) : null}
              {sourceMessage ? (
                <p
                  className={cn(
                    "text-xs",
                    /gespeichert/i.test(sourceMessage)
                      ? "text-sbkm-mint"
                      : "text-destructive",
                  )}
                >
                  {sourceMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          {busy || loadingOptions ? (
            <p className="flex items-center gap-2 text-sm text-sbkm-ink-600 dark:text-white/55">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {loadingOptions
                ? "Fragebögen werden geladen …"
                : "Prompt wird mit dem aktuellen Fragebogen verglichen …"}
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
                  Vergleicht die aktuellen Prompt-Texte mit den aktuellen
                  Fragebogen-Antworten.
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
